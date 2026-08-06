// assets/js/monitoring.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isManagerOrAdmin } from "./permissions.js";
import { openWorkOrderModal, showWorkOrderDetailsModal, loadOrgWorkOrderTypes } from "./work-orders.js";
import { fetchAllRows, paginationHtml, wirePagination } from "./excel-utils.js";

function isoToDMYMon(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MON_DEADLINE_TYPE_TO_ORDER_TYPE = {
  "Audit": "audit",
  "Form C": "tax",
  "Form E": "form_e",
  "CP204": "cp204",
  "CP204A 6th": "cp204a",
  "CP204A 9th": "cp204a",
  "CP204A 11th": "cp204a",
};

let allDeadlines = [];
let clientMeta = {}; // client_id -> { legal_name, fye_month, team_id }
let teamsById = {};
let teamsByBranch = {};
let branchesById = {};
let staffOptions = [];
let monFilters = { client: "", type: "", status: "", year: "", branch: "", team: "", staff: "", partner: "" };
let monPage = 1;
let monPageSize = 10;

export async function renderMonitoring(el) {
  monFilters = { client: "", type: "", status: "", year: "", branch: "", team: "", staff: "", partner: "" };
  const orgId = getIdentity()?.organisationId;

  el.innerHTML = `
    <div class="page-header"><h1>Audit &amp; Tax Monitoring</h1></div>
    <div class="import-card">
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        <select id="mon-filter-client" class="filter-select"><option value="">All Clients</option></select>
        <select id="mon-filter-type" class="filter-select"><option value="">All Types</option></select>
        <select id="mon-filter-status" class="filter-select">
          <option value="">All Statuses</option>
          <option value="overdue">Overdue</option>
          <option value="upcoming">Upcoming</option>
          <option value="completed">Completed</option>
          <option value="not_applicable">Not Applicable</option>
        </select>
        <select id="mon-filter-year" class="filter-select"><option value="">All Years</option></select>
        <select id="mon-filter-branch" class="filter-select"><option value="">All Branches</option></select>
        <select id="mon-filter-team" class="filter-select"><option value="">All Teams</option></select>
        <select id="mon-filter-staff" class="filter-select"><option value="">All Staff</option></select>
        <select id="mon-filter-partner" class="filter-select"><option value="">All Partners</option></select>
      </div>
    </div>
    <div class="import-card"><div id="mon-table-wrap">Loading...</div></div>
  `;

  await loadOrgWorkOrderTypes(orgId);
  const [{ data: deadlines }, { data: clientsData }, { data: teamsData }, { data: branchesData }, { data: members }] = await Promise.all([
    fetchAllRows(supabase
      .from("client_deadlines")
      .select("id, deadline_type, deadline_date, financial_year, status, completed_date, work_order_id, client_id, work_orders(id, order_type, status, work_order_number, assigned_user_id, partner_user_id, assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email))")
      .eq("organisation_id", orgId)),
    supabase.from("clients").select("id, legal_name, fye_month, team_id").eq("organisation_id", orgId).order("legal_name"),
    supabase.from("teams").select("id, name, branch_id").eq("organisation_id", orgId).order("name"),
    supabase.from("branches").select("id, name").eq("organisation_id", orgId).order("name"),
    supabase.from("organisation_members").select("user_id, is_partner, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active").eq("is_working_staff", true),
  ]);

  allDeadlines = deadlines || [];
  clientMeta = Object.fromEntries((clientsData || []).map((c) => [c.id, c]));
  teamsById = Object.fromEntries((teamsData || []).map((t) => [t.id, t]));
  teamsByBranch = Object.fromEntries((teamsData || []).map((t) => [t.id, t.branch_id]));
  branchesById = Object.fromEntries((branchesData || []).map((b) => [b.id, b]));
  staffOptions = members || [];

  populateMonitoringFilters(clientsData || [], teamsData || [], branchesData || []);
  wireMonitoringFilters();
  monPage = 1;
  monPageSize = 10;
  paintMonitoringTable();
}

function populateMonitoringFilters(clientsData, teamsData, branchesData) {
  const clientSelect = document.getElementById("mon-filter-client");
  clientSelect.innerHTML = `<option value="">All Clients</option>${clientsData.map((c) => `<option value="${c.id}">${c.legal_name}</option>`).join("")}`;

  const typeSelect = document.getElementById("mon-filter-type");
  const typesPresent = [...new Set(allDeadlines.map((d) => d.deadline_type))];
  typeSelect.innerHTML = `<option value="">All Types</option>${typesPresent.map((t) => `<option value="${t}">${t}</option>`).join("")}`;

  const yearSelect = document.getElementById("mon-filter-year");
  const years = [...new Set(allDeadlines.map((d) => d.financial_year))].sort((a, b) => b - a);
  yearSelect.innerHTML = `<option value="">All Years</option>${years.map((y) => `<option value="${y}">FY${y}</option>`).join("")}`;

  const branchSelect = document.getElementById("mon-filter-branch");
  branchSelect.innerHTML = `<option value="">All Branches</option>${branchesData.map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}`;

  const teamSelect = document.getElementById("mon-filter-team");
  teamSelect.innerHTML = `<option value="">All Teams</option>${teamsData.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}`;

  const staffSelect = document.getElementById("mon-filter-staff");
  staffSelect.innerHTML = `<option value="">All Staff</option>${staffOptions.map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}`;

  const partnerSelect = document.getElementById("mon-filter-partner");
  partnerSelect.innerHTML = `<option value="">All Partners</option>${staffOptions.filter((m) => m.is_partner).map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}`;
}

function wireMonitoringFilters() {
  const bind = (id, key) => document.getElementById(id).addEventListener("change", (e) => { monFilters[key] = e.target.value; monPage = 1; paintMonitoringTable(); });
  bind("mon-filter-client", "client");
  bind("mon-filter-type", "type");
  bind("mon-filter-status", "status");
  bind("mon-filter-year", "year");
  bind("mon-filter-branch", "branch");
  bind("mon-filter-team", "team");
  bind("mon-filter-staff", "staff");
  bind("mon-filter-partner", "partner");
}

function statusBucket(d, todayStr) {
  if (d.status === "not_applicable") return "not_applicable";
  if (d.status === "completed") return "completed";
  return d.deadline_date < todayStr ? "overdue" : "upcoming";
}

function applyMonitoringFilters() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return allDeadlines.filter((d) => {
    if (monFilters.client && d.client_id !== monFilters.client) return false;
    if (monFilters.type && d.deadline_type !== monFilters.type) return false;
    if (monFilters.year && String(d.financial_year) !== monFilters.year) return false;
    if (monFilters.status && statusBucket(d, todayStr) !== monFilters.status) return false;

    const client = clientMeta[d.client_id];
    const team = client?.team_id;
    if (monFilters.team && team !== monFilters.team) return false;
    if (monFilters.branch && (!team || teamsByBranch[team] !== monFilters.branch)) return false;

    const wo = d.work_orders;
    if (monFilters.staff && wo?.assigned_user_id !== monFilters.staff) return false;
    if (monFilters.partner && wo?.partner_user_id !== monFilters.partner) return false;

    return true;
  }).sort((a, b) => (a.deadline_date || "").localeCompare(b.deadline_date || ""));
}

function paintMonitoringTable() {
  const wrap = document.getElementById("mon-table-wrap");
  const todayStr = new Date().toISOString().slice(0, 10);
  const filtered = applyMonitoringFilters();

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state">No deadlines match these filters.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / monPageSize));
  monPage = Math.min(Math.max(1, monPage), totalPages);
  const pageRows = filtered.slice((monPage - 1) * monPageSize, monPage * monPageSize);

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Client</th><th>Team</th><th>Type</th><th>Financial Year</th><th>Due Date</th><th>Status</th><th>WO Number</th><th>Created</th><th>Assigned Staff</th><th>Partner</th></tr></thead>
      <tbody>
        ${pageRows.map((d) => {
          const bucket = statusBucket(d, todayStr);
          const cls = bucket === "completed" ? "status-completed" : bucket === "overdue" ? "status-rejected" : bucket === "not_applicable" ? "" : "status-wip";
          const label = bucket === "completed" ? (isoToDMYMon(d.completed_date) || "Completed") : bucket === "overdue" ? "Overdue" : bucket === "not_applicable" ? "N/A" : "Upcoming";
          const client = clientMeta[d.client_id];
          const team = client?.team_id ? teamsById[client.team_id] : null;
          const wo = d.work_orders;
          return `<tr class="clickable-row" data-deadline-id="${d.id}">
            <td>${client?.legal_name || "-"}</td>
            <td>${team?.name || "-"}</td>
            <td>${d.deadline_type}</td>
            <td>FY${d.financial_year}</td>
            <td>${isoToDMYMon(d.deadline_date)}</td>
            <td><span class="status-badge ${cls}">${label}</span></td>
            <td style="font-family:monospace;font-size:12px;">${wo?.work_order_number || "-"}</td>
            <td>${wo?.created_at ? isoToDMYMon(wo.created_at.slice(0, 10)) : "-"}</td>
            <td>${wo?.assigned?.display_name || wo?.assigned?.email || "-"}</td>
            <td>${wo?.partner?.display_name || wo?.partner?.email || "-"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${paginationHtml("mon", monPage, monPageSize, filtered.length)}
  `;

  wirePagination("mon", {
    onPrev: () => { monPage--; paintMonitoringTable(); },
    onNext: () => { monPage++; paintMonitoringTable(); },
    onPageSizeChange: (size) => { monPageSize = size; monPage = 1; paintMonitoringTable(); },
  });

  wrap.querySelectorAll("[data-deadline-id]").forEach((tr) => {
    tr.addEventListener("click", () => openMonitoringRow(filtered.find((d) => d.id === tr.dataset.deadlineId)));
  });
}

async function openMonitoringRow(deadline) {
  if (!deadline) return;
  const admin = isManagerOrAdmin();

  if (deadline.work_order_id) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select("id, order_type, work_order_number, created_at, current_step_label, audit_report_date, archival_date, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, partner_user_id, manager_user_id, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email), manager:profiles!manager_user_id(display_name, email)")
      .eq("id", deadline.work_order_id)
      .maybeSingle();
    if (wo) showWorkOrderDetailsModal(wo);
    return;
  }

  if (!admin) return; // staff: view-only, nothing to view yet for this row
  const client = clientMeta[deadline.client_id];
  if (!client) return;
  if (!confirm(`No work order linked yet for ${deadline.deadline_type} (FY${deadline.financial_year}, ${client.legal_name}). Create one now?`)) return;

  let fyeDate = null;
  if (client.fye_month) {
    const lastDay = new Date(deadline.financial_year, client.fye_month, 0).getDate();
    fyeDate = `${deadline.financial_year}-${String(client.fye_month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  openWorkOrderModal({
    clientId: client.id,
    prefill: { order_type: MON_DEADLINE_TYPE_TO_ORDER_TYPE[deadline.deadline_type] || "adhoc", financial_year_end: fyeDate },
    onSaved: async (savedWo) => {
      if (savedWo?.id) await supabase.from("client_deadlines").update({ work_order_id: savedWo.id }).eq("id", deadline.id);
      await renderMonitoring(document.getElementById("app-content"));
    },
  });
}
