// ShowSims Admin board. Uses the real Supabase JS client (unlike the public
// site's plain fetch()) because it needs proper auth session handling.
// Access is gated entirely by RLS (see supabase/migrations/0006_admin_system.sql)
// — being logged in isn't enough on its own, the signed-in user must have a row
// in `admins`, so all the reads/writes below simply return empty/fail for anyone
// else rather than needing separate checks here.

const PAGE_SIZE = 10;

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.SHOWSIMS_CONFIG;
const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const elLoginSection = document.getElementById("login-section");
const elDashboard = document.getElementById("dashboard");
const elSessionInfo = document.getElementById("session-info");
const elSessionEmail = document.getElementById("session-email");
const elSignOutBtn = document.getElementById("sign-out-btn");

const elLoginForm = document.getElementById("login-form");
const elLoginError = document.getElementById("login-error");

const elVenuesBody = document.getElementById("venues-tbody");
const elReportsBody = document.getElementById("reports-tbody");
const elBansBody = document.getElementById("bans-tbody");

const elBanForm = document.getElementById("ban-form");
const elBanError = document.getElementById("ban-error");
const elBanOwnerKey = document.getElementById("ban-owner-key");
const elBanOwnerName = document.getElementById("ban-owner-name");
const elBanReason = document.getElementById("ban-reason");
const elBanDuration = document.getElementById("ban-duration");

const elAddAdminForm = document.getElementById("add-admin-form");
const elAddAdminEmail = document.getElementById("add-admin-email");
const elAddAdminMessage = document.getElementById("add-admin-message");

const elReportDialog = document.getElementById("report-dialog");
const elRdVenue = document.getElementById("rd-venue");
const elRdReason = document.getElementById("rd-reason");
const elRdDetails = document.getElementById("rd-details");
const elRdReporter = document.getElementById("rd-reporter");
const elRdWhen = document.getElementById("rd-when");
const elRdStatus = document.getElementById("rd-status");
const elRdError = document.getElementById("rd-error");
const elRdCloseBtn = document.getElementById("rd-close-btn");
const elRdForceDelistBtn = document.getElementById("rd-force-delist-btn");
const elRdBanBtn = document.getElementById("rd-ban-btn");
const elRdResolveBtn = document.getElementById("rd-resolve-btn");

let venuesById = new Map();
let currentReport = null;

// ---- pagination ----------------------------------------------------------
// Each table keeps its full loaded list client-side and just slices/re-renders
// on Prev/Next — these tables are small (single admin's moderation queue), so
// there's no need to re-fetch per page.

function makePaginator(prefix) {
  const state = {
    page: 0,
    allItems: [],
    nav: document.getElementById(`${prefix}-pagination`),
    prevBtn: document.getElementById(`${prefix}-page-prev`),
    nextBtn: document.getElementById(`${prefix}-page-next`),
    indicator: document.getElementById(`${prefix}-page-indicator`),
  };
  state.prevBtn.addEventListener("click", () => {
    state.page = Math.max(0, state.page - 1);
    state.render();
  });
  state.nextBtn.addEventListener("click", () => {
    state.page += 1;
    state.render();
  });
  return state;
}

function paginatorSetItemsAndRender(paginator, items, renderPage) {
  paginator.allItems = items;
  paginator.render = () => {
    const pageCount = Math.max(1, Math.ceil(paginator.allItems.length / PAGE_SIZE));
    paginator.page = Math.min(paginator.page, pageCount - 1);
    const start = paginator.page * PAGE_SIZE;
    const pageItems = paginator.allItems.slice(start, start + PAGE_SIZE);

    paginator.nav.hidden = pageCount <= 1;
    paginator.prevBtn.disabled = paginator.page === 0;
    paginator.nextBtn.disabled = paginator.page >= pageCount - 1;
    paginator.indicator.textContent = `Page ${paginator.page + 1} of ${pageCount}`;

    renderPage(pageItems);
  };
  paginator.render();
}

const venuesPaginator = makePaginator("venues");
const reportsPaginator = makePaginator("reports");
const bansPaginator = makePaginator("bans");

// ---- auth --------------------------------------------------------------

client.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showDashboard(session);
  } else {
    showLogin();
  }
});

function showLogin() {
  elLoginSection.hidden = false;
  elDashboard.hidden = true;
  elSessionInfo.hidden = true;
}

function showDashboard(session) {
  elLoginSection.hidden = true;
  elDashboard.hidden = false;
  elSessionInfo.hidden = false;
  elSessionEmail.textContent = session.user.email;
  loadAll();
}

elLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elLoginError.hidden = true;
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    elLoginError.textContent = error.message;
    elLoginError.hidden = false;
  }
});

elSignOutBtn.addEventListener("click", () => client.auth.signOut());

// ---- data loading --------------------------------------------------------

async function loadAll() {
  await loadVenues();
  await Promise.all([loadReports(), loadBans()]);
}

async function loadVenues() {
  const { data, error } = await client
    .from("venues")
    .select("*")
    .order("published_at", { ascending: false });

  if (error) {
    console.error("loadVenues failed", error);
    return;
  }

  venuesById = new Map(data.map((v) => [v.id, v]));
  paginatorSetItemsAndRender(venuesPaginator, data, renderVenuesPage);
}

function renderVenuesPage(venues) {
  elVenuesBody.innerHTML = "";
  const now = Date.now();

  for (const venue of venues) {
    const active = new Date(venue.expires_at).getTime() > now;
    const tr = document.createElement("tr");

    tr.appendChild(cell(venue.name));
    tr.appendChild(cell(venue.theme));
    tr.appendChild(cell(String(venue.population)));
    tr.appendChild(cell(venue.owner_name || venue.owner_key));

    const statusCell = cell(active ? "Active" : "Expired");
    statusCell.className = active ? "status-active" : "status-expired";
    tr.appendChild(statusCell);

    tr.appendChild(cell(new Date(venue.expires_at).toLocaleString()));

    const actionsCell = document.createElement("td");
    if (active) {
      actionsCell.appendChild(actionButton("Force Delist", () => forceDelist(venue.id)));
    }
    actionsCell.appendChild(actionButton("Ban Owner", () => prefillBan(venue.owner_key, venue.owner_name)));
    tr.appendChild(actionsCell);

    elVenuesBody.appendChild(tr);
  }
}

async function loadReports() {
  const { data, error } = await client
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadReports failed", error);
    return;
  }

  paginatorSetItemsAndRender(reportsPaginator, data, renderReportsPage);
}

function renderReportsPage(reports) {
  elReportsBody.innerHTML = "";
  for (const report of reports) {
    const tr = document.createElement("tr");
    tr.appendChild(cell(report.venue_name));
    tr.appendChild(cell(report.reason));
    tr.appendChild(cell(report.reporter_name || "(anonymous)"));
    tr.appendChild(cell(new Date(report.created_at).toLocaleString()));

    const statusCell = cell(report.status === "open" ? "Open" : "Resolved");
    statusCell.className = report.status === "open" ? "status-active" : "status-expired";
    tr.appendChild(statusCell);

    const actionsCell = document.createElement("td");
    actionsCell.appendChild(actionButton("View", () => openReportDetail(report)));
    tr.appendChild(actionsCell);

    elReportsBody.appendChild(tr);
  }
}

async function loadBans() {
  const { data, error } = await client
    .from("banned_owners")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadBans failed", error);
    return;
  }

  paginatorSetItemsAndRender(bansPaginator, data, renderBansPage);
}

function renderBansPage(bans) {
  elBansBody.innerHTML = "";
  for (const ban of bans) {
    const tr = document.createElement("tr");
    tr.appendChild(cell(ban.owner_name || ban.owner_key));
    tr.appendChild(cell(ban.reason));
    tr.appendChild(cell(ban.banned_until ? new Date(ban.banned_until).toLocaleString() : "Permanent"));
    tr.appendChild(cell(new Date(ban.created_at).toLocaleString()));

    const actionsCell = document.createElement("td");
    actionsCell.appendChild(actionButton("Unban", () => unban(ban.id)));
    tr.appendChild(actionsCell);

    elBansBody.appendChild(tr);
  }
}

// ---- report detail modal --------------------------------------------------

function openReportDetail(report) {
  currentReport = report;
  elRdError.hidden = true;

  elRdVenue.textContent = report.venue_name;
  elRdReason.textContent = report.reason;
  elRdDetails.textContent = report.details || "—";
  elRdReporter.textContent = report.reporter_name || "(anonymous)";
  elRdWhen.textContent = new Date(report.created_at).toLocaleString();
  elRdStatus.textContent = report.status === "open" ? "Open" : "Resolved";

  const venue = report.venue_id ? venuesById.get(report.venue_id) : null;
  elRdForceDelistBtn.hidden = !venue || new Date(venue.expires_at).getTime() <= Date.now();
  elRdBanBtn.hidden = !venue;
  elRdResolveBtn.hidden = report.status !== "open";

  elReportDialog.showModal();
}

elRdCloseBtn.addEventListener("click", () => elReportDialog.close());

elRdForceDelistBtn.addEventListener("click", async () => {
  const venue = venuesById.get(currentReport.venue_id);
  if (!venue) return;
  await forceDelist(venue.id);
  elReportDialog.close();
});

elRdBanBtn.addEventListener("click", () => {
  const venue = venuesById.get(currentReport.venue_id);
  elReportDialog.close();
  if (venue) prefillBan(venue.owner_key, venue.owner_name);
});

elRdResolveBtn.addEventListener("click", async () => {
  const { error } = await client
    .from("reports")
    .update({ status: "reviewed" })
    .eq("id", currentReport.id);
  if (error) {
    elRdError.textContent = "Mark as resolved failed: " + error.message;
    elRdError.hidden = false;
    return;
  }
  elReportDialog.close();
  loadReports();
});

// ---- actions ------------------------------------------------------------

async function forceDelist(venueId) {
  const { error } = await client
    .from("venues")
    .update({ expires_at: new Date().toISOString() })
    .eq("id", venueId);
  if (error) {
    console.error("forceDelist failed", error);
    alert("Force delist failed: " + error.message);
    return;
  }
  loadVenues();
}

function prefillBan(ownerKey, ownerName) {
  elBanOwnerKey.value = ownerKey || "";
  elBanOwnerName.value = ownerName || "";
  elBanReason.focus();
  elBanForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

elBanForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elBanError.hidden = true;

  const durationValue = elBanDuration.value;
  const bannedUntil = durationValue === "permanent"
    ? null
    : new Date(Date.now() + Number(durationValue) * 24 * 3600_000).toISOString();

  const { error } = await client.from("banned_owners").upsert(
    {
      owner_key: elBanOwnerKey.value.trim(),
      owner_name: elBanOwnerName.value.trim() || null,
      reason: elBanReason.value.trim(),
      banned_until: bannedUntil,
    },
    { onConflict: "owner_key" },
  );

  if (error) {
    elBanError.textContent = error.message;
    elBanError.hidden = false;
    return;
  }

  elBanForm.reset();
  await Promise.all([loadBans(), loadVenues()]); // ban cascade may have delisted a venue
});

async function unban(banId) {
  const { error } = await client.from("banned_owners").delete().eq("id", banId);
  if (error) {
    console.error("unban failed", error);
    alert("Unban failed: " + error.message);
    return;
  }
  loadBans();
}

elAddAdminForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elAddAdminMessage.hidden = true;

  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-add-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ email: elAddAdminEmail.value.trim() }),
    });
    const result = await res.json();
    elAddAdminMessage.hidden = false;
    if (result.ok) {
      elAddAdminMessage.textContent = `Invite sent to ${result.email}.`;
      elAddAdminForm.reset();
    } else {
      elAddAdminMessage.textContent = `Failed: ${result.error}${result.message ? " — " + result.message : ""}`;
    }
  } catch (err) {
    elAddAdminMessage.hidden = false;
    elAddAdminMessage.textContent = "Request failed: " + err.message;
  }
});

// ---- small helpers --------------------------------------------------------

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function actionButton(label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-small";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}
