// assets/js/work-orders.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isManagerOrAdmin } from "./permissions.js";
import { loadFlatpickr, fetchAllRows, paginationHtml, wirePagination } from "./excel-utils.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
const APPROVE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const REJECT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

export const STEP_STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", for_review: "For Review", for_amendment: "For Amendment", completed: "Completed" };
export const STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", completed: "Completed", rejected: "Rejected" };

// Every work order type (built-in or custom) and its step workflow now
// live entirely in the database — editable from Firm Settings. Loaded
// once per page visit and cached here; loadOrgWorkOrderTypes re-fetches
// on demand (called before anywhere the type list needs to be current).
let orgWorkOrderTypes = []; // [{ id, key, label, is_builtin, has_steps, show_in_dashboard }]
let orgWorkOrderTypeSteps = {}; // key -> [step_name, ...] in order

export async function loadOrgWorkOrderTypes(orgId) {
  const { data: types } = await supabase.from("work_order_types").select("id, key, label, is_builtin, has_steps, show_in_dashboard").eq("organisation_id", orgId).order("label");
  orgWorkOrderTypes = types || [];

  const ids = orgWorkOrderTypes.filter((t) => t.has_steps).map((t) => t.id);
  orgWorkOrderTypeSteps = {};
  if (ids.length) {
    const { data: steps } = await supabase.from("work_order_type_steps").select("work_order_type_id, step_name").in("work_order_type_id", ids).order("step_number");
    const byId = Object.fromEntries(orgWorkOrderTypes.map((t) => [t.id, t.key]));
    (steps || []).forEach((s) => {
      const key = byId[s.work_order_type_id];
      if (!key) return;
      (orgWorkOrderTypeSteps[key] ??= []).push(s.step_name);
    });
  }
}

export function getOrderTypeLabel(key) {
  return orgWorkOrderTypes.find((t) => t.key === key)?.label || key;
}

// Types a person can pick when manually creating a work order — client_update
// is system-generated only (from a staff member editing client details).
export function getManualOrderTypeOptions() {
  return Object.fromEntries(orgWorkOrderTypes.filter((t) => t.key !== "client_update").map((t) => [t.key, t.label]));
}

export function isStepBasedType(key) {
  return orgWorkOrderTypes.find((t) => t.key === key)?.has_steps || false;
}

export function getStepTemplateFor(key) {
  return orgWorkOrderTypeSteps[key] || [];
}

export function getDashboardChartTypes() {
  return orgWorkOrderTypes.filter((t) => t.show_in_dashboard).map((t) => t.key);
}

function isoToDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function dmyToISO(text) {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

let allWorkOrdersCache = [];
let allClientsForFilter = [];
let allStaffForAssign = [];
let woFilters = { client: "", type: "", status: "", staff: "", partner: "", branch: "", team: "" };
let clientTeamMap = {}; // client_id -> team_id
let allBranchesForFilter = [];
let allTeamsForFilter = []; // { id, name, branch_id }

// ---------- main page ----------
export async function renderWorkOrders(el) {
  woPage = 1;
  woPageSize = 10;
  const orgId = getIdentity()?.organisationId;

  const [{ data: clients }, { data: members }] = await Promise.all([
    supabase.from("clients").select("id, legal_name").eq("organisation_id", orgId).order("legal_name"),
    supabase.from("organisation_members").select("user_id, is_partner, is_engagement_manager, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active").eq("is_working_staff", true),
  ]);
  allClientsForFilter = clients || [];
  allStaffForAssign = members || [];
  await loadOrgWorkOrderTypes(orgId);

  el.innerHTML = `
    <div class="page-header"><h1>Work Orders</h1></div>
    <div id="wo-summary-cards" class="kpi-grid"></div>
    <div class="page-header" style="margin-top:0;">
      <div class="page-actions">
        <select id="wo-filter-client" class="filter-select">
          <option value="">All Clients</option>
          ${allClientsForFilter.map((c) => `<option value="${c.id}">${c.legal_name}</option>`).join("")}
        </select>
        <select id="wo-filter-type" class="filter-select">
          <option value="">All Types</option>
          ${Object.entries(getManualOrderTypeOptions()).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <select id="wo-filter-status" class="filter-select">
          <option value="">All Statuses</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <select id="wo-filter-staff" class="filter-select">
          <option value="">All Staff</option>
          ${allStaffForAssign.map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
        </select>
        <select id="wo-filter-partner" class="filter-select">
          <option value="">All Partners</option>
          ${allStaffForAssign.filter((m) => m.is_partner).map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
        </select>
        <select id="wo-filter-branch" class="filter-select">
          <option value="">All Branches</option>
        </select>
        <select id="wo-filter-team" class="filter-select">
          <option value="">All Teams</option>
        </select>
        ${isManagerOrAdmin() ? `<button id="add-wo-btn" class="btn-dark">+ Add Work Order</button>` : ""}
      </div>
    </div>
    <div id="wo-table-wrap" class="import-card">Loading...</div>
  `;

  document.getElementById("wo-filter-client").addEventListener("change", (e) => { woFilters.client = e.target.value; woPage = 1; renderFilteredTable(); });
  document.getElementById("wo-filter-type").addEventListener("change", (e) => { woFilters.type = e.target.value; woPage = 1; renderFilteredTable(); });
  document.getElementById("wo-filter-status").addEventListener("change", (e) => { woFilters.status = e.target.value; woPage = 1; renderFilteredTable(); });
  document.getElementById("wo-filter-staff").addEventListener("change", (e) => { woFilters.staff = e.target.value; woPage = 1; renderFilteredTable(); });
  document.getElementById("wo-filter-partner").addEventListener("change", (e) => { woFilters.partner = e.target.value; woPage = 1; renderFilteredTable(); });
  document.getElementById("wo-filter-branch").addEventListener("change", (e) => { woFilters.branch = e.target.value; woPage = 1; renderFilteredTable(); });
  document.getElementById("wo-filter-team").addEventListener("change", (e) => { woFilters.team = e.target.value; woPage = 1; renderFilteredTable(); });

  const addBtn = document.getElementById("add-wo-btn");
  if (addBtn) addBtn.addEventListener("click", () => openWorkOrderModal({ onSaved: loadAndRenderAll }));

  await loadAndRenderAll();
}

async function loadAndRenderAll() {
  const orgId = getIdentity()?.organisationId;
  const [{ data, error }, { data: clientsData }, { data: teamsData }, { data: branchesData }] = await Promise.all([
    fetchAllRows(supabase
      .from("work_orders")
      .select("id, order_type, work_order_number, created_at, current_step_label, audit_report_date, archival_date, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, partner_user_id, manager_user_id, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email), manager:profiles!manager_user_id(display_name, email)")
      .eq("organisation_id", orgId)
      .order("deadline_date", { ascending: true, nullsFirst: false })),
    supabase.from("clients").select("id, team_id").eq("organisation_id", orgId),
    supabase.from("teams").select("id, name, branch_id").eq("organisation_id", orgId).order("name"),
    supabase.from("branches").select("id, name").eq("organisation_id", orgId).order("name"),
  ]);

  if (error) {
    const wrap = document.getElementById("wo-table-wrap");
    if (wrap) wrap.innerHTML = `<div class="empty-state">Could not load work orders.</div>`;
    return;
  }
  allWorkOrdersCache = data || [];
  clientTeamMap = Object.fromEntries((clientsData || []).map((c) => [c.id, c.team_id]));
  allTeamsForFilter = teamsData || [];
  allBranchesForFilter = branchesData || [];
  populateBranchTeamFilters();
  renderFilteredTable();
}

function populateBranchTeamFilters() {
  const branchSelect = document.getElementById("wo-filter-branch");
  const teamSelect = document.getElementById("wo-filter-team");
  if (branchSelect) branchSelect.innerHTML = `<option value="">All Branches</option>${allBranchesForFilter.map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}`;
  if (teamSelect) teamSelect.innerHTML = `<option value="">All Teams</option>${allTeamsForFilter.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}`;
}

let woPage = 1;
let woPageSize = 10;

function renderWoSummaryCards(orders) {
  const wrap = document.getElementById("wo-summary-cards");
  if (!wrap) return;
  const total = orders.length;
  const auditCount = orders.filter((wo) => wo.order_type === "audit").length;
  const taxCount = orders.filter((wo) => wo.order_type === "tax").length;
  const totalBudgetFee = orders.reduce((sum, wo) => sum + (Number(wo.budget_fee) || 0), 0);

  wrap.innerHTML = `
    <div class="kpi-card"><div class="kpi-value">${total}</div><div class="kpi-label">Total Work Orders</div></div>
    <div class="kpi-card"><div class="kpi-value">${auditCount}</div><div class="kpi-label">Total Audit Work Orders</div></div>
    <div class="kpi-card"><div class="kpi-value">${taxCount}</div><div class="kpi-label">Total Tax Work Orders</div></div>
    <div class="kpi-card"><div class="kpi-value">$${totalBudgetFee.toLocaleString()}</div><div class="kpi-label">Total Budget Fees</div></div>
  `;
}

function renderFilteredTable() {
  const teamsByBranch = Object.fromEntries(allTeamsForFilter.map((t) => [t.id, t.branch_id]));
  const filtered = allWorkOrdersCache.filter((wo) => {
    if (woFilters.client && wo.client_id !== woFilters.client) return false;
    if (woFilters.type && wo.order_type !== woFilters.type) return false;
    if (woFilters.status && wo.status !== woFilters.status) return false;
    if (woFilters.staff && wo.assigned_user_id !== woFilters.staff) return false;
    if (woFilters.partner && wo.partner_user_id !== woFilters.partner) return false;
    if (woFilters.team && clientTeamMap[wo.client_id] !== woFilters.team) return false;
    if (woFilters.branch) {
      const clientTeam = clientTeamMap[wo.client_id];
      if (!clientTeam || teamsByBranch[clientTeam] !== woFilters.branch) return false;
    }
    return true;
  });

  renderWoSummaryCards(filtered);

  const totalPages = Math.max(1, Math.ceil(filtered.length / woPageSize));
  woPage = Math.min(Math.max(1, woPage), totalPages);
  const pageItems = filtered.slice((woPage - 1) * woPageSize, woPage * woPageSize);

  const wrap = document.getElementById("wo-table-wrap");
  if (wrap) {
    renderWorkOrdersTable(wrap, pageItems, { showClient: true, onChanged: loadAndRenderAll });
    if (filtered.length) {
      wrap.insertAdjacentHTML("beforeend", paginationHtml("wo", woPage, woPageSize, filtered.length));
      wirePagination("wo", {
        onPrev: () => { woPage--; renderFilteredTable(); },
        onNext: () => { woPage++; renderFilteredTable(); },
        onPageSizeChange: (size) => { woPageSize = size; woPage = 1; renderFilteredTable(); },
      });
    }
  }
}

// ---------- shared table renderer (used here and from Client Details) ----------
export function renderWorkOrdersTable(container, orders, { showClient = false, onChanged } = {}) {
  if (!orders.length) {
    container.innerHTML = `<div class="empty-state"><p>No work orders yet.</p></div>`;
    return;
  }

  const selfId = getIdentity()?.user?.id;
  const admin = isManagerOrAdmin();

  container.innerHTML = `
    <table class="data-table" style="table-layout:fixed;">
      <colgroup>
        ${showClient ? '<col style="width:100px;">' : ""}
        <col style="width:105px;"><col style="width:90px;"><col style="width:95px;"><col style="width:90px;"><col style="width:100px;"><col style="width:100px;"><col style="width:100px;"><col style="width:90px;"><col style="width:85px;"><col style="width:150px;"><col style="width:90px;">
      </colgroup>
      <thead><tr>
        ${showClient ? '<th style="width:100px;">Client</th>' : ""}
        <th style="width:105px;">WO Number</th><th style="width:90px;">Created</th><th style="width:95px;">Type</th><th style="width:90px;">Financial Year</th><th style="width:100px;">Staff</th><th style="width:100px;">Manager</th><th style="width:100px;">Partner</th><th style="width:90px;">Deadline</th><th style="width:85px;">Budget Fee</th><th style="width:150px;">Status</th><th style="width:90px;">Actions</th>
      </tr></thead>
      <tbody>
        ${orders
          .map((wo) => {
            const isClientUpdate = wo.order_type === "client_update";
            const isPendingUpdate = isClientUpdate && wo.status === "not_started";
            const canUpdateStatus = !isClientUpdate && !isStepBasedType(wo.order_type) && (admin || wo.assigned_user_id === selfId);
            const statusBadgeClass = wo.status === "completed" ? "status-completed" : wo.status === "rejected" ? "status-rejected" : wo.status === "in_progress" ? "status-quotation" : "status-wip";
            const statusLabel = wo.status === "in_progress" && wo.current_step_label ? `In Progress - ${wo.current_step_label}` : STATUS_LABELS[wo.status];
            return `<tr class="clickable-row" data-wo-row="${wo.id}">
              ${showClient ? `<td>${wo.clients?.legal_name || "-"}</td>` : ""}
              <td style="font-family:monospace;font-size:12px;">${wo.work_order_number || "-"}</td>
              <td>${isoToDMY(wo.created_at ? wo.created_at.slice(0, 10) : null) || "-"}</td>
              <td>${getOrderTypeLabel(wo.order_type)}</td>
              <td>${isoToDMY(wo.financial_year_end) || "-"}</td>
              <td>${wo.assigned?.display_name || wo.assigned?.email || "-"}</td>
              <td>${wo.manager?.display_name || wo.manager?.email || "-"}</td>
              <td>${wo.partner?.display_name || wo.partner?.email || "-"}</td>
              <td>${isoToDMY(wo.deadline_date) || "-"}</td>
              <td>${wo.budget_fee != null ? `$${Number(wo.budget_fee).toLocaleString()}` : "-"}</td>
              <td>
                ${canUpdateStatus
                  ? `<select class="filter-select wo-status-select" data-wo="${wo.id}" style="width:100%;box-sizing:border-box;">
                      ${Object.entries(STATUS_LABELS).filter(([k]) => k !== "rejected").map(([k, v]) => `<option value="${k}" ${wo.status === k ? "selected" : ""}>${v}</option>`).join("")}
                    </select>`
                  : `<span class="status-badge ${statusBadgeClass}">${statusLabel}</span>`
                }
              </td>
              <td class="row-actions">
                ${isPendingUpdate && admin ? `<button class="icon-btn icon-btn-approve" data-approve-update="${wo.id}" title="Approve">${APPROVE_ICON}</button>` : ""}
                ${isPendingUpdate && admin ? `<button class="icon-btn icon-btn-delete" data-reject-update="${wo.id}" title="Reject">${REJECT_ICON}</button>` : ""}
                ${admin && !isClientUpdate ? `<button class="icon-btn icon-btn-edit" data-edit="${wo.id}" title="Edit">${EDIT_ICON}</button>` : ""}
                ${admin ? `<button class="icon-btn icon-btn-delete" data-delete="${wo.id}" title="Delete">${DELETE_ICON}</button>` : ""}
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;

  container.querySelectorAll("[data-wo-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".row-actions") || e.target.closest("select")) return;
      const wo = orders.find((o) => o.id === tr.dataset.woRow);
      if (wo) showWorkOrderDetailsModal(wo, onChanged);
    });
  });

  container.querySelectorAll("[data-approve-update]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Approve this change? It will be applied to the client immediately.")) return;
      const { error } = await supabase.rpc("approve_client_update_work_order", { wo_uuid: btn.dataset.approveUpdate });
      if (error) { alert("Could not approve: " + error.message); return; }
      if (onChanged) await onChanged();
    });
  });
  container.querySelectorAll("[data-reject-update]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = prompt("Reason for rejecting (optional):");
      if (reason === null) return; // cancelled
      const { error } = await supabase.rpc("reject_client_update_work_order", { wo_uuid: btn.dataset.rejectUpdate, reason: reason || null });
      if (error) { alert("Could not reject: " + error.message); return; }
      if (onChanged) await onChanged();
    });
  });

  container.querySelectorAll(".wo-status-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const { error } = await supabase.rpc("update_work_order_status", { work_order_uuid: sel.dataset.wo, new_status: sel.value });
      if (error) { alert("Could not update status: " + error.message); return; }
      if (onChanged) await onChanged();
    });
  });

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wo = orders.find((o) => o.id === btn.dataset.edit);
      openWorkOrderModal({ clientId: wo.client_id, existing: wo, onSaved: onChanged });
    });
  });

  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this work order? This cannot be undone.")) return;
      const { error } = await supabase.from("work_orders").delete().eq("id", btn.dataset.delete);
      if (error) { alert("Could not delete: " + error.message); return; }
      if (onChanged) await onChanged();
    });
  });
}

// ---------- read-only details modal ----------
export async function showWorkOrderDetailsModal(wo, onChanged) {
  const isStepBased = isStepBasedType(wo.order_type);
  let steps = [];
  let orgMembers = [];
  if (isStepBased) {
    const orgId = getIdentity()?.organisationId;
    const [{ data: stepsData }, { data: membersData }] = await Promise.all([
      supabase.from("work_order_steps").select("id, step_number, step_name, status, step_date, remark, person_to_act_user_id").eq("work_order_id", wo.id).order("step_number"),
      supabase.from("organisation_members").select("user_id, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active"),
    ]);
    steps = stepsData || [];
    orgMembers = membersData || [];
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:${isStepBased ? 1000 : 560}px;width:95vw;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${getOrderTypeLabel(wo.order_type)}${wo.work_order_number ? ` — ${wo.work_order_number}` : ""}</h2>
          <p class="modal-subtitle">${wo.clients?.legal_name || "Work order details"} — Overall status: ${wo.status === "in_progress" && wo.current_step_label ? `In Progress - ${wo.current_step_label}` : (STATUS_LABELS[wo.status] || wo.status)}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-grid">
        <div><label class="option-label">Client</label><div>${wo.clients?.legal_name || "-"}</div></div>
        <div><label class="option-label">Type</label><div>${getOrderTypeLabel(wo.order_type)}</div></div>
        <div><label class="option-label">Financial Year</label><div>${isoToDMY(wo.financial_year_end) || "-"}</div></div>
        <div><label class="option-label">Staff</label><div>${wo.assigned?.display_name || wo.assigned?.email || "-"}</div></div>
        <div><label class="option-label">Manager</label><div>${wo.manager?.display_name || wo.manager?.email || "-"}</div></div>
        <div><label class="option-label">Partner</label><div>${wo.partner?.display_name || wo.partner?.email || "-"}</div></div>
        <div><label class="option-label">Created</label><div>${isoToDMY(wo.created_at ? wo.created_at.slice(0, 10) : null) || "-"}</div></div>
        ${wo.order_type === "audit" ? `
          <div><label class="option-label">Audit Report Date</label><div>${isoToDMY(wo.audit_report_date) || "-"}</div></div>
          <div><label class="option-label">Archival Date</label><div>${isoToDMY(wo.archival_date) || "-"}</div></div>
        ` : ""}
        ${!isStepBased ? `<div><label class="option-label">Deadline</label><div>${isoToDMY(wo.deadline_date) || "-"}</div></div>` : ""}
        <div><label class="option-label">Budget Fee</label><div>${wo.budget_fee != null ? `$${Number(wo.budget_fee).toLocaleString()}` : "-"}</div></div>
        <div><label class="option-label">Professional Fee</label><div>${wo.professional_fee != null ? `$${Number(wo.professional_fee).toLocaleString()}` : "-"}</div></div>
        <div><label class="option-label">OPE</label><div>${wo.ope != null ? `$${Number(wo.ope).toLocaleString()}` : "-"}</div></div>
        ${!isStepBased ? `<div><label class="option-label">Status</label><div>${STATUS_LABELS[wo.status] || wo.status}</div></div>` : ""}
        <div class="full-width"><label class="option-label">Remark</label><div>${wo.description || "-"}</div></div>
      </div>

      ${isStepBased ? `
        <h3 style="margin-top:20px;">Steps</h3>
        <div style="overflow-x:auto;">
          <table class="data-table" id="wo-steps-table" style="table-layout:fixed;width:100%;">
            <thead><tr><th style="width:240px;">Step</th><th style="width:150px;">Status</th><th style="width:135px;">Date</th><th style="width:150px;">Person to Act</th><th>Remark</th></tr></thead>
            <tbody>
              ${steps.map((s) => `
                <tr data-step-id="${s.id}">
                  <td>${s.step_number}. ${s.step_name}</td>
                  <td>
                    <select class="filter-select step-status-select" data-step="${s.id}" style="width:100%;box-sizing:border-box;">
                      ${Object.entries(STEP_STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${s.status === k ? "selected" : ""}>${v}</option>`).join("")}
                    </select>
                  </td>
                  <td><input type="text" class="step-date-input" data-step="${s.id}" placeholder="DD/MM/YYYY" autocomplete="off" value="${isoToDMY(s.step_date)}" style="width:100%;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;box-sizing:border-box;" /></td>
                  <td>
                    <select class="filter-select step-person-select" data-step="${s.id}" style="width:100%;box-sizing:border-box;">
                      <option value="">Client</option>
                      ${orgMembers.map((m) => `<option value="${m.user_id}" ${s.person_to_act_user_id === m.user_id ? "selected" : ""}>${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
                    </select>
                  </td>
                  <td><input type="text" class="step-remark-input" data-step="${s.id}" value="${s.remark ?? ""}" style="width:100%;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;box-sizing:border-box;" /></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      ` : ""}

      <div class="modal-actions" style="margin-top:20px;">
        <button type="button" id="wo-details-close-btn" class="btn-secondary">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => {
    backdrop.remove();
    if (isStepBased && onChanged) onChanged();
  };
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#wo-details-close-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  if (isStepBased) {
    try {
      await loadFlatpickr();
      backdrop.querySelectorAll(".step-date-input").forEach((input) => {
        window.flatpickr(input, { dateFormat: "d/m/Y", allowInput: true });
      });
    } catch (err) {
      console.warn(err.message);
    }

    backdrop.querySelectorAll(".step-status-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const { error } = await supabase.from("work_order_steps").update({ status: sel.value }).eq("id", sel.dataset.step);
        if (error) alert("Could not update step: " + error.message);
      });
    });
    backdrop.querySelectorAll(".step-person-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const { error } = await supabase.from("work_order_steps").update({ person_to_act_user_id: sel.value || null }).eq("id", sel.dataset.step);
        if (error) alert("Could not update step: " + error.message);
      });
    });
    backdrop.querySelectorAll(".step-remark-input").forEach((input) => {
      input.addEventListener("blur", async () => {
        const { error } = await supabase.from("work_order_steps").update({ remark: input.value.trim() || null }).eq("id", input.dataset.step);
        if (error) alert("Could not update step: " + error.message);
      });
    });
    backdrop.querySelectorAll(".step-date-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const text = input.value.trim();
        const iso = text ? dmyToISO(text) : null;
        if (text && iso === undefined) return; // unparseable, leave as-is rather than silently wiping it
        const { error } = await supabase.from("work_order_steps").update({ step_date: iso || null }).eq("id", input.dataset.step);
        if (error) alert("Could not update step: " + error.message);
      });
    });
  }
}

// ---------- add/edit modal (shared) ----------
export async function openWorkOrderModal({ clientId, existing, onSaved, prefill } = {}) {
  const isEdit = !!existing;
  const orgId = getIdentity()?.organisationId;

  // Ensure staff list is available even if this modal is opened before the main page loads it
  if (!allStaffForAssign.length) {
    const { data: members } = await supabase.from("organisation_members").select("user_id, is_partner, is_engagement_manager, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active").eq("is_working_staff", true);
    allStaffForAssign = members || [];
  }
  await loadOrgWorkOrderTypes(orgId);
  let clientOptionsHtml = "";
  if (!clientId) {
    if (!allClientsForFilter.length) {
      const { data: clients } = await supabase.from("clients").select("id, legal_name").eq("organisation_id", orgId).order("legal_name");
      allClientsForFilter = clients || [];
    }
    clientOptionsHtml = `
      <label style="display:block;margin-bottom:14px;">Client
        <select id="wo-client" required style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
          <option value="">Select a client...</option>
          ${allClientsForFilter.map((c) => `<option value="${c.id}" ${existing?.client_id === c.id ? "selected" : ""}>${c.legal_name}</option>`).join("")}
        </select>
      </label>`;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${isEdit ? "Edit Work Order" : "Add Work Order"}</h2>
          <p class="modal-subtitle">${isEdit ? "Update this engagement's details." : "Create a new engagement for this client."}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="wo-form">
        ${clientOptionsHtml}
        <label style="display:block;margin-bottom:14px;">Type
          <select id="wo-type" required style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
            ${Object.entries(getManualOrderTypeOptions()).map(([k, v]) => `<option value="${k}" ${(existing?.order_type || prefill?.order_type) === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label style="display:block;margin-bottom:14px;">Financial Year
          <input type="text" id="wo-fye" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.financial_year_end || prefill?.financial_year_end)}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <label style="display:block;margin-bottom:14px;">Partner
          <select id="wo-partner" required style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
            <option value="">Select a partner...</option>
            ${allStaffForAssign.filter((m) => m.is_partner).map((m) => `<option value="${m.user_id}" ${existing?.partner_user_id === m.user_id ? "selected" : ""}>${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
          </select>
        </label>
        <label style="display:block;margin-bottom:14px;">Manager
          <select id="wo-manager" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
            <option value="">Unassigned</option>
            ${allStaffForAssign.filter((m) => m.is_engagement_manager).map((m) => `<option value="${m.user_id}" ${existing?.manager_user_id === m.user_id ? "selected" : ""}>${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
          </select>
        </label>
        <div id="wo-staff-deadline-fields">
          <label style="display:block;margin-bottom:14px;">Staff Assigned
            <select id="wo-assigned" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
              <option value="">Unassigned</option>
              ${allStaffForAssign.map((m) => `<option value="${m.user_id}" ${existing?.assigned_user_id === m.user_id ? "selected" : ""}>${m.profiles?.display_name || m.profiles?.email}</option>`).join("")}
            </select>
          </label>
          <label style="display:block;margin-bottom:14px;">Deadline
            <input type="text" id="wo-deadline" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.deadline_date)}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
          <label style="display:block;margin-bottom:14px;">Budget Fee ($)
            <input type="number" step="0.01" id="wo-budget-fee" value="${existing?.budget_fee ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
        </div>
        <div id="wo-audit-fields" class="hidden">
          <label style="display:block;margin-bottom:14px;">Audit Report Date
            <input type="text" id="wo-audit-report-date" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.audit_report_date)}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
          <label style="display:block;margin-bottom:14px;">Archival Date
            <input type="text" id="wo-archival-date" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.archival_date)}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
        </div>
        <div id="wo-invoice-fields">
          <label style="display:block;margin-bottom:14px;">Professional Fee ($)
            <input type="number" step="0.01" id="wo-professional-fee" value="${existing?.professional_fee ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
          <label style="display:block;margin-bottom:14px;">OPE ($)
            <input type="number" step="0.01" id="wo-ope" value="${existing?.ope ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          </label>
        </div>
        <div id="wo-status-field">
          <label style="display:block;margin-bottom:14px;">Status
            <select id="wo-status" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
              ${Object.entries(STATUS_LABELS).filter(([k]) => k !== "rejected").map(([k, v]) => `<option value="${k}" ${(existing?.status || "not_started") === k ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </label>
        </div>
        ${isEdit && isStepBasedType(existing.order_type) ? `<p class="hint" style="margin-top:-10px;">Status is set automatically from this work order's steps — open it from the list to update them.</p>` : ""}
        <label style="display:block;margin-bottom:4px;">Description (optional)
          <textarea id="wo-description" rows="3" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;">${existing?.description ?? ""}</textarea>
        </label>
        <p id="wo-error" class="form-error hidden"></p>
        <div class="modal-actions">
          <button type="button" id="wo-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${isEdit ? "Save Changes" : "Add Work Order"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  try {
    await loadFlatpickr();
    window.flatpickr("#wo-fye", { dateFormat: "d/m/Y", allowInput: true });
    window.flatpickr("#wo-deadline", { dateFormat: "d/m/Y", allowInput: true });
    window.flatpickr("#wo-audit-report-date", { dateFormat: "d/m/Y", allowInput: true });
    window.flatpickr("#wo-archival-date", { dateFormat: "d/m/Y", allowInput: true });
  } catch (err) {
    console.warn(err.message);
  }

  function updateFieldsForType() {
    const type = document.getElementById("wo-type").value;
    const isInvoice = type === "invoice_request";
    document.getElementById("wo-staff-deadline-fields").classList.toggle("hidden", isInvoice);
    document.getElementById("wo-invoice-fields").classList.toggle("hidden", !isInvoice);
    document.getElementById("wo-audit-fields").classList.toggle("hidden", type !== "audit");
    // Status becomes an automatic rollup from steps once any exist — only
    // relevant to hide for a brand new work order, since an existing one's
    // steps already govern it regardless of what this dropdown shows.
    document.getElementById("wo-status-field").classList.toggle("hidden", !isEdit && isStepBasedType(type));
  }
  document.getElementById("wo-type").addEventListener("change", updateFieldsForType);
  updateFieldsForType();

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  document.getElementById("wo-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  document.getElementById("wo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("wo-error");
    const identity = getIdentity();

    const finalClientId = clientId || document.getElementById("wo-client").value;
    if (!finalClientId) {
      errorEl.textContent = "Please select a client.";
      errorEl.classList.remove("hidden");
      return;
    }
    const partnerId = document.getElementById("wo-partner").value;
    if (!partnerId) {
      errorEl.textContent = "Please select a partner.";
      errorEl.classList.remove("hidden");
      return;
    }

    const fyeText = document.getElementById("wo-fye").value.trim();
    const fyeISO = fyeText ? dmyToISO(fyeText) : null;
    if (fyeText && fyeISO === undefined) {
      errorEl.textContent = `Could not understand the Financial Year date "${fyeText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }
    const isInvoice = document.getElementById("wo-type").value === "invoice_request";

    const deadlineText = isInvoice ? "" : document.getElementById("wo-deadline").value.trim();
    const deadlineISO = deadlineText ? dmyToISO(deadlineText) : null;
    if (deadlineText && deadlineISO === undefined) {
      errorEl.textContent = `Could not understand the Deadline date "${deadlineText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }

    const isAudit = document.getElementById("wo-type").value === "audit";
    const auditReportText = isAudit ? document.getElementById("wo-audit-report-date").value.trim() : "";
    const auditReportISO = auditReportText ? dmyToISO(auditReportText) : null;
    if (auditReportText && auditReportISO === undefined) {
      errorEl.textContent = `Could not understand the Audit Report Date "${auditReportText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }
    const archivalText = isAudit ? document.getElementById("wo-archival-date").value.trim() : "";
    const archivalISO = archivalText ? dmyToISO(archivalText) : null;
    if (archivalText && archivalISO === undefined) {
      errorEl.textContent = `Could not understand the Archival Date "${archivalText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }

    const payload = {
      organisation_id: orgId,
      client_id: finalClientId,
      order_type: document.getElementById("wo-type").value,
      financial_year_end: fyeISO || null,
      partner_user_id: partnerId,
      manager_user_id: document.getElementById("wo-manager").value || null,
      assigned_user_id: isInvoice ? null : (document.getElementById("wo-assigned").value || null),
      deadline_date: isInvoice ? null : (deadlineISO || null),
      budget_fee: isInvoice ? null : (document.getElementById("wo-budget-fee").value || null),
      professional_fee: isInvoice ? (document.getElementById("wo-professional-fee").value || null) : null,
      ope: isInvoice ? (document.getElementById("wo-ope").value || null) : null,
      audit_report_date: auditReportISO || null,
      archival_date: archivalISO || null,
      status: document.getElementById("wo-status").value,
      description: document.getElementById("wo-description").value.trim() || null,
    };

    let result;
    if (isEdit) {
      result = await supabase.from("work_orders").update(payload).eq("id", existing.id);
    } else {
      payload.created_by = identity.user.id;
      result = await supabase.from("work_orders").insert(payload).select().single();
    }

    if (result.error) {
      errorEl.textContent = "Could not save: " + result.error.message;
      errorEl.classList.remove("hidden");
      return;
    }

    const template = getStepTemplateFor(payload.order_type);
    if (!isEdit && template.length) {
      const steps = template.map((step_name, i) => ({
        work_order_id: result.data.id,
        step_number: i + 1,
        step_name,
      }));
      const { error: stepsError } = await supabase.from("work_order_steps").insert(steps);
      if (stepsError) {
        errorEl.textContent = "Work order created, but its steps could not be set up: " + stepsError.message;
        errorEl.classList.remove("hidden");
        return;
      }
    }

    close();
    if (onSaved) await onSaved(isEdit ? existing : result.data);
  });
}
