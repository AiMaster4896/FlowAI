// assets/js/dashboard.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isFirmAdmin } from "./permissions.js";
import { STATUS_LABELS, renderWorkOrdersTable, getOrderTypeLabel, getDashboardChartTypes, loadOrgWorkOrderTypes } from "./work-orders.js";
import { openClientDetailsById } from "./clients.js";
import { fetchAllRows, paginationHtml, wirePagination } from "./excel-utils.js";

const STATUS_COLORS = { not_started: "#9aa3b2", in_progress: "#f59e0b", completed: "#16a34a" };
const TYPE_COLORS = { audit: "#2563eb", tax: "#059669", accounting: "#7c3aed", adhoc: "#ca8a04", invoice_request: "#db2777" };
const EXTRA_TYPE_COLOR_PALETTE = ["#0891b2", "#65a30d", "#c026d3", "#ea580c", "#0d9488", "#9333ea", "#16a34a", "#dc2626", "#4f46e5"];

function buildTypeColorMap(types) {
  const map = { ...TYPE_COLORS };
  const usedColors = new Set(Object.values(map));
  let paletteIndex = 0;
  types.forEach((key) => {
    if (map[key]) return; // already has a fixed built-in colour
    // Find the next palette colour that isn't already in use by another type
    while (usedColors.has(EXTRA_TYPE_COLOR_PALETTE[paletteIndex % EXTRA_TYPE_COLOR_PALETTE.length]) && paletteIndex < EXTRA_TYPE_COLOR_PALETTE.length * 2) {
      paletteIndex++;
    }
    const color = EXTRA_TYPE_COLOR_PALETTE[paletteIndex % EXTRA_TYPE_COLOR_PALETTE.length];
    map[key] = color;
    usedColors.add(color);
    paletteIndex++;
  });
  return map;
}
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let dashOrgMembersCache = [];
let dashWorkOrdersCache = [];
let dashDeadlinesCache = [];
let dashClientTeamMap = {}; // client_id -> team_id
let dashTeamsByBranch = {}; // team_id -> branch_id
let dashChartBranchFilter = "";
let dashChartTeamFilter = "";
let selectedStaffId = "";
let selectedBranchId = "";
let selectedTeamId = "";

let dashDeadlineTablePage = 1;
let dashDeadlinePageSize = 10;

function monthKey(y, m) { return `${y}-${String(m).padStart(2, "0")}`; } // m is 1-12

// A deadline that falls on the 1st of a month (common for "N days before
// year end" rules on a 31-day FYE month) would otherwise show in that
// month's own column, making it look like there's a full month of
// leeway when there's actually almost none. Bucket it into the prior
// month instead so the chart reflects the real urgency.
function bucketKeyFor(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (d !== 1) return dateStr.slice(0, 7);
  const prev = new Date(y, m - 2, 1); // m is 1-indexed; m-2 gives the prior month in JS's 0-indexed scheme
  return monthKey(prev.getFullYear(), prev.getMonth() + 1);
}

// Only these three types are shown on this chart, per request — Form E and
// the CP204A revisions are excluded.
const CHART_TYPES = ["Audit", "Form C", "CP204"];
const CHART_TYPE_ABBR = { "Audit": "Aud", "Form C": "C", "CP204": "204" };

function deadlineProgress(d) {
  if (d.status === "completed") return "completed";
  if (d.work_orders?.status === "in_progress") return "in_progress";
  return "not_started";
}

function renderStaffSummaryCards() {
  const wrap = document.getElementById("dash-staff-summary");
  if (!wrap) return;
  const selfId = getIdentity()?.user?.id;
  const todayStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const mine = dashWorkOrdersCache.filter((wo) => wo.assigned_user_id === selfId);
  const dueThisMonthList = mine.filter((wo) => wo.status !== "completed" && wo.deadline_date && wo.deadline_date >= monthStart && wo.deadline_date <= monthEnd);
  const overdueList = mine.filter((wo) => wo.status !== "completed" && wo.deadline_date && wo.deadline_date < todayStr);
  const totalFee = mine.reduce((sum, wo) => sum + (Number(wo.budget_fee) || 0), 0);

  wrap.innerHTML = `
    ${kpiCard("Total Work Orders", mine.length, "staff-total")}
    ${kpiCard("Due This Month", dueThisMonthList.length, "staff-due-month")}
    ${kpiCard("Overdue Work Orders", overdueList.length, "staff-overdue")}
    ${kpiCard("Total Fee", `$${totalFee.toLocaleString()}`, "staff-total-fee")}
  `;

  document.getElementById("kpi-card-staff-total").addEventListener("click", () => showDetails("My Work Orders", mine));
  document.getElementById("kpi-card-staff-due-month").addEventListener("click", () => showDetails("My Work Orders — Due This Month", dueThisMonthList));
  document.getElementById("kpi-card-staff-overdue").addEventListener("click", () => showDetails("My Work Orders — Overdue", overdueList));
  document.getElementById("kpi-card-staff-total-fee").addEventListener("click", () => showDetails("My Work Orders — Total Fee", mine));
}

async function renderDueDeadlinesChart(wrap) {
  const today = new Date();
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`, isCurrent: i === 0 });
  }

  const BAR_HEIGHT = 160;
  const relevant = dashDeadlinesCache.filter((d) => {
    if (!CHART_TYPES.includes(d.deadline_type)) return false;
    if (d.status === "not_applicable") return false;
    const team = dashClientTeamMap[d.client_id];
    if (dashChartTeamFilter && team !== dashChartTeamFilter) return false;
    if (dashChartBranchFilter && (!team || dashTeamsByBranch[team] !== dashChartBranchFilter)) return false;
    return true;
  });

  // Build counts[monthKey][type] = { completed, in_progress, not_started }
  const counts = {};
  months.forEach(({ year, month }) => {
    const key = monthKey(year, month);
    counts[key] = {};
    CHART_TYPES.forEach((t) => { counts[key][t] = { completed: 0, in_progress: 0, not_started: 0 }; });
  });
  relevant.forEach((d) => {
    if (!d.deadline_date) return;
    const key = bucketKeyFor(d.deadline_date);
    if (!counts[key]) return;
    counts[key][d.deadline_type][deadlineProgress(d)]++;
  });

  const max = Math.max(1, ...Object.values(counts).flatMap((byType) => Object.values(byType).map((c) => c.completed + c.in_progress + c.not_started)));

  function segmentsHtml(year, month, type, c, notStartedColor) {
    const seg = (status, count, color) => count
      ? `<div class="chart-col-segment chart-seg-clickable" data-seg-year="${year}" data-seg-month="${month}" data-seg-type="${type}" data-seg-status="${status}" style="height:${(count / max) * BAR_HEIGHT}px;background:${color};" title="${type} — ${status.replace("_", " ")}: ${count}"></div>`
      : "";
    return seg("completed", c.completed, "var(--green-600)") + seg("in_progress", c.in_progress, "#f59e0b") + seg("not_started", c.not_started, notStartedColor);
  }

  wrap.innerHTML = `
    <div class="grouped-chart-wrap">
      ${months.map(({ year, month, label, isCurrent }) => {
        const key = monthKey(year, month);
        const notStartedColor = isCurrent ? "#dc2626" : "#cbd5e1";
        return `
        <div class="grouped-chart-month">
          <div class="grouped-chart-bars" style="height:${BAR_HEIGHT}px;">
            ${CHART_TYPES.map((t) => `
              <div class="chart-column" title="${t}">
                ${segmentsHtml(year, month, t, counts[key][t], notStartedColor)}
              </div>`).join("")}
          </div>
          <div class="grouped-chart-type-labels">
            ${CHART_TYPES.map((t) => `<span>${CHART_TYPE_ABBR[t]}</span>`).join("")}
          </div>
          <div class="grouped-chart-month-label">${label}</div>
        </div>`;
      }).join("")}
    </div>
    <div style="display:flex;gap:16px;margin-top:14px;font-size:12px;color:var(--gray-600);flex-wrap:wrap;">
      <span><span class="pie-legend-swatch" style="background:var(--green-600);display:inline-block;"></span> Completed</span>
      <span><span class="pie-legend-swatch" style="background:#f59e0b;display:inline-block;"></span> In Progress</span>
      <span><span class="pie-legend-swatch" style="background:#dc2626;display:inline-block;"></span> Not Started (this month)</span>
      <span><span class="pie-legend-swatch" style="background:#cbd5e1;display:inline-block;"></span> Not Started (later months)</span>
    </div>
  `;

  wrap.querySelectorAll("[data-seg-year]").forEach((seg) => {
    seg.addEventListener("click", () => {
      const y = Number(seg.dataset.segYear), m = Number(seg.dataset.segMonth);
      const type = seg.dataset.segType, status = seg.dataset.segStatus;
      const key = monthKey(y, m);
      const label = months.find((mo) => mo.year === y && mo.month === m).label;
      const statusLabel = status === "completed" ? "Completed" : status === "in_progress" ? "In Progress" : "Not Started";
      renderDeadlineFilteredTable(
        `${type} — ${statusLabel} — ${label}`,
        (d) => {
          if (d.deadline_type !== type || d.status === "not_applicable" || !d.deadline_date || bucketKeyFor(d.deadline_date) !== key || deadlineProgress(d) !== status) return false;
          const team = dashClientTeamMap[d.client_id];
          if (dashChartTeamFilter && team !== dashChartTeamFilter) return false;
          if (dashChartBranchFilter && (!team || dashTeamsByBranch[team] !== dashChartBranchFilter)) return false;
          return true;
        }
      );
    });
  });
}

async function renderOverdueChart(wrap) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const today = new Date();
  const overdue = dashDeadlinesCache.filter((d) => {
    if (d.status === "completed" || d.status === "not_applicable" || d.deadline_date >= todayStr) return false;
    if (!["Audit", "Form C"].includes(d.deadline_type)) return false;
    const team = dashClientTeamMap[d.client_id];
    if (dashChartTeamFilter && team !== dashChartTeamFilter) return false;
    if (dashChartBranchFilter && (!team || dashTeamsByBranch[team] !== dashChartBranchFilter)) return false;
    return true;
  });

  if (!overdue.length) {
    wrap.innerHTML = `<div class="empty-state">Nothing overdue right now.</div>`;
    return;
  }

  function ageingBucket(deadlineDate) {
    const days = Math.floor((today - new Date(deadlineDate)) / (1000 * 60 * 60 * 24));
    if (days <= 30) return "1-30";
    if (days <= 90) return "31-90";
    return "91+";
  }

  const buckets = ["1-30", "31-90", "91+"];
  const bucketLabels = { "1-30": "Overdue 1-30 days", "31-90": "Overdue 31-90 days", "91+": "Overdue 91+ days" };
  const types = ["Audit", "Form C"];
  const counts = {};
  types.forEach((t) => { counts[t] = { "1-30": 0, "31-90": 0, "91+": 0 }; });
  overdue.forEach((d) => { counts[d.deadline_type][ageingBucket(d.deadline_date)]++; });

  const max = Math.max(1, ...types.flatMap((t) => buckets.map((b) => counts[t][b])));
  const bucketColors = { "1-30": "#f59e0b", "31-90": "#ea580c", "91+": "#dc2626" };

  wrap.innerHTML = types.map((t) => `
    <p class="option-label" style="margin:${t === types[0] ? "0" : "16px"} 0 6px;">${t}</p>
    <div class="bar-chart">
      ${buckets.map((b) => `
        <div class="bar-row bar-row-clickable" data-overdue-type="${t}" data-overdue-bucket="${b}">
          <span class="bar-label">${bucketLabels[b]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(counts[t][b] / max) * 100}%;background:${bucketColors[b]};"></div></div>
          <span class="bar-value">${counts[t][b]}</span>
        </div>`).join("")}
    </div>
  `).join("");

  wrap.querySelectorAll("[data-overdue-type]").forEach((row) => {
    row.addEventListener("click", () => {
      const type = row.dataset.overdueType;
      const bucket = row.dataset.overdueBucket;
      renderDeadlineFilteredTable(
        `Overdue — ${type} — ${bucketLabels[bucket]}`,
        (d) => {
          if (d.status === "completed" || d.status === "not_applicable" || d.deadline_date >= todayStr) return false;
          if (d.deadline_type !== type || ageingBucket(d.deadline_date) !== bucket) return false;
          const team = dashClientTeamMap[d.client_id];
          if (dashChartTeamFilter && team !== dashChartTeamFilter) return false;
          if (dashChartBranchFilter && (!team || dashTeamsByBranch[team] !== dashChartBranchFilter)) return false;
          return true;
        }
      );
    });
  });
}

function renderDeadlineFilteredTable(title, filterFn) {
  dashDeadlineTablePage = 1;
  dashDeadlinePageSize = 10;
  const card = document.getElementById("dash-deadline-table-card");
  card.style.display = "";
  document.getElementById("dash-deadline-table-title").textContent = title;
  paintDeadlineTablePage(filterFn);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function paintDeadlineTablePage(filterFn) {
  const wrap = document.getElementById("dash-deadline-table-wrap");
  const matches = dashDeadlinesCache.filter(filterFn).sort((a, b) => (a.deadline_date || "").localeCompare(b.deadline_date || ""));

  if (!matches.length) {
    wrap.innerHTML = `<div class="empty-state">No matching deadlines.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(matches.length / dashDeadlinePageSize));
  dashDeadlineTablePage = Math.min(Math.max(1, dashDeadlineTablePage), totalPages);
  const start = (dashDeadlineTablePage - 1) * dashDeadlinePageSize;
  const pageRows = matches.slice(start, start + dashDeadlinePageSize);

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Client</th><th>Type</th><th>Financial Year</th><th>Due Date</th><th>Status</th><th>WO Number</th><th>Created</th><th>Remark</th></tr></thead>
      <tbody>
        ${pageRows.map((d) => `<tr class="clickable-row" data-client-id="${d.client_id}">
          <td>${d.clients?.legal_name || "-"}</td>
          <td>${d.deadline_type}</td>
          <td>FY${d.financial_year}</td>
          <td>${isoToDMYDash(d.deadline_date)}</td>
          <td><span class="status-badge ${d.status === "completed" ? "status-completed" : "status-wip"}">${d.status === "completed" ? "Completed" : "Pending"}</span></td>
          <td style="font-family:monospace;font-size:12px;">${d.work_orders?.work_order_number || "-"}</td>
          <td>${d.work_orders?.created_at ? isoToDMYDash(d.work_orders.created_at.slice(0, 10)) : "-"}</td>
          <td>${d.clients?.remark || "-"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${paginationHtml("dash-deadline", dashDeadlineTablePage, dashDeadlinePageSize, matches.length)}
  `;

  wrap.querySelectorAll("[data-client-id]").forEach((tr) => {
    tr.addEventListener("click", () => openClientDetailsById(tr.dataset.clientId));
  });
  wirePagination("dash-deadline", {
    onPrev: () => { dashDeadlineTablePage--; paintDeadlineTablePage(filterFn); },
    onNext: () => { dashDeadlineTablePage++; paintDeadlineTablePage(filterFn); },
    onPageSizeChange: (size) => { dashDeadlinePageSize = size; dashDeadlineTablePage = 1; paintDeadlineTablePage(filterFn); },
  });
}

export async function renderDashboard(el) {
  const identity = getIdentity();
  const isStaffView = identity?.role === "staff";

  el.innerHTML = `
    <div class="page-header">
      <h1>${isStaffView ? `Welcome back, ${identity?.profile?.display_name || identity?.profile?.email || "there"}` : "Dashboard"}</h1>
    </div>
    ${isStaffView ? `<div id="dash-staff-summary" class="kpi-grid"></div>` : ""}
    <div style="display:flex;gap:20px;align-items:stretch;flex-wrap:wrap;">
      <div class="import-card" style="flex:7 1 500px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <h3 style="margin-top:0;">Audit / Form C / CP204 — Next 12 Months</h3>
            <p class="hint" style="margin-top:0;">Click a colour segment to list those deadlines below.</p>
          </div>
          <div style="display:flex;gap:8px;">
            <select id="dash-chart-branch-filter" class="filter-select">
              <option value="">All Branches</option>
            </select>
            <select id="dash-chart-team-filter" class="filter-select">
              <option value="">All Teams</option>
            </select>
          </div>
        </div>
        <div id="dash-due-chart">Loading...</div>
      </div>
      <div class="import-card" style="flex:3 1 260px;">
        <h3 style="margin-top:0;">Overdue</h3>
        <p class="hint" style="margin-top:0;">Audit and Form C only, broken down by how overdue — follows the Branch/Team filter above. Click a bar to list those deadlines below.</p>
        <div id="dash-overdue-chart">Loading...</div>
      </div>
    </div>
    <div class="import-card" id="dash-deadline-table-card" style="display:none;">
      <h3 style="margin-top:0;" id="dash-deadline-table-title">Deadlines</h3>
      <div id="dash-deadline-table-wrap"></div>
    </div>
    <div class="import-card">
      <div style="display:flex;flex-wrap:wrap;gap:16px;">
        <label style="font-size:13px;font-weight:600;color:var(--gray-600);display:flex;align-items:center;gap:8px;">
          Filter by Staff:
          <select id="dash-staff-filter" class="filter-select">
            <option value="">All Staff</option>
          </select>
        </label>
        <label style="font-size:13px;font-weight:600;color:var(--gray-600);display:flex;align-items:center;gap:8px;">
          Filter by Branch:
          <select id="dash-branch-filter" class="filter-select">
            <option value="">All Branches</option>
          </select>
        </label>
        <label style="font-size:13px;font-weight:600;color:var(--gray-600);display:flex;align-items:center;gap:8px;">
          Filter by Team:
          <select id="dash-team-filter" class="filter-select">
            <option value="">All Teams</option>
          </select>
        </label>
      </div>
    </div>
    <div class="kpi-grid" id="kpi-grid">
      <div class="kpi-card skeleton"></div>
      <div class="kpi-card skeleton"></div>
      <div class="kpi-card skeleton"></div>
      <div class="kpi-card skeleton"></div>
    </div>
    <div class="wo-summary-grid" id="wo-summary-grid"></div>
    ${isStaffView ? "" : `
    <div class="import-card">
      <h3 style="margin-top:0;">Work Orders by Staff</h3>
      <p class="hint">Click a staff member to see their work orders below.</p>
      <div id="wo-by-staff-table">Loading...</div>
    </div>
    <div class="import-card">
      <h3 style="margin-top:0;">Budget Fee by Staff — ${new Date().getFullYear()}</h3>
      <p class="hint">Total budget fee per staff member, by month (Audit/Tax/Accounting/Adhoc work orders — Request for Invoice isn't included here since it tracks Professional Fee/OPE separately). Grouped by each work order's deadline month.</p>
      <div id="budget-fee-table">Loading...</div>
    </div>
    <div class="import-card">
      <h3 style="margin-top:0;">Outstanding Work Orders by Month</h3>
      <p class="hint">Click a bar to see which work orders fall in that month.</p>
      <div id="wo-by-month-chart"></div>
    </div>
    `}
    <div class="import-card hidden" id="wo-details-card">
      <h3 id="wo-details-title" style="margin-top:0;">Details</h3>
      <div id="wo-details-filters"></div>
      <div id="wo-details-table"></div>
    </div>
  `;

  const orgId = identity?.organisationId;
  if (!orgId) return;

  const [{ data: deadlines }, { data: members }, { data: allWO }, { data: clientsData }, { data: teamsData }, { data: branchesData }] =
    await Promise.all([
      fetchAllRows(supabase.from("client_deadlines").select("id, deadline_type, deadline_date, financial_year, status, completed_date, work_order_id, client_id, clients(legal_name, remark), work_orders(status, work_order_number, created_at)").eq("organisation_id", orgId)),
      supabase.from("organisation_members").select("user_id, team_id, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active").eq("is_working_staff", true),
      fetchAllRows(supabase
        .from("work_orders")
        .select("id, order_type, work_order_number, created_at, current_step_label, audit_report_date, archival_date, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, partner_user_id, manager_user_id, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email), manager:profiles!manager_user_id(display_name, email)")
        .eq("organisation_id", orgId)),
      supabase.from("clients").select("id, team_id").eq("organisation_id", orgId),
      supabase.from("teams").select("id, name, branch_id").eq("organisation_id", orgId).order("name"),
      supabase.from("branches").select("id, name").eq("organisation_id", orgId).order("name"),
    ]);

  dashClientTeamMap = Object.fromEntries((clientsData || []).map((c) => [c.id, c.team_id]));
  dashTeamsByBranch = Object.fromEntries((teamsData || []).map((t) => [t.id, t.branch_id]));
  const branchSelect = document.getElementById("dash-chart-branch-filter");
  const teamSelect = document.getElementById("dash-chart-team-filter");
  if (branchSelect) branchSelect.innerHTML = `<option value="">All Branches</option>${(branchesData || []).map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}`;
  if (teamSelect) teamSelect.innerHTML = `<option value="">All Teams</option>${(teamsData || []).map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}`;
  if (branchSelect) branchSelect.addEventListener("change", (e) => {
    dashChartBranchFilter = e.target.value;
    renderDueDeadlinesChart(document.getElementById("dash-due-chart"));
    renderOverdueChart(document.getElementById("dash-overdue-chart"));
  });
  if (teamSelect) teamSelect.addEventListener("change", (e) => {
    dashChartTeamFilter = e.target.value;
    renderDueDeadlinesChart(document.getElementById("dash-due-chart"));
    renderOverdueChart(document.getElementById("dash-overdue-chart"));
  });

  await loadOrgWorkOrderTypes(orgId);
  dashDeadlinesCache = deadlines || [];
  dashOrgMembersCache = members || [];
  dashWorkOrdersCache = allWO || [];

  if (isStaffView) renderStaffSummaryCards();

  // Staff/manager should only ever see other staff within their own scope,
  // never the whole firm — admin still sees everyone.
  if (!isFirmAdmin()) {
    const selfId = getIdentity()?.user?.id;
    const [{ data: myTeamGrants }, { data: myBranchGrants }] = await Promise.all([
      supabase.from("user_team_access").select("team_id").eq("user_id", selfId),
      supabase.from("user_branch_access").select("branch_id").eq("user_id", selfId),
    ]);
    const myTeams = new Set((myTeamGrants || []).map((r) => r.team_id));
    const myBranches = new Set((myBranchGrants || []).map((r) => r.branch_id));
    dashOrgMembersCache = dashOrgMembersCache.filter((m) => {
      if (m.user_id === selfId) return true;
      if (!m.team_id) return false;
      if (myTeams.has(m.team_id)) return true;
      const branchOfTeam = dashTeamsByBranch[m.team_id];
      return branchOfTeam && myBranches.has(branchOfTeam);
    });
  }

  await renderDueDeadlinesChart(document.getElementById("dash-due-chart"));
  await renderOverdueChart(document.getElementById("dash-overdue-chart"));

  const staffSelect = document.getElementById("dash-staff-filter");
  staffSelect.innerHTML = `<option value="">All Staff</option>${dashOrgMembersCache.map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}`;

  const kpiBranchSelect = document.getElementById("dash-branch-filter");
  const kpiTeamSelect = document.getElementById("dash-team-filter");
  kpiBranchSelect.innerHTML = `<option value="">All Branches</option>${(branchesData || []).map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}`;
  kpiTeamSelect.innerHTML = `<option value="">All Teams</option>${(teamsData || []).map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}`;

  function refreshFilteredSections() {
    renderKpis();
    renderStatusTypeCharts();
    renderMonthChart();
    renderBudgetFeeByStaff();
    renderStaffSummary();
    document.getElementById("wo-details-card").classList.add("hidden");
  }

  staffSelect.addEventListener("change", (e) => { selectedStaffId = e.target.value; refreshFilteredSections(); });
  kpiBranchSelect.addEventListener("change", (e) => { selectedBranchId = e.target.value; refreshFilteredSections(); });
  kpiTeamSelect.addEventListener("change", (e) => { selectedTeamId = e.target.value; refreshFilteredSections(); });

  renderKpis();
  renderStatusTypeCharts();
  renderStaffSummary();
  renderBudgetFeeByStaff();
  renderMonthChart();
}

function filteredOrders() {
  return dashWorkOrdersCache.filter((wo) => {
    if (selectedStaffId && wo.assigned_user_id !== selectedStaffId) return false;
    const team = dashClientTeamMap[wo.client_id];
    if (selectedTeamId && team !== selectedTeamId) return false;
    if (selectedBranchId && (!team || dashTeamsByBranch[team] !== selectedBranchId)) return false;
    return true;
  });
}

function renderKpis() {
  const openDeadlines = dashDeadlinesCache.filter((d) => d.status !== "completed" && d.status !== "not_applicable");
  const todayStrKpi = new Date().toISOString().slice(0, 10);
  const overdueDeadlines = dashDeadlinesCache.filter((d) => d.status !== "completed" && d.status !== "not_applicable" && d.deadline_date < todayStrKpi);
  const completedDeadlines = dashDeadlinesCache.filter((d) => d.status === "completed");
  const openWO = filteredOrders().filter((wo) => wo.status !== "completed");

  document.getElementById("kpi-grid").innerHTML = `
    ${kpiCard("Total Open Deadlines", openDeadlines.length, "open-deadlines")}
    ${kpiCard("Overdue", overdueDeadlines.length, "overdue-deadlines")}
    ${kpiCard("Completed", completedDeadlines.length, "completed-deadlines")}
    ${kpiCard("Open Work Orders", openWO.length, "open-work-orders")}
  `;

  document.getElementById("kpi-card-open-deadlines").addEventListener("click", () => showDeadlineDetails("Total Open Deadlines", openDeadlines));
  document.getElementById("kpi-card-overdue-deadlines").addEventListener("click", () => showDeadlineDetails("Overdue Deadlines", overdueDeadlines));
  document.getElementById("kpi-card-completed-deadlines").addEventListener("click", () => showDeadlineDetails("Completed Deadlines", completedDeadlines));
  document.getElementById("kpi-card-open-work-orders").addEventListener("click", () => showDetails("Open Work Orders", openWO));
}

function kpiCard(label, value, key) {
  return `<div class="kpi-card kpi-card-clickable" id="kpi-card-${key}"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`;
}

function renderStatusTypeCharts() {
  const statusCounts = { not_started: 0, in_progress: 0, completed: 0 };
  const dashboardTypes = getDashboardChartTypes();
  const typeCounts = Object.fromEntries(dashboardTypes.map((k) => [k, 0]));
  const typeLabels = Object.fromEntries(dashboardTypes.map((k) => [k, getOrderTypeLabel(k)]));
  const typeColors = buildTypeColorMap(dashboardTypes);
  filteredOrders().forEach((wo) => {
    if (wo.status in statusCounts) statusCounts[wo.status]++;
    if (wo.order_type in typeCounts) typeCounts[wo.order_type]++;
  });

  document.getElementById("wo-summary-grid").innerHTML = `
    ${barChartCard("Work Orders by Status", statusCounts, STATUS_LABELS, STATUS_COLORS, "chart-by-status")}
    ${barChartCard("Work Orders by Type", typeCounts, typeLabels, typeColors, "chart-by-type")}
  `;

  document.querySelectorAll("#chart-by-status [data-bar-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.barKey;
      showDetails(`Work Orders — ${STATUS_LABELS[key]}`, filteredOrders().filter((wo) => wo.status === key));
    });
  });
  document.querySelectorAll("#chart-by-type [data-bar-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.barKey;
      showDetails(`Work Orders — ${getOrderTypeLabel(key)}`, filteredOrders().filter((wo) => wo.order_type === key));
    });
  });
}

function barChartCard(title, dataObj, labelMap, colorMap, chartId) {
  const entries = Object.entries(dataObj);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return `
    <div class="import-card">
      <h3 style="margin-top:0;">${title}</h3>
      <div class="bar-chart" ${chartId ? `id="${chartId}"` : ""}>
        ${entries
          .map(
            ([key, val]) => `
          <div class="bar-row ${chartId ? "bar-row-clickable" : ""}" ${chartId ? `data-bar-key="${key}"` : ""}>
            <span class="bar-label">${labelMap[key] || key}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(val / max) * 100}%;background:${colorMap[key] || "var(--blue-600)"};"></div></div>
            <span class="bar-value">${val}</span>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function renderBudgetFeeByStaff() {
  const wrap = document.getElementById("budget-fee-table");
  if (!wrap) return;
  const year = new Date().getFullYear();
  const totals = {}; // { userId: [jan..dec] }

  dashWorkOrdersCache.forEach((wo) => {
    if (wo.order_type === "invoice_request") return;
    if (wo.budget_fee == null || !wo.deadline_date || !wo.assigned_user_id) return;
    const team = dashClientTeamMap[wo.client_id];
    if (selectedTeamId && team !== selectedTeamId) return;
    if (selectedBranchId && (!team || dashTeamsByBranch[team] !== selectedBranchId)) return;
    const d = new Date(wo.deadline_date + "T00:00:00");
    if (d.getFullYear() !== year) return;
    totals[wo.assigned_user_id] = totals[wo.assigned_user_id] || Array(12).fill(0);
    totals[wo.assigned_user_id][d.getMonth()] += Number(wo.budget_fee);
  });

  const members = selectedStaffId ? dashOrgMembersCache.filter((m) => m.user_id === selectedStaffId) : dashOrgMembersCache;
  const rows = members.map((m) => {
    const months = totals[m.user_id] || Array(12).fill(0);
    return { name: m.profiles?.display_name || m.profiles?.email, months, total: months.reduce((a, b) => a + b, 0) };
  });

  if (!rows.some((r) => r.total > 0)) {
    wrap.innerHTML = `<div class="empty-state">No budget fees recorded for ${year} yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Staff</th>
        ${MONTH_ABBR.map((m) => `<th>${m}</th>`).join("")}
        <th>Total</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td><strong>${r.name}</strong></td>
              ${r.months.map((v) => `<td>${v > 0 ? `$${v.toLocaleString()}` : "-"}</td>`).join("")}
              <td><strong>${r.total > 0 ? `$${r.total.toLocaleString()}` : "-"}</strong></td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderStaffSummary() {
  const wrap = document.getElementById("wo-by-staff-table");
  if (!wrap) return;
  const scopedMembers = dashOrgMembersCache.filter((m) => {
    if (selectedTeamId && m.team_id !== selectedTeamId) return false;
    if (selectedBranchId && (!m.team_id || dashTeamsByBranch[m.team_id] !== selectedBranchId)) return false;
    return true;
  });
  const rows = scopedMembers.map((m) => {
    const mine = dashWorkOrdersCache.filter((wo) => wo.assigned_user_id === m.user_id);
    const outstanding = mine.filter((wo) => wo.status !== "completed").length;
    return { userId: m.user_id, name: m.profiles?.display_name || m.profiles?.email, total: mine.length, outstanding, completed: mine.length - outstanding };
  });

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state">No staff yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Staff</th><th>Total Work Orders</th><th>Outstanding</th><th>Completed</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr class="clickable-row" data-staff-row="${r.userId}">
              <td><strong>${r.name}</strong></td>
              <td>${r.total}</td>
              <td>${r.outstanding}</td>
              <td>${r.completed}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-staff-row]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const staff = rows.find((r) => r.userId === tr.dataset.staffRow);
      const orders = dashWorkOrdersCache.filter((wo) => wo.assigned_user_id === tr.dataset.staffRow);
      showDetails(`Work Orders — ${staff.name}`, orders);
    });
  });
}

function renderMonthChart() {
  const wrap = document.getElementById("wo-by-month-chart");
  if (!wrap) return;
  const outstanding = filteredOrders().filter((wo) => wo.status !== "completed" && wo.deadline_date);

  const byMonth = {};
  outstanding.forEach((wo) => {
    const d = new Date(wo.deadline_date + "T00:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = byMonth[key] || { label: `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`, count: 0 };
    byMonth[key].count++;
  });

  const sortedKeys = Object.keys(byMonth).sort();
  if (!sortedKeys.length) {
    wrap.innerHTML = `<div class="empty-state">No outstanding work orders with a deadline.</div>`;
    return;
  }
  const max = Math.max(1, ...sortedKeys.map((k) => byMonth[k].count));

  wrap.innerHTML = `
    <div class="bar-chart">
      ${sortedKeys
        .map(
          (k) => `
        <div class="bar-row bar-row-clickable" data-month-key="${k}">
          <span class="bar-label">${byMonth[k].label}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(byMonth[k].count / max) * 100}%;background:var(--blue-600);"></div></div>
          <span class="bar-value">${byMonth[k].count}</span>
        </div>`
        )
        .join("")}
    </div>
  `;

  wrap.querySelectorAll("[data-month-key]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.monthKey;
      const orders = outstanding.filter((wo) => {
        const d = new Date(wo.deadline_date + "T00:00:00");
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === key;
      });
      showDetails(`Outstanding Work Orders — ${byMonth[key].label}`, orders);
    });
  });
}

let woDetailsFullList = [];
let woDetailsFilters = { type: "", partner: "", staff: "", search: "" };
let woDetailsPage = 1;
let woDetailsPageSize = 10;

function showDetails(title, orders) {
  const card = document.getElementById("wo-details-card");
  document.getElementById("wo-details-title").textContent = title;
  card.classList.remove("hidden");

  woDetailsFullList = orders;
  woDetailsFilters = { type: "", partner: "", staff: "", search: "" };
  woDetailsPage = 1;
  woDetailsPageSize = 10;

  const types = [...new Set(orders.map((wo) => wo.order_type).filter(Boolean))];
  const partners = [];
  const seenPartnerIds = new Set();
  orders.forEach((wo) => {
    if (wo.partner_user_id && !seenPartnerIds.has(wo.partner_user_id)) {
      seenPartnerIds.add(wo.partner_user_id);
      partners.push({ id: wo.partner_user_id, name: wo.partner?.display_name || wo.partner?.email || "Unknown" });
    }
  });
  const staffList = [];
  const seenStaffIds = new Set();
  orders.forEach((wo) => {
    if (wo.assigned_user_id && !seenStaffIds.has(wo.assigned_user_id)) {
      seenStaffIds.add(wo.assigned_user_id);
      staffList.push({ id: wo.assigned_user_id, name: wo.assigned?.display_name || wo.assigned?.email || "Unknown" });
    }
  });

  const filtersEl = document.getElementById("wo-details-filters");
  filtersEl.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <input type="text" id="wo-details-search" class="filter-select" placeholder="Search client name..." style="flex:1;min-width:180px;" />
      <select id="wo-details-type-filter" class="filter-select">
        <option value="">All Types</option>
        ${types.map((t) => `<option value="${t}">${getOrderTypeLabel(t)}</option>`).join("")}
      </select>
      <select id="wo-details-partner-filter" class="filter-select">
        <option value="">All Partners</option>
        ${partners.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}
      </select>
      <select id="wo-details-staff-filter" class="filter-select">
        <option value="">All Staff</option>
        ${staffList.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}
      </select>
    </div>
  `;

  function applyWoDetailsFilters() {
    const filtered = woDetailsFullList.filter((wo) => {
      if (woDetailsFilters.type && wo.order_type !== woDetailsFilters.type) return false;
      if (woDetailsFilters.partner && wo.partner_user_id !== woDetailsFilters.partner) return false;
      if (woDetailsFilters.staff && wo.assigned_user_id !== woDetailsFilters.staff) return false;
      if (woDetailsFilters.search && !(wo.clients?.legal_name || "").toLowerCase().includes(woDetailsFilters.search.toLowerCase())) return false;
      return true;
    });

    const wrap = document.getElementById("wo-details-table");
    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state">No matching work orders.</div>`;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / woDetailsPageSize));
    woDetailsPage = Math.min(Math.max(1, woDetailsPage), totalPages);
    const pageItems = filtered.slice((woDetailsPage - 1) * woDetailsPageSize, woDetailsPage * woDetailsPageSize);

    renderWorkOrdersTable(wrap, pageItems, { showClient: true });
    wrap.insertAdjacentHTML("beforeend", paginationHtml("wo-details", woDetailsPage, woDetailsPageSize, filtered.length));
    wirePagination("wo-details", {
      onPrev: () => { woDetailsPage--; applyWoDetailsFilters(); },
      onNext: () => { woDetailsPage++; applyWoDetailsFilters(); },
      onPageSizeChange: (size) => { woDetailsPageSize = size; woDetailsPage = 1; applyWoDetailsFilters(); },
    });
  }

  document.getElementById("wo-details-search").addEventListener("input", (e) => {
    woDetailsFilters.search = e.target.value;
    woDetailsPage = 1;
    applyWoDetailsFilters();
  });
  document.getElementById("wo-details-type-filter").addEventListener("change", (e) => {
    woDetailsFilters.type = e.target.value;
    woDetailsPage = 1;
    applyWoDetailsFilters();
  });
  document.getElementById("wo-details-partner-filter").addEventListener("change", (e) => {
    woDetailsFilters.partner = e.target.value;
    woDetailsPage = 1;
    applyWoDetailsFilters();
  });
  document.getElementById("wo-details-staff-filter").addEventListener("change", (e) => {
    woDetailsFilters.staff = e.target.value;
    woDetailsPage = 1;
    applyWoDetailsFilters();
  });

  applyWoDetailsFilters();
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function isoToDMYDash(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

let kpiDetailsPage = 1;
let kpiDetailsPageSize = 10;
let kpiDetailsFullList = [];

function showDeadlineDetails(title, deadlines) {
  const card = document.getElementById("wo-details-card");
  document.getElementById("wo-details-title").textContent = title;
  card.classList.remove("hidden");
  document.getElementById("wo-details-filters").innerHTML = "";

  kpiDetailsFullList = deadlines;
  kpiDetailsPage = 1;
  paintKpiDetailsPage();
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function paintKpiDetailsPage() {
  const wrap = document.getElementById("wo-details-table");
  const deadlines = kpiDetailsFullList;

  if (!deadlines.length) {
    wrap.innerHTML = `<div class="empty-state">No deadlines match.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(deadlines.length / kpiDetailsPageSize));
  kpiDetailsPage = Math.min(Math.max(1, kpiDetailsPage), totalPages);
  const pageItems = deadlines.slice((kpiDetailsPage - 1) * kpiDetailsPageSize, kpiDetailsPage * kpiDetailsPageSize);

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Client</th><th>Deadline Type</th><th>Deadline Date</th><th>Status</th><th>Remark</th></tr></thead>
      <tbody>
        ${pageItems
          .map(
            (d) => `<tr class="clickable-row" data-client-id="${d.client_id}">
              <td>${d.clients?.legal_name || "-"}</td>
              <td>${d.deadline_type}</td>
              <td>${isoToDMYDash(d.deadline_date) || "-"}</td>
              <td><span class="status-badge ${d.status === "completed" ? "status-completed" : d.status === "overdue" ? "status-rejected" : "status-wip"}">${d.status}</span></td>
              <td>${d.clients?.remark || "-"}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
    ${paginationHtml("kpi-details", kpiDetailsPage, kpiDetailsPageSize, deadlines.length)}
  `;
  wrap.querySelectorAll("[data-client-id]").forEach((tr) => {
    tr.addEventListener("click", () => openClientDetailsById(tr.dataset.clientId));
  });
  wirePagination("kpi-details", {
    onPrev: () => { kpiDetailsPage--; paintKpiDetailsPage(); },
    onNext: () => { kpiDetailsPage++; paintKpiDetailsPage(); },
    onPageSizeChange: (size) => { kpiDetailsPageSize = size; kpiDetailsPage = 1; paintKpiDetailsPage(); },
  });
}
