// ShowSims static site. Reads the public_venues view via PostgREST using the
// anon key (see docs/config.js). No build step, no framework.

const THEMES = [
  "BDSM", "Club", "Venue", "Hangout", "Dating",
  "Roleplay", "Live Music", "Shopping", "Other",
];

const REFRESH_INTERVAL_MS = 60_000;
const PAGE_SIZE = 12;

// Second Life Time is always US Pacific — it follows Pacific's own DST rules,
// so a fixed IANA zone (rather than a fixed UTC offset) keeps this correct
// year-round without any manual adjustment.
const SLT_TIME_ZONE = "America/Los_Angeles";

const { SUPABASE_URL, SUPABASE_ANON_KEY, HUD_MARKETPLACE_URL, DONATE_URL } = window.SHOWSIMS_CONFIG;

const elGrid = document.getElementById("venue-grid");
const elStatus = document.getElementById("status-message");
const elCount = document.getElementById("venue-count");
const elFilters = document.getElementById("theme-filters");
const elRefreshBtn = document.getElementById("refresh-btn");
const elSortSelect = document.getElementById("sort-select");
const elSltClock = document.getElementById("slt-clock");
const elHudBtn = document.getElementById("hud-btn");
const elDonateBtn = document.getElementById("donate-btn");
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

let allVenues = [];
let activeTheme = "all";
let sortMode = "population_desc";
let pageIndex = 0;
let reportingVenue = null;

const SORTERS = {
  population_desc: (a, b) => b.population - a.population,
  population_asc: (a, b) => a.population - b.population,
  name_asc: (a, b) => a.name.localeCompare(b.name),
  theme_asc: (a, b) => a.theme.localeCompare(b.theme) || a.name.localeCompare(b.name),
};

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
  pageIndex = 0;
  render();
});

elSortSelect.addEventListener("change", () => {
  sortMode = elSortSelect.value;
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
  const filtered = activeTheme === "all"
    ? allVenues.slice()
    : allVenues.filter((v) => v.theme === activeTheme);

  filtered.sort(SORTERS[sortMode]);

  elCount.textContent = filtered.length === 1
    ? "1 venue open"
    : `${filtered.length} venues open`;

  elGrid.innerHTML = "";

  if (filtered.length === 0) {
    elPagination.hidden = true;
    setStatus(
      allVenues.length === 0
        ? "No venues currently open — check back soon."
        : "No open venues match this filter right now.",
    );
    return;
  }
  setStatus("");

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  pageIndex = Math.min(pageIndex, pageCount - 1);
  const start = pageIndex * PAGE_SIZE;
  const pageVenues = filtered.slice(start, start + PAGE_SIZE);

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

  node.querySelector(".report-link").addEventListener("click", () => openReportDialog(venue));

  return node;
}

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

buildThemeFilterChips();
setupExternalButton(elHudBtn, HUD_MARKETPLACE_URL);
setupExternalButton(elDonateBtn, DONATE_URL);
updateSltClock();
setInterval(updateSltClock, 1000);
loadVenues();
setInterval(loadVenues, REFRESH_INTERVAL_MS);
