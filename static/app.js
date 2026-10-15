const $ = id => document.getElementById(id);
const labels = ['Artist network','Engagement momentum','Musical similarity','Freshness'];
const keys = ['artist_network','engagement_momentum','musical_similarity','freshness'];
const defaults = [25,25,20,30];
let weights = [...defaults];
const selected = [];
let suggestions = [];
let activeSuggestion = -1;
let searchTimer;
let searchSequence = 0;

function escapeHTML(v) {return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeUrl(value) {try {const u=new URL(value);return u.protocol==='https:'&&['soundcloud.com','www.soundcloud.com'].includes(u.hostname)?u.href:'#';}catch{return '#';}}
function profileUrl(value) {const u=safeUrl(value);if(u==='#')return null;const p=new URL(u);const parts=p.pathname.split('/').filter(Boolean);return parts.length===1&&!['discover','search','you','stream'].includes(parts[0].toLowerCase())?`${p.origin}/${parts[0]}`:null;}
function showError(message) {$('error').textContent=message;}
function renderSelected() {
  $('artist-count').textContent=`${selected.length} / 5`;
  $('selected-artists').innerHTML=selected.map((a,i)=>`<div class="selected-artist"><a href="${escapeHTML(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(a.name)}</a><button type="button" data-remove="${i}" aria-label="Remove ${escapeHTML(a.name)}">×</button></div>`).join('') || '<p class="muted">No artists added yet.</p>';
  $('selected-artists').querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{selected.splice(Number(button.dataset.remove),1);renderSelected();});
  $('artist-add').disabled=selected.length>=5;
  $('url-add').disabled=selected.length>=5;
}
function addArtist(artist) {
  const url=profileUrl(artist.url);
  if(!url){showError('Choose a valid SoundCloud artist profile.');return;}
  if(selected.length>=5){showError('You can add up to five artists.');return;}
  if(selected.some(a=>a.url.toLowerCase()===url.toLowerCase())){showError('That artist is already selected.');return;}
  selected.push({name:artist.name||url.split('/').pop(),url});
  showError('');
  $('artist-query').value='';$('artist-url').value='';suggestions=[];renderSuggestions();renderSelected();
}
function renderSuggestions(message='') {
  const box=$('artist-suggestions');
  if(message){box.innerHTML=`<div class="artist-empty">${escapeHTML(message)}</div>`;box.hidden=false;return;}
  if(!suggestions.length){box.innerHTML='';box.hidden=true;return;}
  box.hidden=false;
  box.innerHTML=suggestions.map((a,i)=>`<button type="button" role="option" aria-selected="${i===activeSuggestion}" class="artist-option ${i===activeSuggestion?'active':''}" data-choice="${i}">${a.avatar?`<img src="${escapeHTML(a.avatar)}" alt="" loading="lazy">`:''}<span>${escapeHTML(a.name)}<small>${escapeHTML(a.url)}</small></span></button>`).join('');
  box.querySelectorAll('[data-choice]').forEach(button=>button.onclick=()=>addArtist(suggestions[Number(button.dataset.choice)]));
}
async function searchArtists(query) {
  const seq=++searchSequence;
  if(query.length<2){suggestions=[];renderSuggestions();return;}
  renderSuggestions('Searching SoundCloud…');
  try {
    const response=await fetch(`/api/artists/search?q=${encodeURIComponent(query)}`);
    const data=await response.json();
    if(seq!==searchSequence)return;
    if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Artist search unavailable');
    suggestions=data.artists||[];activeSuggestion=suggestions.length?0:-1;
    if(!suggestions.length)renderSuggestions('No matching profiles. Try a different name or paste a URL.');
    else renderSuggestions();
  } catch(error) {if(seq===searchSequence){suggestions=[];renderSuggestions(error.message);}}
}
$('artist-query').addEventListener('input',event=>{clearTimeout(searchTimer);const query=event.target.value.trim();searchSequence++;if(query.length<2){suggestions=[];renderSuggestions();return;}searchTimer=setTimeout(()=>searchArtists(query),350);});
$('artist-query').addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'&&suggestions.length){event.preventDefault();activeSuggestion=(activeSuggestion+1)%suggestions.length;renderSuggestions();}
  if(event.key==='ArrowUp'&&suggestions.length){event.preventDefault();activeSuggestion=(activeSuggestion-1+suggestions.length)%suggestions.length;renderSuggestions();}
  if(event.key==='Enter'&&suggestions.length){event.preventDefault();addArtist(suggestions[Math.max(0,activeSuggestion)]);}
  if(event.key==='Escape'){suggestions=[];renderSuggestions();}
});
$('artist-add').onclick=()=>{if(suggestions.length)addArtist(suggestions[Math.max(0,activeSuggestion)]);else showError('Search for an artist and select a result, or use Add URL.');};
$('url-add').onclick=()=>addArtist({url:$('artist-url').value.trim()});
$('artist-url').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('url-add').click();}});

function updateTotal(){const t=weights.reduce((a,b)=>a+b,0);$('total').textContent=t+'%';$('total').className=t===100?'good':'bad';}
function renderWeights(){$('weights').innerHTML=labels.map((name,i)=>`<div class="weight"><div class="weight-top"><label for="w${i}">${name}</label><output id="v${i}">${weights[i]}%</output></div><input id="w${i}" type="range" min="0" max="100" step="1" value="${weights[i]}"></div>`).join('');labels.forEach((_,i)=>$('w'+i).addEventListener('input',event=>{weights[i]=Number(event.target.value);$('v'+i).textContent=weights[i]+'%';updateTotal();}));updateTotal();}
$('reset').onclick=()=>{weights=[...defaults];renderWeights();};
$('balance').onclick=()=>{const total=weights.reduce((a,b)=>a+b,0);if(!total){weights=[...defaults];renderWeights();return;}const raw=weights.map(w=>w*100/total),whole=raw.map(Math.floor),remaining=100-whole.reduce((a,b)=>a+b,0);raw.map((v,i)=>({i,f:v-whole[i]})).sort((a,b)=>b.f-a.f).slice(0,remaining).forEach(x=>whole[x.i]++);weights=whole;renderWeights();};
function reason(signals){if(!signals)return 'Discovered through broader search';const out=[];for(const [key,value] of Object.entries(signals)){if(Array.isArray(value)&&value.length)out.push(key.replace('_by','')+' by '+value.join(', '));}return out.join(' · ')||'Discovered through broader search';}
function player(track){const url=safeUrl(track.url);if(url==='#')return '';const params=new URLSearchParams({url,color:'#ff5500',auto_play:'false',hide_related:'true',show_comments:'false',show_user:'true',show_reposts:'false',visual:'false'});return `<div class="soundcloud-player"><iframe title="SoundCloud player for ${escapeHTML(track.title)}" width="100%" height="166" scrolling="no" frameborder="no" loading="lazy" allow="autoplay" src="https://w.soundcloud.com/player/?${escapeHTML(params.toString())}"></iframe></div>`;}
function renderTrack(t,i){const age=t.age_days==null?'':` · ${escapeHTML(t.age_days)} days old`;return `<article class="track"><div class="rank">#${i+1}</div><div class="track-body"><a href="${escapeHTML(safeUrl(t.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(t.title)}</a><div class="muted">${escapeHTML(t.artist)}${age}</div><div class="reason">${escapeHTML(reason(t.signals))}</div><div class="breakdown">${labels.map((name,j)=>`${escapeHTML(name)} ${escapeHTML(t.components?.[keys[j]]??'N/A')}`).join(' · ')}</div></div><div class="score">${escapeHTML(t.score)}<small>/100</small></div>${player(t)}</article>`;}
$('discover').onclick=async()=>{
  const urls=selected.map(a=>a.url);showError('');
  if(!urls.length){showError('Add at least one artist first.');return;}
  if(weights.reduce((a,b)=>a+b,0)!==100){showError('Weights must total 100%. Use Balance to 100%.');return;}
  const button=$('discover');button.disabled=true;button.textContent='Discovering…';
  try{
    const response=await fetch('/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls,weights})});
    const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{throw Error(`Server returned an invalid response (HTTP ${response.status}).`);}
    if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail||'Discovery failed'));
    $('output').hidden=false;
    $('summary').textContent=`${data.results.length} results from ${data.candidates} candidate tracks · ${data.artists.map(a=>a.name).join(', ')}`;
    $('results').innerHTML=data.results.map(renderTrack).join('')||'<p>No tracks were returned. Try different artists.</p>';
    $('notes').innerHTML=[...(data.limitations||[]),...(data.warnings||[])].map(x=>`<li>${escapeHTML(x)}</li>`).join('');
    $('output').scrollIntoView({behavior:'smooth'});
  }catch(error){showError(error.message);}finally{button.disabled=false;button.textContent='Discover top 20 tracks →';}
};
renderWeights();renderSelected();
