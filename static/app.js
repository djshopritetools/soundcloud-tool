
const $ = (id) => document.getElementById(id);

const labels = [
  "Artist network",
  "Engagement momentum",
  "Musical similarity",
  "Freshness"
];

const keys = [
  "network",
  "momentum",
  "similarity",
  "freshness"
];

const defaultWeights = [25, 25, 20, 30];
let weights = [...defaultWeights];

// Escape text before inserting it into HTML.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

// Allow only valid HTTPS SoundCloud links.
function safeUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      ["soundcloud.com", "www.soundcloud.com"].includes(url.hostname)
    ) {
      return url.href;
    }
  } catch (error) {
    // Invalid URL
  }
  return "#";
}

// Build five artist input fields.
$("urls").innerHTML = Array.from({ length: 5 }, (_, i) => `
  <label class="url-row">
    <span>${i + 1}</span>
    <input
      type="url"
      placeholder="https://soundcloud.com/artist"
      aria-label="Artist ${i + 1} URL"
    />
  </label>
`).join("");

// Display algorithm weights.
function updateTotal() {
  const total = weights.reduce((sum, value) => sum + value, 0);
  $("total").textContent = `${total}%`;
  $("total").style.color = total === 100 ? "" : "#e74c3c";
}

function renderWeights() {
  $("weights").innerHTML = labels.map((name, i) => `
    <div class="weight">
      <div class="weight-top">
        <label for="w${i}">${escapeHTML(name)}</label>
        <output id="v${i}">${weights[i]}%</output>
      </div>
      <input
        id="w${i}"
        type="range"
        min="0"
        max="100"
        step="1"
        value="${weights[i]}"
      />
    </div>
  `).join("");

  labels.forEach((_, i) => {
    $(`w${i}`).addEventListener("input", (event) => {
      weights[i] = Number(event.target.value);
      $(`v${i}`).textContent = `${weights[i]}%`;
      updateTotal();
    });
  });

  updateTotal();
}

// Normalize weights so they add to 100%.
function balanceWeights() {
  const total = weights.reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    weights = [...defaultWeights];
    renderWeights();
    return;
  }

  const raw = weights.map((value) => (value / total) * 100);
  const balanced = raw.map(Math.floor);

  let remainder = 100 - balanced.reduce((sum, value) => sum + value, 0);

  const order = raw
    .map((value, index) => ({
      index,
      fraction: value - Math.floor(value)
    }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < remainder; i++) {
    balanced[order[i].index]++;
  }

  weights = balanced;
  renderWeights();
}

$("balance").addEventListener("click", balanceWeights);

$("reset").addEventListener("click", () => {
  weights = [...defaultWeights];
  renderWeights();
});

renderWeights();

// Explain why a track was recommended.
function reason(signals) {
  if (!signals) return "Recommended by the discovery algorithm";

  if (typeof signals === "string") return signals;

  if (Array.isArray(signals)) {
    return signals.length
      ? signals.join(" · ")
      : "Recommended by the discovery algorithm";
  }

  if (typeof signals === "object") {
    const parts = [];

    for (const [key, value] of Object.entries(signals)) {
      if (!value) continue;

      const name = key.replaceAll("_", " ");

      if (Array.isArray(value)) {
        parts.push(`${name}: ${value.join(", ")}`);
      } else if (typeof value === "boolean") {
        parts.push(name);
      } else {
        parts.push(`${name}: ${value}`);
      }
    }

    return parts.length
      ? parts.join(" · ")
      : "Recommended by the discovery algorithm";
  }

  return "Recommended by the discovery algorithm";
}

// Build the official SoundCloud embedded player.
function soundcloudPlayer(track) {
  const trackUrl = safeUrl(track.url);

  if (trackUrl === "#") {
    return "";
  }

  const playerUrl =
    "https://w.soundcloud.com/player/?" +
    new URLSearchParams({
      url: trackUrl,
      color: "#ff5500",
      auto_play: "false",
      hide_related: "true",
      show_comments: "false",
      show_user: "true",
      show_reposts: "false",
      visual: "false"
    }).toString();

  return `
    <div class="soundcloud-player">
      <iframe
        title="SoundCloud player for ${escapeHTML(track.title)}"
        width="100%"
        height="166"
        scrolling="no"
        frameborder="no"
        loading="lazy"
        allow="autoplay"
        src="${escapeHTML(playerUrl)}">
      </iframe>
    </div>
  `;
}

// Render a single recommended track.
function renderTrack(track, index) {
  const trackUrl = safeUrl(track.url);

  const age =
    track.age_days === null || track.age_days === undefined
      ? ""
      : ` · ${Math.floor(track.age_days)} days old`;

  const breakdown = labels.map((name, i) => {
    const value = track.components?.[keys[i]] ?? "N/A";
    return `${escapeHTML(name)} ${escapeHTML(value)}`;
  }).join(" · ");

  return `
    <article class="track">
      <div class="rank">#${index + 1}</div>

      <div class="track-body">
        <a
          href="${escapeHTML(trackUrl)}"
          target="_blank"
          rel="noopener noreferrer">
          ${escapeHTML(track.title)}
        </a>

        <div class="muted">
          ${escapeHTML(track.artist)}${age}
        </div>

        <div class="reason">
          ${escapeHTML(reason(track.signals))}
        </div>

        <div class="breakdown">
          ${breakdown}
        </div>
      </div>

      <div class="score">
        ${escapeHTML(track.score)}
        <small>/100</small>
      </div>

      ${soundcloudPlayer(track)}
    </article>
  `;
}

// Run discovery.
$("discover").addEventListener("click", async () => {
  const urls = [
    ...document.querySelectorAll("#urls input")
  ]
    .map((input) => input.value.trim())
    .filter(Boolean);

  $("error").textContent = "";

  if (urls.length < 1 || urls.length > 5) {
    $("error").textContent =
      "Enter between 1 and 5 SoundCloud artist URLs.";
    return;
  }

  if (new Set(urls).size !== urls.length) {
    $("error").textContent =
      "Please enter distinct artist URLs.";
    return;
  }

  if (urls.some((url) => safeUrl(url) === "#")) {
    $("error").textContent =
      "Please enter valid HTTPS SoundCloud URLs.";
    return;
  }

  if (weights.reduce((sum, value) => sum + value, 0) !== 100) {
    $("error").textContent =
      "Weights must total 100%. Use Balance to 100%.";
    return;
  }

  const button = $("discover");
  button.disabled = true;
  button.textContent = "Discovering…";

  try {
    const response = await fetch("/api/discover", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        urls,
        weights
      })
    });

    const raw = await response.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `The server returned an invalid response (HTTP ${response.status}).`
      );
    }

    if (!response.ok) {
      const detail = data.detail;
      throw new Error(
        typeof detail === "string"
          ? detail
          : JSON.stringify(detail ?? "Discovery failed")
      );
    }

    $("output").hidden = false;

    $("summary").textContent =
      `${data.results.length} results from ` +
      `${data.candidates} candidate tracks · ` +
      `${data.artists.map((artist) => artist.name).join(", ")}`;

    $("results").innerHTML =
      data.results.map(renderTrack).join("") ||
      "<p>No tracks were returned. Try different artists.</p>";

    const notes = [
      ...(data.limitations || []),
      ...(data.warnings || [])
    ];

    $("notes").innerHTML = notes
      .map((note) => `<li>${escapeHTML(note)}</li>`)
      .join("");

    $("output").scrollIntoView({
      behavior: "smooth"
    });

  } catch (error) {
    $("error").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Discover top 20 tracks →";
  }
});
