// Simscape static site. Reads the public_venues view via PostgREST using the
// anon key (see docs/config.js). No build step, no framework.

const THEMES = [
  "BDSM", "Club", "Hangout", "Dating", "Roleplay",
  "DJ", "Games", "Adult", "Fetish",
];

// Keep in sync with the venues.maturity CHECK constraint (see
// supabase/migrations/0016_venue_maturity.sql) and MATURITY_RATINGS in
// supabase/functions/_shared/venues.ts.
const MATURITIES = ["General", "Moderate", "Adult"];

// 5 minutes — bounds sustained-tab-open PostgREST bandwidth on the Supabase free
// tier. The refresh button's cooldown (startRefreshCooldown() below) follows this
// same constant automatically, so both stay in sync with a single change here.
const REFRESH_INTERVAL_MS = 300_000;
const PAGE_SIZE = 12;

// Second Life Time is always US Pacific — it follows Pacific's own DST rules,
// so a fixed IANA zone (rather than a fixed UTC offset) keeps this correct
// year-round without any manual adjustment.
const SLT_TIME_ZONE = "America/Los_Angeles";

const { SUPABASE_URL, SUPABASE_ANON_KEY, HUD_MARKETPLACE_URL } = window.SIMSCAPE_CONFIG;

const elGrid = document.getElementById("venue-grid");
const elStatus = document.getElementById("status-message");
const elCount = document.getElementById("venue-count");
const elThemesFilterList = document.getElementById("themes-filter-list");
const elMaturityFilterList = document.getElementById("maturity-filter-list");
const elSearchInput = document.getElementById("search-input");
const elRefreshBtn = document.getElementById("refresh-btn");
const elSortSelect = document.getElementById("sort-select");
const elSltClock = document.getElementById("slt-clock");
const elHudBtn = document.getElementById("hud-btn");
const elPagination = document.getElementById("pagination");
const elPagePrev = document.getElementById("page-prev");
const elPageNext = document.getElementById("page-next");
const elPageIndicator = document.getElementById("page-indicator");
const cardTemplate = document.getElementById("venue-card-template");

const elReportDialog = document.getElementById("report-dialog");
const elReportForm = document.getElementById("report-form");
const elReportVenueName = document.getElementById("report-venue-name");
const elReportReason = document.getElementById("report-reason");
const elReportDetails = document.getElementById("report-details");
const elReportReporterName = document.getElementById("report-reporter-name");
const elReportError = document.getElementById("report-error");
const elReportSuccess = document.getElementById("report-success");
const elReportCancelBtn = document.getElementById("report-cancel-btn");
const elReportFields = document.getElementById("report-fields");
const elReportActions = document.getElementById("report-actions");

const elVenueDetailDialog = document.getElementById("venue-detail-dialog");
const elVdCloseBtn = document.getElementById("vd-close-btn");
const elVdPhotoWrap = document.getElementById("vd-photo-wrap");
const elVdPhoto = document.getElementById("vd-photo");
const elVdMaturityBadge = document.getElementById("vd-maturity-badge");
const elVdName = document.getElementById("vd-name");
const elVdThemes = document.getElementById("vd-themes");
const elVdPopulation = document.getElementById("vd-population");
const elVdRegion = document.getElementById("vd-region");
const elVdMaturity = document.getElementById("vd-maturity");
const elVdPublished = document.getElementById("vd-published");
const elVdExpires = document.getElementById("vd-expires");
const elVdTeleportLink = document.getElementById("vd-teleport-link");

let allVenues = [];
let selectedThemes = new Set();     // empty = no filter, every theme matches
let selectedMaturities = new Set(); // empty = no filter, every rating matches
let sortMode = "population_desc";
let searchQuery = "";
let pageIndex = 0;
let reportingVenue = null;

const SORTERS = {
  population_desc: (a, b) => b.population - a.population,
  population_asc: (a, b) => a.population - b.population,
  name_asc: (a, b) => a.name.localeCompare(b.name),
  // Sorts by each venue's first (primary) theme — a venue has up to 3, no single
  // total order across the set, so the first one picked stands in for the rest.
  theme_asc: (a, b) => a.themes[0].localeCompare(b.themes[0]) || a.name.localeCompare(b.name),
};

function buildFilterCheckbox(value, kind) {
  const wrapper = document.createElement("label");
  wrapper.className = "filter-checkbox";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.addEventListener("change", () => {
    const set = kind === "theme" ? selectedThemes : selectedMaturities;
    if (input.checked) set.add(value);
    else set.delete(value);
    pageIndex = 0;
    render();
  });

  const swatch = document.createElement("span");
  swatch.className = "filter-checkbox-swatch";
  if (kind === "theme") swatch.dataset.theme = value;
  else swatch.dataset.maturity = value;

  wrapper.appendChild(input);
  wrapper.appendChild(swatch);
  wrapper.appendChild(document.createTextNode(value));
  return wrapper;
}

function buildFilterGroups() {
  for (const theme of THEMES) {
    elThemesFilterList.appendChild(buildFilterCheckbox(theme, "theme"));
  }
  for (const maturity of MATURITIES) {
    elMaturityFilterList.appendChild(buildFilterCheckbox(maturity, "maturity"));
  }
}

// Collapsible sidebar filter groups (Themes/Maturity) — static, wired once.
document.querySelectorAll(".filter-group-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = document.getElementById(btn.dataset.target);
    const collapsed = target.classList.toggle("is-collapsed");
    btn.classList.toggle("is-collapsed", collapsed);
    btn.setAttribute("aria-expanded", String(!collapsed));
  });
});

elSortSelect.addEventListener("change", () => {
  sortMode = elSortSelect.value;
  pageIndex = 0;
  render();
});

elSearchInput.addEventListener("input", () => {
  searchQuery = elSearchInput.value.trim().toLowerCase();
  pageIndex = 0;
  render();
});

elPagePrev.addEventListener("click", () => {
  pageIndex = Math.max(0, pageIndex - 1);
  render();
});

elPageNext.addEventListener("click", () => {
  pageIndex += 1;
  render();
});

elRefreshBtn.addEventListener("click", () => loadVenues());

// Disabled for the same REFRESH_INTERVAL_MS window as the automatic refresh below,
// whether triggered by that timer or a manual click — one shared cooldown instead of
// letting manual clicks stack unlimited extra fetches on top of the auto-refresh.
function startRefreshCooldown() {
  elRefreshBtn.disabled = true;
  setTimeout(() => { elRefreshBtn.disabled = false; }, REFRESH_INTERVAL_MS);
}

function setupExternalButton(el, url) {
  if (url) {
    el.href = url;
    el.classList.remove("is-disabled");
    el.removeAttribute("aria-disabled");
  } else {
    el.href = "#";
    el.classList.add("is-disabled");
    el.setAttribute("aria-disabled", "true");
    el.title = "Coming soon";
    el.addEventListener("click", (event) => event.preventDefault());
  }
}

function updateSltClock() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: SLT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(now);
  elSltClock.textContent = `SLT ${time}`;
}

async function loadVenues() {
  startRefreshCooldown();
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

function getFilteredVenues() {
  let filtered = allVenues;
  if (selectedThemes.size > 0) {
    filtered = filtered.filter((v) => v.themes.some((t) => selectedThemes.has(t)));
  }
  if (selectedMaturities.size > 0) {
    filtered = filtered.filter((v) => selectedMaturities.has(v.maturity));
  }
  if (searchQuery) {
    filtered = filtered.filter((v) =>
      v.name.toLowerCase().includes(searchQuery) ||
      v.region_name.toLowerCase().includes(searchQuery));
  }
  return filtered;
}

function render() {
  const filtered = getFilteredVenues();

  elCount.textContent = filtered.length === 1
    ? "1 sim open"
    : `${filtered.length} sims open`;

  if (filtered.length === 0) {
    elGrid.hidden = true;
    elPagination.hidden = true;
    setStatus(
      allVenues.length === 0
        ? "No sims currently open — check back soon."
        : "No open sims match this filter right now.",
    );
    return;
  }
  setStatus("");
  elGrid.hidden = false;

  const sorted = filtered.slice().sort(SORTERS[sortMode]);

  elGrid.innerHTML = "";

  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);
  pageIndex = Math.min(pageIndex, pageCount - 1);
  const start = pageIndex * PAGE_SIZE;
  const pageVenues = sorted.slice(start, start + PAGE_SIZE);

  for (const venue of pageVenues) {
    elGrid.appendChild(renderCard(venue));
  }

  elPagination.hidden = pageCount <= 1;
  elPagePrev.disabled = pageIndex === 0;
  elPageNext.disabled = pageIndex >= pageCount - 1;
  elPageIndicator.textContent = `Page ${pageIndex + 1} of ${pageCount}`;
}

function renderCard(venue) {
  const node = cardTemplate.content.cloneNode(true);
  node.querySelector(".venue-name").textContent = venue.name;

  const badgeContainer = node.querySelector(".theme-badges");
  for (const theme of venue.themes) {
    const badge = document.createElement("span");
    badge.className = "theme-badge";
    badge.textContent = theme;
    badge.dataset.theme = theme;
    badgeContainer.appendChild(badge);
  }

  const photoWrap = node.querySelector(".venue-photo-wrap");
  const photo = node.querySelector(".venue-photo");
  // The gradient fallback background only has room for one color — use the
  // first (primary) theme, same convention as the theme_asc sort.
  photoWrap.dataset.theme = venue.themes[0];
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

  const maturityBadge = node.querySelector(".maturity-badge");
  maturityBadge.textContent = venue.maturity;
  maturityBadge.dataset.maturity = venue.maturity;

  node.querySelector(".population-count").textContent = venue.population;
  node.querySelector(".region-name").textContent = venue.region_name;

  const link = node.querySelector(".teleport-link");
  link.href = venue.slurl;

  node.querySelector(".report-link").addEventListener("click", (event) => {
    event.stopPropagation();
    openReportDialog(venue);
  });

  const card = node.querySelector(".venue-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `View details for ${venue.name}`);
  card.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    openVenueDetailDialog(venue);
  });
  card.addEventListener("keydown", (event) => {
    if (event.target.closest("a, button")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openVenueDetailDialog(venue);
  });

  return node;
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function openVenueDetailDialog(venue) {
  elVdName.textContent = venue.name;

  elVdThemes.innerHTML = "";
  for (const theme of venue.themes) {
    const badge = document.createElement("span");
    badge.className = "theme-badge";
    badge.textContent = theme;
    badge.dataset.theme = theme;
    elVdThemes.appendChild(badge);
  }

  elVdPhotoWrap.dataset.theme = venue.themes[0];
  elVdPhoto.hidden = true;
  elVdPhoto.removeAttribute("src");
  if (venue.photo_texture_uuid) {
    elVdPhoto.src = `https://picture-service.secondlife.com/${venue.photo_texture_uuid}/320x240.jpg`;
    elVdPhoto.hidden = false;
    elVdPhoto.addEventListener("error", () => {
      elVdPhoto.hidden = true;
      elVdPhoto.removeAttribute("src");
    }, { once: true });
  }

  elVdMaturityBadge.textContent = venue.maturity;
  elVdMaturityBadge.dataset.maturity = venue.maturity;

  elVdPopulation.textContent = venue.population;
  elVdRegion.textContent = venue.region_name;
  elVdMaturity.textContent = venue.maturity;
  elVdMaturity.dataset.maturity = venue.maturity;
  elVdPublished.textContent = formatDateTime(venue.published_at);
  elVdExpires.textContent = formatDateTime(venue.expires_at);
  elVdTeleportLink.href = venue.slurl;

  elVenueDetailDialog.showModal();
}

elVdCloseBtn.addEventListener("click", () => elVenueDetailDialog.close());

elVenueDetailDialog.addEventListener("click", (event) => {
  if (event.target === elVenueDetailDialog) elVenueDetailDialog.close();
});

function openReportDialog(venue) {
  reportingVenue = venue;
  elReportVenueName.textContent = `"${venue.name}"`;
  elReportForm.reset();
  elReportError.hidden = true;
  elReportSuccess.hidden = true;
  elReportFields.hidden = false;
  elReportActions.hidden = false;
  elReportDialog.showModal();
}

elReportCancelBtn.addEventListener("click", () => elReportDialog.close());

elReportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elReportError.hidden = true;

  const payload = {
    venue_id: reportingVenue.id,
    venue_name: reportingVenue.name,
    reason: elReportReason.value,
    details: elReportDetails.value.trim() || null,
    reporter_name: elReportReporterName.value.trim() || null,
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    elReportFields.hidden = true;
    elReportActions.hidden = true;
    elReportSuccess.hidden = false;
    setTimeout(() => elReportDialog.close(), 1600);
  } catch (err) {
    console.error("Failed to submit report", err);
    elReportError.textContent = "Couldn't send that report — please try again.";
    elReportError.hidden = false;
  }
});

function setStatus(message) {
  elStatus.textContent = message;
  elStatus.hidden = !message;
}

buildFilterGroups();
setupExternalButton(elHudBtn, HUD_MARKETPLACE_URL);
updateSltClock();
setInterval(updateSltClock, 1000);
loadVenues();
setInterval(loadVenues, REFRESH_INTERVAL_MS);
