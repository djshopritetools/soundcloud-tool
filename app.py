import os, time, math, re
from datetime import datetime, timezone
from urllib.parse import urlparse
from threading import Lock
import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List
from pathlib import Path

ROOT = Path(__file__).parent
app = FastAPI(title='SC Discovery Tool')
app.mount('/static', StaticFiles(directory=ROOT/'static'), name='static')
API = 'https://api.soundcloud.com'
TOKEN_URL = 'https://secure.soundcloud.com/oauth/token'
_token, _expiry = None, 0
_token_lock = Lock()

class SearchRequest(BaseModel):
    urls: List[str] = Field(min_length=1, max_length=5)
    weights: List[int] = Field(min_length=4, max_length=4)

def auth_token():
    global _token, _expiry
    with _token_lock:
        if _token and time.time() < _expiry - 60:
            return _token
        cid, secret = os.getenv('SOUNDCLOUD_CLIENT_ID'), os.getenv('SOUNDCLOUD_CLIENT_SECRET')
        if not cid or not secret:
            raise HTTPException(500, 'SoundCloud credentials are not configured')
        try:
            r = requests.post(TOKEN_URL, auth=(cid, secret), data={'grant_type':'client_credentials'}, timeout=20)
            r.raise_for_status()
            data = r.json()
            _token = data['access_token']
            _expiry = time.time() + int(data.get('expires_in', 3600))
            return _token
        except (requests.RequestException, KeyError, ValueError):
            raise HTTPException(502, 'SoundCloud authentication failed')

def sc_get(path, params=None):
    try:
        r = requests.get(API+path, headers={'Authorization': f'OAuth {auth_token()}'}, params=params, timeout=20)
        if r.status_code in (401, 403, 404, 405, 429):
            return None, r.status_code
        r.raise_for_status()
        return r.json(), 200
    except (requests.RequestException, ValueError):
        return None, 502

def items(payload):
    if isinstance(payload, list): return payload
    if isinstance(payload, dict): return payload.get('collection', [])
    return []

def valid_url(value):
    p = urlparse(value.strip())
    segments = [x for x in p.path.split('/') if x]
    return p.scheme == 'https' and p.hostname in ('soundcloud.com', 'www.soundcloud.com') and len(segments) == 1 and segments[0].lower() not in ('discover','search','you','stream')

def age_days(track):
    raw = track.get('created_at')
    if not raw: return None
    try:
        dt = datetime.fromisoformat(raw.replace('Z','+00:00'))
        return max(0.0, (datetime.now(timezone.utc)-dt).total_seconds()/86400)
    except (ValueError, TypeError): return None

def track_info(raw):
    if not isinstance(raw, dict): return None
    t = raw.get('track') if isinstance(raw.get('track'),dict) else raw
    if not t.get('id') or not t.get('title'): return None
    return t

def track_score(track, endorsements, artist_tags):
    days = age_days(track)
    fresh = 100 * math.exp(-max(0, days)/45) if days is not None else 0
    likes = max(0, track.get('favoritings_count') or track.get('likes_count') or 0)
    plays = max(0, track.get('playback_count') or 0)
    reposts = max(0, track.get('reposts_count') or 0)
    comments = max(0, track.get('comment_count') or 0)
    # Proxy, not true momentum: age-adjusted cumulative engagement.
    engagement = likes*3 + reposts*4 + comments*2 + plays*.02
    momentum_proxy = min(100, 18*math.log1p(engagement / max(1, (days or 1)))) if days is not None else 0
    network = min(100, 40*len(endorsements.get('liked_by',[])) + 55*len(endorsements.get('reposted_by',[])) + 55*len(endorsements.get('uploaded_by',[])))
    tokens = set(re.findall(r'[a-z0-9]+', ' '.join(str(track.get(k) or '') for k in ('genre','tag_list')).lower()))
    similarity = min(100, 25 * len(tokens & artist_tags)) if artist_tags else 0
    return {'artist_network':round(network,1), 'engagement_momentum':round(momentum_proxy,1), 'musical_similarity':round(similarity,1), 'freshness':round(fresh,1)}, days

@app.get('/', response_class=HTMLResponse)
def home():
    return (ROOT/'templates'/'index.html').read_text()

@app.post('/api/discover')
def discover(req: SearchRequest):
    if len(set(req.urls)) != len(req.urls) or not all(valid_url(x) for x in req.urls):
        raise HTTPException(400, 'Provide 1–5 distinct SoundCloud artist profile URLs (https://soundcloud.com/artist)')
    if any(x < 0 or x > 100 for x in req.weights) or sum(req.weights) != 100:
        raise HTTPException(400, 'Weights must be 0–100 and sum to 100')
    profiles, tracks, evidence, warnings = [], {}, {}, []
    artist_tags = set()
    for url in req.urls:
        artist, status = sc_get('/resolve', {'url':url})
        if status != 200 or not isinstance(artist,dict) or artist.get('kind') != 'user':
            warnings.append(f'Could not resolve artist: {url} (HTTP {status})')
            continue
        name, uid = artist.get('username','Unknown'), artist['id']
        profiles.append({'name':name, 'url':url})
        for key, path in [('uploaded_by', f'/users/{uid}/tracks'),('liked_by',f'/users/{uid}/likes/tracks'),('reposted_by',f'/users/{uid}/reposts/tracks')]:
            # Bounded pagination; enough for a useful initial prototype.
            next_url = None
            for page in range(3):
                if next_url:
                    # Only follow API-hosted next_href; never user-controlled URLs.
                    parsed = urlparse(next_url)
                    if parsed.hostname != 'api.soundcloud.com': break
                    data, code = sc_get(parsed.path, dict(__import__('urllib.parse',fromlist=['parse_qsl']).parse_qsl(parsed.query)))
                else:
                    data, code = sc_get(path, {'limit':50, 'linked_partitioning':'true'})
                if code != 200:
                    warnings.append(f'{name}: {key} unavailable (HTTP {code})')
                    break
                for raw in items(data):
                    t = track_info(raw)
                    if not t: continue
                    tid = str(t['id'])
                    tracks[tid] = {**tracks.get(tid,{}), **t}
                    ev = evidence.setdefault(tid, {'uploaded_by':set(),'liked_by':set(),'reposted_by':set()})
                    ev[key].add(name)
                    if key == 'uploaded_by':
                        artist_tags.update(re.findall(r'[a-z0-9]+', ' '.join(str(t.get(k) or '') for k in ('genre','tag_list')).lower()))
                next_url = data.get('next_href') if isinstance(data,dict) else None
                if not next_url: break
    if not profiles:
        raise HTTPException(422, 'None of the artist URLs could be resolved')
    # Optional exploratory search: non-network candidates based on genre.
    genres = [x for x in artist_tags if len(x)>3 and x not in {'music','original','free','download','remix','edit','track'}][:4]
    if genres:
        for genre in genres[:2]:
            payload, code = sc_get('/tracks', {'q':genre, 'limit':50})
            if code == 200:
                for raw in items(payload):
                    t = track_info(raw)
                    if t: tracks.setdefault(str(t['id']), t)
            else:
                warnings.append(f'Broader track search unavailable (HTTP {code})')
                break
    output = []
    keys = ['artist_network','engagement_momentum','musical_similarity','freshness']
    for tid,t in tracks.items():
        ev = evidence.get(tid, {'uploaded_by':set(),'liked_by':set(),'reposted_by':set()})
        parts, days = track_score(t,ev,artist_tags)
        score = sum(w*parts[k] for w,k in zip(req.weights,keys))/100
        output.append({'id':tid,'title':t.get('title'), 'artist':(t.get('user') or {}).get('username','Unknown'), 'url':t.get('permalink_url'), 'score':round(score,1), 'components':parts, 'age_days':round(days) if days is not None else None, 'signals':{k:sorted(v) for k,v in ev.items()}})
    output.sort(key=lambda x:(-x['score'], x['id']))
    return {'artists':profiles,'results':output[:20], 'candidates':len(output),'warnings':list(dict.fromkeys(warnings)), 'limitations':['Engagement momentum is currently an age-adjusted engagement proxy, not measured growth.','Musical similarity is a basic genre/tag overlap proxy, not audio similarity.','Freshness uses upload date where available.','Broader discovery depends on available SoundCloud search results.']}
