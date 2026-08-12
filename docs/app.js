// ShowSims static site. Reads the public_venues view via PostgREST using the
// anon key (see docs/config.js). No build step, no framework.

const THEMES = [
  "BDSM", "Club", "Venue", "Hangout", "Dating",
  "Roleplay", "Live Music", "Shopping", "Other",
];

const REFRESH_INTERVAL_MS = 60_000;

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.SHOWSIMS_CONFIG;

const elGrid = document.getElementById("venue-grid");
const elStatus = document.getElementById("status-message");
const elCount = document.getElementById("venue-count");
const elFilters = document.getElementById("theme-filters");
const elRefreshBtn = document.getElementById("refresh-btn");
const cardTemplate = document.getElementById("venue-card-template");

let allVenues = [];
let activeTheme = "all";

function buildThemeFilterChips() {
  for (const theme of THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-chip";
    btn.dataset.theme = theme;
    btn.textContent = theme;
    elFilters.appendChild(btn);
  }
}

elFilters.addEventListener("click", (event) => {
  const btn = event.target.closest(".filter-chip");
  if (!btn) return;
  activeTheme = btn.dataset.theme;
  for (const chip of elFilters.querySelectorAll(".filter-chip")) {
    chip.classList.toggle("is-active", chip === btn);
  }
  render();
});

elRefreshBtn.addEventListener("click", () => loadVenues());

async function loadVenues() {
  setStatus("");
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/public_venues?select=*&order=population.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    allVenues = await res.json();
    render();
  } catch (err) {
    console.error("Failed to load venues", err);
    setStatus("Couldn't load venues right now. Retrying shortly…");
  }
}

function render() {
  const venues = activeTheme === "all"
    ? allVenues
    : allVenues.filter((v) => v.theme === activeTheme);

  elCount.textContent = venues.length === 1
    ? "1 venue open"
    : `${venues.length} venues open`;

  elGrid.innerHTML = "";

  if (venues.length === 0) {
    setStatus(
      allVenues.length === 0
        ? "No venues currently open — check back soon."
        : "No open venues match this filter right now.",
    );
    return;
  }
  setStatus("");

  for (const venue of venues) {
    elGrid.appendChild(renderCard(venue));
  }
}

function renderCard(venue) {
  const node = cardTemplate.content.cloneNode(true);
  node.querySelector(".venue-name").textContent = venue.name;

  const badge = node.querySelector(".theme-badge");
  badge.textContent = venue.theme;
  badge.dataset.theme = venue.theme;

  const photoWrap = node.querySelector(".venue-photo-wrap");
  const photo = node.querySelector(".venue-photo");
  photoWrap.dataset.theme = venue.theme;
  if (venue.photo_texture_uuid) {
    // Second Life's (unofficial, undocumented-by-Linden) Picture Service —
    // converts an SL texture asset to a JPEG thumbnail by UUID. Only fixed
    // sizes exist (max 320x240); not every texture resolves (deleted/invalid
    // assets 404), so fail gracefully rather than showing a broken-image icon.
    photo.src = `https://picture-service.secondlife.com/${venue.photo_texture_uuid}/320x240.jpg`;
    photo.hidden = false;
    photo.addEventListener("error", () => {
      photo.hidden = true;
      photo.removeAttribute("src");
    });
  }

  node.querySelector(".population-count").textContent = venue.population;
  node.querySelector(".region-name").textContent = venue.region_name;

  const link = node.querySelector(".teleport-link");
  link.href = venue.slurl;

  return node;
}

function setStatus(message) {
  elStatus.textContent = message;
  elStatus.hidden = !message;
}

buildThemeFilterChips();
loadVenues();
setInterval(loadVenues, REFRESH_INTERVAL_MS);
