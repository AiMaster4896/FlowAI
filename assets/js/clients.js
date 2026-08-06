// assets/js/clients.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { loadSheetJS, downloadBlankTemplate, exportClientsWorkbook, parseClientWorkbook, validateRow, loadFlatpickr, paginationHtml, wirePagination } from "./excel-utils.js";
import { renderWorkOrdersTable, openWorkOrderModal, showWorkOrderDetailsModal, loadOrgWorkOrderTypes } from "./work-orders.js";
import { isManagerOrAdmin } from "./permissions.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const FIELD_LABELS = {
  legal_name: "Company Name",
  registration_number: "Registration Number",
  fye_month: "Financial Year End",
  audit_fee: "Audit Fee",
  tax_fee: "Tax Fee",
  special_fee: "Special Fee",
  branch: "Branch",
  industry: "Industry",
  company_address: "Company Address",
  directors: "Directors",
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Fixed column order for the compliance matrix, and which work order type
// each deadline maps to when creating one from a matrix cell.
const DEADLINE_TYPE_ORDER = ["Audit", "Form C", "Form E", "CP204", "CP204A 6th", "CP204A 9th", "CP204A 11th"];
const DEADLINE_TYPE_TO_ORDER_TYPE = {
  "Audit": "audit",
  "Form C": "tax",
  "Form E": "form_e",
  "CP204": "cp204",
  "CP204A 6th": "cp204a",
  "CP204A 9th": "cp204a",
  "CP204A 11th": "cp204a",
};
// Grouping shown as a header row above the individual columns
const DEADLINE_TYPE_GROUP = {
  "Audit": "Audit",
  "Form C": "Tax",
  "Form E": "Tax",
  "CP204": "Tax",
  "CP204A 6th": "Tax",
  "CP204A 9th": "Tax",
  "CP204A 11th": "Tax",
};
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
const RESIGN_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
const BULK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;

// FYE is stored as ISO (yyyy-mm-dd) in the database but always shown/typed as DD/MM/YYYY.
function isoToDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function dmyToISO(text) {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined; // signals "could not parse"
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

let allClients = [];
let activeFilters = { search: "", status: "", branch: "", fye: "", staff: "", partner: "", team: "", showResigned: false, letter: "" };
let clientsByStaff = {};
let clientsByPartner = {};
let staffAndPartnerOptions = [];
let allTeams = [];
let clientPage = 1;
let openClientIdOnLoad = null;

/** Called from other pages (e.g. Dashboard) before navigating here, so a specific client's details open automatically once the list loads. */
export function openClientOnLoad(clientId) {
  openClientIdOnLoad = clientId;
}

/** Opens a client's details modal directly, without navigating to or loading the full Client List page — for popping it up over other pages like Dashboard. */
export async function openClientDetailsById(clientId) {
  const orgId = getIdentity()?.organisationId;

  if (!allTeams.length) {
    const { data: teamsData } = await supabase.from("teams").select("id, name, branches(name)").eq("organisation_id", orgId).order("name");
    allTeams = teamsData || [];
  }

  const [{ data: client, error }, { data: openWOs }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, legal_name, registration_number, tin, e_number, financial_year_end, fye_month, audit_fee, tax_fee, special_fee, total_fee, branch, team_id, invoice_to_date, workflow_status, industry, company_address, directors, appointment_of_auditor_date, engagement_type, remark, resignation_date")
      .eq("id", clientId)
      .maybeSingle(),
    supabase.from("work_orders").select("client_id").eq("client_id", clientId).neq("status", "completed"),
  ]);

  if (error || !client) return;
  client.outstanding_work_orders = (openWOs || []).length;
  await openClientDetailsModal(client);
}
let clientPageSize = 10;
let clientSortColumn = null;
let clientSortDirection = "asc";

function sortArrow(column) {
  if (clientSortColumn !== column) return "";
  return clientSortDirection === "asc" ? " ▲" : " ▼";
}

export async function renderClients(el) {
  clientPage = 1;
  clientPageSize = 10;
  clientSortColumn = null;
  clientSortDirection = "asc";
  activeFilters = { search: "", status: "", branch: "", fye: "", staff: "", partner: "", team: "", showResigned: false, letter: "" };
  el.innerHTML = `
    <div class="page-header"><h1>Client List</h1></div>
    <div id="client-summary-cards" class="kpi-grid"></div>
    <div class="import-card">
      <div id="client-letter-filter" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px;"></div>
      <div class="client-toolbar">
        <input type="text" id="client-search" class="search-input" placeholder="Search clients..." />
        <div class="page-actions">
          <select id="filter-status" class="filter-select">
            <option value="">All Engagement Types</option>
            <option value="audit">Audit Only</option>
            <option value="tax">Tax Only</option>
            <option value="both">Audit &amp; Tax</option>
          </select>
          <select id="filter-branch" class="filter-select">
            <option value="">All Branches</option>
          </select>
          <select id="filter-team" class="filter-select">
            <option value="">All Teams</option>
          </select>
          <select id="filter-fye" class="filter-select">
            <option value="">All Year Ends</option>
          </select>
          <select id="filter-staff" class="filter-select">
            <option value="">All Staff</option>
          </select>
          <select id="filter-partner" class="filter-select">
            <option value="">All Partners</option>
          </select>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;white-space:nowrap;">
            <input type="checkbox" id="filter-show-resigned" /> Show Resigned Clients
          </label>
          ${isManagerOrAdmin() ? `
            <button id="download-template-btn" class="btn-secondary">Download Template</button>
            <button id="export-clients-btn" class="btn-secondary">Export</button>
            <button id="import-clients-btn" class="btn-secondary">Import</button>
            <button id="add-client-btn" class="btn-dark">+ Add Client</button>
            <input type="file" id="import-file-input" accept=".xlsx,.xls" class="hidden" />
          ` : ""}
        </div>
      </div>
      <div id="clients-table-wrap">Loading...</div>
    </div>
    <div id="import-section"></div>
  `;

  if (isManagerOrAdmin()) {
    document.getElementById("add-client-btn").addEventListener("click", () => openClientModal(null));

    document.getElementById("download-template-btn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Preparing...";
      try {
        await downloadBlankTemplate();
      } catch (err) {
        alert(err.message);
      } finally {
        e.target.disabled = false;
        e.target.textContent = "Download Template";
      }
    });

    document.getElementById("export-clients-btn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Preparing...";
      try {
        const contactsByClientId = await fetchContactsMap(allClients.map((c) => c.id));
        const teamNameById = Object.fromEntries(allTeams.map((t) => [t.id, t.name]));
        await exportClientsWorkbook(allClients, contactsByClientId, teamNameById);
      } catch (err) {
        alert(err.message);
      } finally {
        e.target.disabled = false;
        e.target.textContent = "Export";
      }
    });

    const fileInput = document.getElementById("import-file-input");
    document.getElementById("import-clients-btn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleImportFile(file);
      fileInput.value = "";
  });
  }

  document.getElementById("client-search").addEventListener("input", (e) => {
    activeFilters.search = e.target.value;
    clientPage = 1; renderTableRows(applyFilters());
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    activeFilters.status = e.target.value;
    clientPage = 1; renderTableRows(applyFilters());
  });
  document.getElementById("filter-branch").addEventListener("change", (e) => {
    activeFilters.branch = e.target.value;
    clientPage = 1; renderTableRows(applyFilters());
  });
  document.getElementById("filter-fye").addEventListener("change", (e) => {
    activeFilters.fye = e.target.value;
    clientPage = 1; renderTableRows(applyFilters());
  });
  document.getElementById("filter-staff").addEventListener("change", (e) => {
    activeFilters.staff = e.target.value;
    clientPage = 1; renderTableRows(applyFilters());
  });
  document.getElementById("filter-partner").addEventListener("change", (e) => {
    activeFilters.partner = e.target.value;
    clientPage = 1; renderTableRows(applyFilters());
  });
  document.getElementById("filter-show-resigned").addEventListener("change", (e) => {
    activeFilters.showResigned = e.target.checked;
    clientPage = 1; renderTableRows(applyFilters());
  });
  document.getElementById("filter-team").addEventListener("change", (e) => {
    activeFilters.team = e.target.value;
    clientPage = 1; renderTableRows(applyFilters());
  });

  renderLetterFilter();

  await loadOrgWorkOrderTypes(getIdentity()?.organisationId);
  await loadAndRenderTable();
}

async function fetchContactsMap(clientIds) {
  if (!clientIds.length) return {};
  const { data } = await supabase
    .from("client_contacts")
    .select("client_id, name, email, phone")
    .in("client_id", clientIds)
    .eq("is_primary", true);
  const map = {};
  (data || []).forEach((c) => { map[c.client_id] = c; });
  return map;
}

function renderLetterFilter() {
  const el = document.getElementById("client-letter-filter");
  if (!el) return;
  const letters = ["All", "123", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];
  el.innerHTML = letters.map((l) => {
    const value = l === "All" ? "" : l;
    const isActive = activeFilters.letter === value;
    return `<button type="button" class="btn-secondary" data-letter="${value}" style="padding:4px 10px;font-size:12px;${isActive ? "background:var(--gray-900);color:#fff;border-color:var(--gray-900);" : ""}">${l}</button>`;
  }).join("");
  el.querySelectorAll("[data-letter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilters.letter = btn.dataset.letter;
      clientPage = 1;
      renderLetterFilter();
      renderTableRows(applyFilters());
    });
  });
}

function applyFilters() {
  const q = (activeFilters.search || "").trim().toLowerCase();
  return allClients.filter((c) => {
    if (!activeFilters.showResigned && c.resignation_date) return false;
    if (activeFilters.letter) {
      const firstChar = (c.legal_name || "").trim().charAt(0).toUpperCase();
      if (activeFilters.letter === "123") {
        if (!/[0-9]/.test(firstChar)) return false;
      } else if (firstChar !== activeFilters.letter) {
        return false;
      }
    }
    if (q && !c.legal_name.toLowerCase().includes(q) && !(c.branch || "").toLowerCase().includes(q)) return false;
    if (activeFilters.status && c.engagement_type !== activeFilters.status) return false;
    if (activeFilters.branch && c.branch !== activeFilters.branch) return false;
    if (activeFilters.fye && String(c.fye_month) !== activeFilters.fye) return false;
    if (activeFilters.staff && !clientsByStaff[activeFilters.staff]?.has(c.id)) return false;
    if (activeFilters.partner && !clientsByPartner[activeFilters.partner]?.has(c.id)) return false;
    if (activeFilters.team && c.team_id !== activeFilters.team) return false;
    return true;
  });
}

function populateStaffPartnerFilters() {
  const staffSelect = document.getElementById("filter-staff");
  const partnerSelect = document.getElementById("filter-partner");
  if (!staffSelect || !partnerSelect) return;
  const staffOptions = staffAndPartnerOptions.map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("");
  const partnerOptions = staffAndPartnerOptions.filter((m) => m.is_partner).map((m) => `<option value="${m.user_id}">${m.profiles?.display_name || m.profiles?.email}</option>`).join("");
  staffSelect.innerHTML = `<option value="">All Staff</option>${staffOptions}`;
  partnerSelect.innerHTML = `<option value="">All Partners</option>${partnerOptions}`;
}

function populateBranchFilter() {
  const select = document.getElementById("filter-branch");
  if (!select) return;
  const branches = [...new Set(allClients.map((c) => c.branch).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = `<option value="">All Branches</option>${branches.map((b) => `<option value="${b}">${b}</option>`).join("")}`;
  select.value = branches.includes(current) ? current : "";
}

function populateFyeFilter() {
  const select = document.getElementById("filter-fye");
  if (!select) return;
  const months = [...new Set(allClients.map((c) => c.fye_month).filter(Boolean))].sort((a, b) => a - b);
  const current = select.value;
  select.innerHTML = `<option value="">All Year Ends</option>${months.map((m) => `<option value="${m}">${MONTH_NAMES[m - 1]}</option>`).join("")}`;
  select.value = months.map(String).includes(current) ? current : "";
}

function resetFilters() {
  activeFilters = { search: "", status: "", branch: "", fye: "", staff: "", partner: "", team: "", showResigned: false, letter: "" };
  const searchEl = document.getElementById("client-search");
  const statusEl = document.getElementById("filter-status");
  const branchEl = document.getElementById("filter-branch");
  const fyeEl = document.getElementById("filter-fye");
  const resignedEl = document.getElementById("filter-show-resigned");
  if (searchEl) searchEl.value = "";
  if (statusEl) statusEl.value = "";
  if (branchEl) branchEl.value = "";
  if (fyeEl) fyeEl.value = "";
  if (resignedEl) resignedEl.checked = false;
  renderLetterFilter();
}

async function loadAndRenderTable() {
  const orgId = getIdentity()?.organisationId;
  const [{ data, error }, { data: openWOs }, { data: allWOs }, { data: members }, { data: teamsData }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, legal_name, registration_number, tin, e_number, financial_year_end, fye_month, audit_fee, tax_fee, special_fee, total_fee, branch, team_id, invoice_to_date, workflow_status, industry, company_address, directors, appointment_of_auditor_date, engagement_type, remark, resignation_date")
      .eq("organisation_id", orgId)
      .order("legal_name"),
    supabase.from("work_orders").select("client_id").eq("organisation_id", orgId).neq("status", "completed"),
    supabase.from("work_orders").select("client_id, assigned_user_id, partner_user_id").eq("organisation_id", orgId),
    supabase.from("organisation_members").select("user_id, is_partner, profiles(display_name, email)").eq("organisation_id", orgId).eq("status", "active").eq("is_working_staff", true),
    supabase.from("teams").select("id, name, branches(name)").eq("organisation_id", orgId).order("name"),
  ]);

  clientsByStaff = {};
  clientsByPartner = {};
  (allWOs || []).forEach((wo) => {
    if (wo.assigned_user_id) (clientsByStaff[wo.assigned_user_id] ??= new Set()).add(wo.client_id);
    if (wo.partner_user_id) (clientsByPartner[wo.partner_user_id] ??= new Set()).add(wo.client_id);
  });
  staffAndPartnerOptions = members || [];
  populateStaffPartnerFilters();

  allTeams = teamsData || [];
  const teamSelect = document.getElementById("filter-team");
  if (teamSelect) teamSelect.innerHTML = `<option value="">All Teams</option>${allTeams.map((t) => `<option value="${t.id}">${t.branches?.name ? `${t.branches.name} — ` : ""}${t.name}</option>`).join("")}`;

  if (error) {
    document.getElementById("clients-table-wrap").innerHTML = `<div class="empty-state">Could not load clients.</div>`;
    return;
  }

  const outstandingByClient = {};
  (openWOs || []).forEach((wo) => { outstandingByClient[wo.client_id] = (outstandingByClient[wo.client_id] || 0) + 1; });

  allClients = (data || []).map((c) => ({ ...c, outstanding_work_orders: outstandingByClient[c.id] || 0 }));
  populateBranchFilter();
  populateFyeFilter();
  renderTableRows(applyFilters());

  if (openClientIdOnLoad) {
    const target = allClients.find((c) => c.id === openClientIdOnLoad);
    openClientIdOnLoad = null;
    if (target) await openClientDetailsModal(target);
  }
}

function money(v) {
  return v != null ? `$${Number(v).toLocaleString()}` : "-";
}

function statusBadgeClass(status) {
  if (status === "Completed") return "status-completed";
  if (status === "Quotation") return "status-quotation";
  return "status-wip";
}

function renderSummaryCards(rows) {
  const wrap = document.getElementById("client-summary-cards");
  if (!wrap) return;

  const totalClients = rows.length;
  const auditClients = rows.filter((c) => c.engagement_type === "audit" || c.engagement_type === "both").length;
  const taxClients = rows.filter((c) => c.engagement_type === "tax" || c.engagement_type === "both").length;
  const totalFee = rows.reduce((sum, c) => sum + (Number(c.total_fee) || 0), 0);

  wrap.innerHTML = `
    <div class="kpi-card"><div class="kpi-value">${totalClients}</div><div class="kpi-label">Total Clients</div></div>
    <div class="kpi-card"><div class="kpi-value">${auditClients}</div><div class="kpi-label">Audit Clients</div></div>
    <div class="kpi-card"><div class="kpi-value">${taxClients}</div><div class="kpi-label">Tax Clients</div></div>
    <div class="kpi-card"><div class="kpi-value">${money(totalFee)}</div><div class="kpi-label">Total Fee</div></div>
  `;
}

function renderTableRows(rows) {
  const wrap = document.getElementById("clients-table-wrap");
  if (!wrap) return;

  renderSummaryCards(rows);

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No clients match.</p><p class="hint">Add one manually, export a template to fill in, or import a filled one back.</p></div>`;
    return;
  }

  if (clientSortColumn) {
    rows = [...rows].sort((a, b) => {
      let av = a[clientSortColumn];
      let bv = b[clientSortColumn];
      if (clientSortColumn === "legal_name") {
        av = (av || "").toLowerCase();
        bv = (bv || "").toLowerCase();
      } else {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      }
      if (av < bv) return clientSortDirection === "asc" ? -1 : 1;
      if (av > bv) return clientSortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / clientPageSize));
  clientPage = Math.min(Math.max(1, clientPage), totalPages);
  const pageRows = rows.slice((clientPage - 1) * clientPageSize, clientPage * clientPageSize);

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th class="sortable-th" data-sort="legal_name">Company Name${sortArrow("legal_name")}</th>
        <th class="sortable-th" data-sort="fye_month">Financial Year End${sortArrow("fye_month")}</th>
        <th class="sortable-th" data-sort="total_fee">Total Fee${sortArrow("total_fee")}</th>
        <th>Engagement Type</th><th>Branch</th><th>Team</th>
        <th class="sortable-th" data-sort="outstanding_work_orders">Outstanding Work Orders${sortArrow("outstanding_work_orders")}</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>
        ${pageRows
          .map(
            (c) => `<tr class="clickable-row" data-row-client="${c.id}">
              <td><strong>${c.legal_name}</strong>${c.resignation_date ? ` <span class="status-badge status-rejected">Resigned</span>` : ""}</td>
              <td>${c.fye_month ? MONTH_NAMES[c.fye_month - 1] : "-"}</td>
              <td>${money(c.total_fee)}</td>
              <td>${c.engagement_type === "audit" ? "Audit Only" : c.engagement_type === "tax" ? "Tax Only" : "Audit & Tax"}</td>
              <td>${c.branch || "-"}</td>
              <td>${allTeams.find((t) => t.id === c.team_id)?.name || "-"}</td>
              <td>${c.outstanding_work_orders > 0 ? `<span class="status-badge status-wip">${c.outstanding_work_orders} outstanding</span>` : `<span class="status-badge status-completed">None</span>`}</td>
              <td class="row-actions">
                <button class="icon-btn icon-btn-edit" data-edit="${c.id}" title="Edit">${EDIT_ICON}</button>
                ${isManagerOrAdmin() && !c.resignation_date ? `<button class="icon-btn icon-btn-edit" data-resign="${c.id}" data-name="${c.legal_name}" title="Mark as Resigned">${RESIGN_ICON}</button>` : ""}
                ${isManagerOrAdmin() ? `<button class="icon-btn icon-btn-delete" data-delete="${c.id}" data-name="${c.legal_name}" title="Delete">${DELETE_ICON}</button>` : ""}
              </td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("tr[data-row-client]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".row-actions")) return;
      const row = allClients.find((c) => c.id === tr.dataset.rowClient);
      if (row) openClientDetailsModal(row);
    });
  });

  wrap.querySelectorAll(".sortable-th").forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (clientSortColumn === col) {
        clientSortDirection = clientSortDirection === "asc" ? "desc" : "asc";
      } else {
        clientSortColumn = col;
        clientSortDirection = "asc";
      }
      clientPage = 1;
      renderTableRows(applyFilters());
    });
  });

  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = allClients.find((c) => c.id === btn.dataset.edit);
      openClientModal(row);
    });
  });

  wrap.querySelectorAll("[data-resign]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dateText = prompt(`Resignation date for ${btn.dataset.name} (DD/MM/YYYY):`, isoToDMY(new Date().toISOString().slice(0, 10)));
      if (dateText === null) return;
      const parsed = dmyToISO(dateText.trim());
      if (!parsed) { alert(`Could not understand the date "${dateText}". Use DD/MM/YYYY.`); return; }
      const { error } = await supabase.from("clients").update({ resignation_date: parsed }).eq("id", btn.dataset.resign);
      if (error) { alert("Could not update: " + error.message); return; }
      await loadAndRenderTable();
    });
  });

  wrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete ${btn.dataset.name}? This also removes their contacts, assignments, and deadlines. This cannot be undone.`)) return;
      const { error: delError } = await supabase.from("clients").delete().eq("id", btn.dataset.delete);
      if (delError) { alert("Could not delete: " + delError.message); return; }
      await loadAndRenderTable();
    });
  });

  wrap.insertAdjacentHTML("beforeend", paginationHtml("client", clientPage, clientPageSize, rows.length));
  wirePagination("client", {
    onPrev: () => { clientPage--; renderTableRows(rows); },
    onNext: () => { clientPage++; renderTableRows(rows); },
    onPageSizeChange: (size) => { clientPageSize = size; clientPage = 1; renderTableRows(rows); },
  });
}

async function renderComplianceMatrix(container, client) {
  const [{ data: deadlines, error }, { data: taxTracking }] = await Promise.all([
    supabase
      .from("client_deadlines")
      .select("id, deadline_type, deadline_date, precise_deadline_date, financial_year, status, completed_date, work_order_id, manual_report_date, manual_archival_date, work_orders(work_order_number, audit_report_date, archival_date)")
      .eq("client_id", client.id)
      .order("financial_year", { ascending: false }),
    supabase.from("tax_estimate_tracking").select("financial_year, deadline_type, this_year_estimate, final_tax_balance").eq("client_id", client.id),
  ]);
  const taxByKey = Object.fromEntries((taxTracking || []).map((t) => [`${t.financial_year}|${t.deadline_type}`, t]));

  if (error) {
    container.innerHTML = `<div class="empty-state">Could not load compliance data.</div>`;
    return;
  }
  if (!deadlines?.length) {
    container.innerHTML = `<div class="empty-state">No deadlines tracked yet. ${isManagerOrAdmin() && client.fye_month ? "Use the button above to generate a year's." : ""}</div>`;
    return;
  }

  const years = [...new Set(deadlines.map((d) => d.financial_year))].sort((a, b) => b - a);
  const byYearType = {};
  deadlines.forEach((d) => { byYearType[`${d.financial_year}|${d.deadline_type}`] = d; });
  const typesPresent = DEADLINE_TYPE_ORDER.filter((t) => deadlines.some((d) => d.deadline_type === t));

  // Build grouped header spans (Audit / Tax) matching the columns actually present
  const groups = [];
  typesPresent.forEach((t) => {
    const g = DEADLINE_TYPE_GROUP[t] || "Other";
    if (groups.length && groups[groups.length - 1].name === g) groups[groups.length - 1].span++;
    else groups.push({ name: g, span: 1 });
  });

  const today = new Date().toISOString().slice(0, 10);
  function cellInfo(d) {
    if (!d) return { label: "-", cls: "" };
    if (d.status === "not_applicable") return { label: "N/A", cls: "compliance-cell-grey" };
    if (d.status === "completed") return { label: isoToDMY(d.completed_date) || "Completed", cls: "compliance-cell-green" };
    if (d.deadline_date < today) return { label: isoToDMY(d.deadline_date), cls: "compliance-cell-red" };
    return { label: isoToDMY(d.deadline_date), cls: "compliance-cell-yellow" };
  }

  container.innerHTML = `
    <table class="data-table compliance-matrix">
      <thead>
        <tr><th style="width:140px;"></th>${groups.map((g) => `<th colspan="${g.span}" style="text-align:center;">${g.name}</th>`).join("")}<th></th></tr>
        <tr><th style="width:140px;">Financial Year</th>${typesPresent.map((t) => `<th style="width:110px;">${t}</th>`).join("")}<th style="width:50px;"></th></tr>
      </thead>
      <tbody>
        ${years.map((y) => {
          const lastDay = client.fye_month ? new Date(y, client.fye_month, 0).getDate() : null;
          const fyLabel = lastDay ? `FY${String(lastDay).padStart(2, "0")}.${String(client.fye_month).padStart(2, "0")}.${y}` : `FY${y}`;
          return `
          <tr>
            <td><strong>${fyLabel}</strong></td>
            ${typesPresent.map((t) => {
              const d = byYearType[`${y}|${t}`];
              const info = cellInfo(d);
              const clickable = d && (isManagerOrAdmin() || d.work_order_id);
              const woNumber = d?.work_orders?.work_order_number;
              const reportDate = d?.work_orders?.audit_report_date ?? d?.manual_report_date;
              const archivalDate = d?.work_orders?.archival_date ?? d?.manual_archival_date;
              const taxInfo = d ? taxByKey[`${d.financial_year}|${d.deadline_type}`] : null;
              const taxLabel = t === "Form C" ? "Final Tax" : t === "CP204" ? "Tax Estimate" : t.startsWith("CP204A") ? "Revision" : null;
              const taxAmount = t === "Form C" ? taxInfo?.final_tax_balance : taxInfo?.this_year_estimate;
              return `<td class="compliance-cell ${info.cls}" data-deadline-id="${d?.id || ""}" style="cursor:${clickable ? "pointer" : "default"};">
                ${info.label}
                ${woNumber ? `<div style="font-size:10px;font-weight:400;opacity:0.75;margin-top:2px;">${woNumber}</div>` : ""}
                ${t === "Audit" && (reportDate || archivalDate) ? `
                  <div style="font-size:10px;font-weight:400;margin-top:4px;text-align:left;">
                    Report date: ${isoToDMY(reportDate) || "-"}<br>
                    Archival date: ${isoToDMY(archivalDate) || "-"}
                  </div>
                ` : ""}
                ${d?.status === "completed" && taxLabel && taxAmount != null ? `
                  <div style="font-size:10px;font-weight:400;margin-top:4px;">${taxLabel}-RM${Number(taxAmount).toLocaleString()}</div>
                ` : ""}
              </td>`;
            }).join("")}
            <td class="row-actions">
              ${isManagerOrAdmin() ? `<button class="icon-btn icon-btn-edit" data-bulk-year="${y}" title="Set all cells in this year">${BULK_ICON}</button>` : ""}
              ${isManagerOrAdmin() ? `<button class="icon-btn icon-btn-delete" data-delete-year="${y}" title="Delete this financial year">${DELETE_ICON}</button>` : ""}
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;

  container.querySelectorAll("[data-bulk-year]").forEach((btn) => {
    btn.addEventListener("click", () => openBulkYearActionModal(btn.dataset.bulkYear, client, container));
  });

  container.querySelectorAll("[data-delete-year]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const y = btn.dataset.deleteYear;
      if (!confirm(`Delete all deadlines tracked for FY${y}? This won't affect any linked work orders, just the tracker rows.`)) return;
      const { error } = await supabase.from("client_deadlines").delete().eq("client_id", client.id).eq("financial_year", y);
      if (error) { alert("Could not delete: " + error.message); return; }
      await renderComplianceMatrix(container, client);
    });
  });

  container.querySelectorAll("td.compliance-cell[data-deadline-id]:not([data-deadline-id=''])").forEach((td) => {
    const deadline = deadlines.find((d) => d.id === td.dataset.deadlineId);
    if (!deadline) return;
    if (!isManagerOrAdmin() && !deadline.work_order_id) return; // staff: view-only, nothing to view yet
    td.addEventListener("click", () => openDeadlineCellModal(deadline, client, container));
  });
}

function openBulkYearActionModal(year, client, matrixContainer) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:380px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">FY${year}</h2>
          <p class="modal-subtitle">Apply to every tracked deadline in this row at once.</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button id="bulk-mark-completed" class="btn-secondary">Mark all Completed</button>
        <button id="bulk-mark-not-completed" class="btn-secondary">Mark all Not Completed</button>
        <button id="bulk-mark-na" class="btn-secondary">Mark all Not Applicable</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  async function applyToYear(status) {
    const { error } = await supabase.from("client_deadlines").update({ status, completed_date: null, manual_override: true }).eq("client_id", client.id).eq("financial_year", year);
    if (error) { alert("Could not update: " + error.message); return; }
    close();
    await renderComplianceMatrix(matrixContainer, client);
  }

  backdrop.querySelector("#bulk-mark-completed").addEventListener("click", () => applyToYear("completed"));
  backdrop.querySelector("#bulk-mark-not-completed").addEventListener("click", () => applyToYear("not_due"));
  backdrop.querySelector("#bulk-mark-na").addEventListener("click", () => applyToYear("not_applicable"));
}

function openDeadlineCellModal(deadline, client, matrixContainer) {
  const admin = isManagerOrAdmin();

  if (!admin && deadline.work_order_id) {
    // Staff, view-only: go straight to the linked work order
    supabase
      .from("work_orders")
      .select("id, order_type, work_order_number, created_at, current_step_label, audit_report_date, archival_date, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, partner_user_id, manager_user_id, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email), manager:profiles!manager_user_id(display_name, email)")
      .eq("id", deadline.work_order_id)
      .maybeSingle()
      .then(({ data: wo }) => { if (wo) showWorkOrderDetailsModal(wo); });
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:380px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${deadline.deadline_type}</h2>
          <p class="modal-subtitle">FY${deadline.financial_year} — due ${isoToDMY(deadline.deadline_date)}</p>
          ${deadline.precise_deadline_date ? `<p class="hint" style="margin-top:4px;">Actual regulatory deadline (30 days before period start): ${isoToDMY(deadline.precise_deadline_date)}. Shown rounded to the prior month-end above for clearer monitoring.</p>` : ""}
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${deadline.work_order_id ? `<button id="dcm-view-wo" class="btn-secondary">View Linked Work Order</button>` : `<button id="dcm-create-wo" class="btn-dark">Create Work Order</button>`}
        <button id="dcm-mark-completed" class="btn-secondary">Mark as Completed</button>
        <button id="dcm-mark-not-completed" class="btn-secondary">Mark as Not Completed</button>
        <button id="dcm-mark-na" class="btn-secondary">Mark as Not Applicable</button>
      </div>
      <p class="hint" style="margin-top:14px;">Current status: ${deadline.status === "not_due" ? "Not Completed" : deadline.status === "completed" ? "Completed" : deadline.status === "not_applicable" ? "Not Applicable" : deadline.status}. Backlog or catch-up cases can be marked completed manually here, without needing a work order.</p>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const refresh = async () => { close(); await renderComplianceMatrix(matrixContainer, client); };

  const viewBtn = backdrop.querySelector("#dcm-view-wo");
  if (viewBtn) viewBtn.addEventListener("click", async () => {
    const { data: wo } = await supabase
      .from("work_orders")
      .select("id, order_type, work_order_number, created_at, current_step_label, audit_report_date, archival_date, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, partner_user_id, manager_user_id, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email), manager:profiles!manager_user_id(display_name, email)")
      .eq("id", deadline.work_order_id)
      .maybeSingle();
    close();
    if (wo) showWorkOrderDetailsModal(wo);
  });

  const createBtn = backdrop.querySelector("#dcm-create-wo");
  if (createBtn) createBtn.addEventListener("click", () => {
    close();
    const lastDay = new Date(deadline.financial_year, client.fye_month, 0).getDate();
    const fyeDate = `${deadline.financial_year}-${String(client.fye_month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    openWorkOrderModal({
      clientId: client.id,
      prefill: { order_type: DEADLINE_TYPE_TO_ORDER_TYPE[deadline.deadline_type] || "adhoc", financial_year_end: fyeDate },
      onSaved: async (savedWo) => {
        if (savedWo?.id) await supabase.from("client_deadlines").update({ work_order_id: savedWo.id }).eq("id", deadline.id);
        await renderComplianceMatrix(matrixContainer, client);
      },
    });
  });

  const completeBtn = backdrop.querySelector("#dcm-mark-completed");
  if (completeBtn) completeBtn.addEventListener("click", async () => {
    if (deadline.deadline_type === "Audit") {
      const reportDateText = prompt("Audit Report Date (DD/MM/YYYY) — required:");
      if (reportDateText === null) return;
      const reportDate = dmyToISO(reportDateText.trim());
      if (!reportDateText.trim() || reportDate === undefined) {
        alert(`Please enter a valid Audit Report Date in DD/MM/YYYY format.`);
        return;
      }
      const archivalDateText = prompt("Archival Date (DD/MM/YYYY) — required:");
      if (archivalDateText === null) return;
      const archivalDate = dmyToISO(archivalDateText.trim());
      if (!archivalDateText.trim() || archivalDate === undefined) {
        alert(`Please enter a valid Archival Date in DD/MM/YYYY format.`);
        return;
      }

      if (deadline.work_order_id) {
        // Update the linked work order - the existing completion trigger
        // will flip it (and this deadline, via the existing sync trigger)
        // to Completed once steps are also done.
        const { error: woError, data: woData } = await supabase
          .from("work_orders")
          .update({ audit_report_date: reportDate, archival_date: archivalDate })
          .eq("id", deadline.work_order_id)
          .select("status")
          .single();
        if (woError) { alert("Could not update: " + woError.message); return; }
        if (woData?.status !== "completed") {
          alert("Dates saved. This work order still has outstanding steps, so it will only show as Completed once those are also finished.");
        }
      } else {
        // No work order (backlog/manual case) - store the dates directly
        // on the deadline and mark it completed now.
        const { error } = await supabase.from("client_deadlines").update({
          status: "completed", completed_date: reportDate, manual_report_date: reportDate, manual_archival_date: archivalDate, manual_override: true,
        }).eq("id", deadline.id);
        if (error) { alert("Could not update: " + error.message); return; }
      }
      await refresh();
      return;
    }

    if (["Form C", "CP204", "CP204A 6th", "CP204A 9th", "CP204A 11th"].includes(deadline.deadline_type)) {
      const label = deadline.deadline_type === "Form C" ? "Final Tax" : deadline.deadline_type === "CP204" ? "Tax Estimate" : "Revision";
      const amountText = prompt(`${label} amount (RM) — required:`);
      if (amountText === null) return;
      const amount = parseFloat(amountText.trim());
      if (!amountText.trim() || isNaN(amount)) {
        alert(`Please enter a valid ${label} amount.`);
        return;
      }

      const orgId = getIdentity()?.organisationId;
      const field = deadline.deadline_type === "Form C" ? "final_tax_balance" : "this_year_estimate";
      const { error: tetError } = await supabase.from("tax_estimate_tracking").upsert({
        organisation_id: orgId, client_id: client.id, financial_year: deadline.financial_year, deadline_type: deadline.deadline_type,
        [field]: amount, updated_at: new Date().toISOString(),
      }, { onConflict: "client_id,financial_year,deadline_type" });
      if (tetError) { alert("Could not save: " + tetError.message); return; }

      const { error } = await supabase.from("client_deadlines").update({
        status: "completed", completed_date: new Date().toISOString().slice(0, 10), manual_override: true,
      }).eq("id", deadline.id);
      if (error) { alert("Could not update: " + error.message); return; }
      await refresh();
      return;
    }

    const dateText = prompt("Date completed (DD/MM/YYYY) — leave blank if you don't have a date:");
    if (dateText === null) return;
    let completedDate = null;
    if (dateText.trim()) {
      completedDate = dmyToISO(dateText.trim());
      if (completedDate === undefined) { alert(`Could not understand "${dateText}". Use DD/MM/YYYY.`); return; }
    }
    const { error } = await supabase.from("client_deadlines").update({ status: "completed", completed_date: completedDate, manual_override: true }).eq("id", deadline.id);
    if (error) { alert("Could not update: " + error.message); return; }
    await refresh();
  });

  const notCompletedBtn = backdrop.querySelector("#dcm-mark-not-completed");
  if (notCompletedBtn) notCompletedBtn.addEventListener("click", async () => {
    const { error } = await supabase.from("client_deadlines").update({ status: "not_due", completed_date: null, manual_override: true }).eq("id", deadline.id);
    if (error) { alert("Could not update: " + error.message); return; }
    await refresh();
  });

  const naBtn = backdrop.querySelector("#dcm-mark-na");
  if (naBtn) naBtn.addEventListener("click", async () => {
    const { error } = await supabase.from("client_deadlines").update({ status: "not_applicable", manual_override: true }).eq("id", deadline.id);
    if (error) { alert("Could not update: " + error.message); return; }
    await refresh();
  });
}

async function openClientDetailsModal(client) {
  const orgId = getIdentity()?.organisationId;

  const [{ data: contact }, { data: workOrders }] = await Promise.all([
    supabase.from("client_contacts").select("name, email, phone").eq("client_id", client.id).eq("is_primary", true).maybeSingle(),
    supabase
      .from("work_orders")
      .select("id, order_type, work_order_number, created_at, current_step_label, audit_report_date, archival_date, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, partner_user_id, manager_user_id, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email), manager:profiles!manager_user_id(display_name, email)")
      .eq("client_id", client.id)
      .order("deadline_date", { ascending: true, nullsFirst: false }),
  ]);

  const directors = client.directors || [];

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:1400px;width:98vw;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Client Details</h2>
          <p class="modal-subtitle">Comprehensive information about the client</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" id="details-edit-btn" class="btn-secondary" style="width:auto;">Edit</button>
          <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
        </div>
      </div>

      <h3 style="margin-top:0;">Company Information</h3>
      <div class="modal-grid">
        <div><label class="option-label">Company Name</label><div>${client.legal_name}</div></div>
        <div><label class="option-label">Registration Number</label><div>${client.registration_number || "-"}</div></div>
        <div><label class="option-label">Tax Identification Number (C Number)</label><div>${client.tin || "-"}</div></div>
        <div><label class="option-label">E Number</label><div>${client.e_number || "-"}</div></div>
        <div><label class="option-label">Industry</label><div>${client.industry || "-"}</div></div>
        <div class="full-width"><label class="option-label">Company Address</label><div>${client.company_address || "-"}</div></div>
        <div><label class="option-label">Contact Person</label><div>${contact?.name || "-"}</div></div>
        <div><label class="option-label">Email</label><div>${contact?.email || "-"}</div></div>
        <div><label class="option-label">Phone</label><div>${contact?.phone || "-"}</div></div>
      </div>

      <h3 style="margin-top:24px;">Engagement Details</h3>
      <div class="modal-grid">
        <div><label class="option-label">Branch</label><div>${client.branch || "-"}</div></div>
        <div><label class="option-label">Team</label><div>${allTeams.find((t) => t.id === client.team_id)?.name || "-"}</div></div>
        <div><label class="option-label">Engagement Type</label><div>${client.engagement_type === "audit" ? "Audit Only" : client.engagement_type === "tax" ? "Tax Only" : "Audit & Tax"}</div></div>
        <div><label class="option-label">Financial Year End</label><div>${client.fye_month ? MONTH_NAMES[client.fye_month - 1] : "-"}</div></div>
        <div><label class="option-label">Appointment of Auditor Date</label><div>${isoToDMY(client.appointment_of_auditor_date) || "-"}</div></div>
        <div><label class="option-label">Resignation Date</label><div>${isoToDMY(client.resignation_date) || "-"}</div></div>
        <div><label class="option-label">Outstanding Work Orders</label><div>${client.outstanding_work_orders > 0 ? `<span class="status-badge status-wip">${client.outstanding_work_orders} outstanding</span>` : `<span class="status-badge status-completed">None</span>`}</div></div>
      </div>

      <h3 style="margin-top:24px;">Fees</h3>
      <div class="modal-grid">
        <div><label class="option-label">Audit Fee</label><div>${money(client.audit_fee)}</div></div>
        <div><label class="option-label">Tax Fee</label><div>${money(client.tax_fee)}</div></div>
        <div><label class="option-label">Special Fee</label><div>${money(client.special_fee)}</div></div>
        <div><label class="option-label">Total Fee</label><div><strong>${money(client.total_fee)}</strong></div></div>
      </div>

      ${client.remark ? `
        <h3 style="margin-top:24px;">Remark</h3>
        <p style="white-space:pre-wrap;margin:0;">${client.remark}</p>` : ""}

      ${directors.length ? `
        <h3 style="margin-top:24px;">Directors</h3>
        <ul style="margin:8px 0 0;padding-left:20px;">
          ${directors.map((d) => `<li>${d}</li>`).join("")}
        </ul>` : ""}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;">
        <h3 style="margin:0;">Compliance Tracker</h3>
        ${isManagerOrAdmin() && client.fye_month ? `<button id="generate-deadlines-btn" class="btn-secondary" style="width:auto;">Generate Deadlines for a Year</button>` : ""}
      </div>
      ${!client.fye_month ? `<p class="hint" style="margin-top:8px;">Set a Financial Year End for this client to start tracking compliance deadlines — the current year generates automatically the moment you do.</p>` : ""}
      <div id="compliance-matrix-wrap" style="margin-top:12px;"></div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;">
        <h3 style="margin:0;">Work Orders</h3>
        ${isManagerOrAdmin() ? `<button id="add-wo-from-client-btn" class="btn-dark" style="width:auto;">+ Add Work Order</button>` : ""}
      </div>
      <div id="client-wo-table-wrap" style="margin-top:12px;"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  await renderComplianceMatrix(document.getElementById("compliance-matrix-wrap"), client);

  const genBtn = document.getElementById("generate-deadlines-btn");
  if (genBtn) {
    genBtn.addEventListener("click", async () => {
      const currentYear = new Date().getFullYear();
      const yearText = prompt("Generate deadlines for which financial year?", String(currentYear));
      if (!yearText) return;
      const year = parseInt(yearText.trim(), 10);
      if (!year || year < 2000 || year > 2100) { alert("Enter a valid year, e.g. 2025."); return; }

      genBtn.disabled = true;
      genBtn.textContent = "Generating...";
      const { error } = await supabase.rpc("generate_client_deadlines", { client_uuid: client.id, target_year: year });
      genBtn.disabled = false;
      genBtn.textContent = "Generate Deadlines for a Year";
      if (error) { alert("Could not generate deadlines: " + error.message); return; }
      await renderComplianceMatrix(document.getElementById("compliance-matrix-wrap"), client);
    });
  }

  async function refreshClientWorkOrders() {
    const { data: refreshed } = await supabase
      .from("work_orders")
      .select("id, order_type, work_order_number, created_at, current_step_label, audit_report_date, archival_date, financial_year_end, deadline_date, status, description, professional_fee, ope, budget_fee, client_id, assigned_user_id, partner_user_id, manager_user_id, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email), manager:profiles!manager_user_id(display_name, email)")
      .eq("client_id", client.id)
      .order("deadline_date", { ascending: true, nullsFirst: false });
    renderWorkOrdersTable(document.getElementById("client-wo-table-wrap"), refreshed || [], { showClient: false, onChanged: refreshClientWorkOrders });
  }

  renderWorkOrdersTable(document.getElementById("client-wo-table-wrap"), workOrders || [], {
    showClient: false,
    onChanged: refreshClientWorkOrders,
  });

  const addWoBtn = document.getElementById("add-wo-from-client-btn");
  if (addWoBtn) {
    addWoBtn.addEventListener("click", () => {
      openWorkOrderModal({ clientId: client.id, onSaved: refreshClientWorkOrders });
    });
  }

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#details-edit-btn").addEventListener("click", () => {
    close();
    openClientModal(client);
  });
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
}

async function openClientModal(existing) {
  const isEdit = !!existing;
  const orgId = getIdentity()?.organisationId;
  let primaryContact = { name: "", email: "", phone: "" };

  const [{ data: contactData }, { data: branchesData }, { data: teams }] = await Promise.all([
    isEdit
      ? supabase.from("client_contacts").select("id, name, email, phone").eq("client_id", existing.id).eq("is_primary", true).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("branches").select("id, name").eq("organisation_id", orgId).order("name"),
    supabase.from("teams").select("id, name, branch_id").eq("organisation_id", orgId).order("name"),
  ]);
  if (contactData) primaryContact = contactData;
  const branchOptions = branchesData || [];
  const teamOptions = teams || [];

  // Existing clients may have a team but no branch_id yet (added before this
  // column existed) — derive the branch from their team so the dropdown
  // still shows the right selection.
  const selectedTeam = teamOptions.find((t) => t.id === existing?.team_id);
  const effectiveBranchId = existing?.branch_id || selectedTeam?.branch_id || "";

  const directors = existing?.directors || [];
  const directorInput = (i) => `<input type="text" id="cf-director-${i}" placeholder="Director ${i + 1} name" value="${directors[i] ?? ""}" />`;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${isEdit ? "Edit Client" : "Add New Client"}</h2>
          <p class="modal-subtitle">${isEdit ? (isManagerOrAdmin() ? "Update this client's information" : "Changes will be sent to your admin for approval") : "Enter information for the new client"}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="client-form">
        <div class="modal-grid">
          <label>Company Name <span style="color:#dc2626;">*</span>
            <input type="text" id="cf-legal-name" required value="${existing?.legal_name ?? ""}" />
          </label>
          <label>Registration Number
            <input type="text" id="cf-reg-number" value="${existing?.registration_number ?? ""}" />
          </label>
          <label>Tax Identification Number (C Number)
            <input type="text" id="cf-tin" value="${existing?.tin ?? ""}" />
            <span class="hint">Needed for Tax Estimate Monitoring automation.</span>
          </label>
          <label>E Number
            <input type="text" id="cf-e-number" value="${existing?.e_number ?? ""}" />
          </label>

          <label>Contact Person
            <input type="text" id="cf-contact-name" value="${primaryContact.name ?? ""}" />
          </label>
          <label>Email
            <input type="email" id="cf-contact-email" value="${primaryContact.email ?? ""}" />
          </label>

          <label>Phone
            <input type="text" id="cf-contact-phone" value="${primaryContact.phone ?? ""}" />
          </label>
          <label>Financial Year End <span style="color:#dc2626;">*</span>
            <select id="cf-fye-month" required>
              <option value="">Select a month...</option>
              ${MONTH_NAMES.map((name, i) => `<option value="${i + 1}" ${existing?.fye_month === i + 1 ? "selected" : ""}>${name}</option>`).join("")}
            </select>
            <span class="hint">Just the month — it repeats every year, so deadlines can be tracked across financial years.</span>
          </label>

          <label>Industry
            <input type="text" id="cf-industry" value="${existing?.industry ?? ""}" />
          </label>
          <label>Audit Fee ($)
            <input type="number" step="0.01" id="cf-audit-fee" value="${existing?.audit_fee ?? ""}" />
          </label>
          <label>Tax Fee ($)
            <input type="number" step="0.01" id="cf-tax-fee" value="${existing?.tax_fee ?? ""}" />
          </label>
          <label>Special Fee ($)
            <input type="number" step="0.01" id="cf-special-fee" value="${existing?.special_fee ?? ""}" />
          </label>
          <label>Total Fee ($)
            <input type="text" id="cf-total-fee" value="${money(existing?.total_fee ?? 0)}" disabled style="background:var(--gray-50);font-weight:600;" />
            <span class="hint">Automatically the sum of Audit + Tax + Special.</span>
          </label>

          <label>Engagement Type <span style="color:#dc2626;">*</span>
            <select id="cf-engagement-type" required>
              <option value="both" ${(existing?.engagement_type ?? "both") === "both" ? "selected" : ""}>Audit &amp; Tax</option>
              <option value="audit" ${existing?.engagement_type === "audit" ? "selected" : ""}>Audit Only</option>
              <option value="tax" ${existing?.engagement_type === "tax" ? "selected" : ""}>Tax Only</option>
            </select>
            <span class="hint">Deadlines outside this scope are automatically marked Not Applicable in the Compliance Tracker — you can still override any individual cell there.</span>
          </label>

          <label>Appointment of Auditor Date
            <input type="text" id="cf-appointment-date" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.appointment_of_auditor_date)}" />
            <span class="hint">Fills in automatically when an Appointment of Auditor work order completes — set manually here for existing clients.</span>
          </label>
          <label>Resignation Date
            <input type="text" id="cf-resignation-date" placeholder="31/12/2025" autocomplete="off" value="${isoToDMY(existing?.resignation_date)}" />
            <span class="hint">Setting this marks the client as resigned — they're excluded from the active list but kept for historical reporting.</span>
          </label>

          <label class="full-width">Remark
            <textarea id="cf-remark" rows="2" placeholder="e.g. backlog case, going for strike off..." style="width:100%;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;">${existing?.remark ?? ""}</textarea>
            <span class="hint">Shows up wherever this client appears — Dashboard drill-downs, Client Details, and so on.</span>
          </label>

          ${isManagerOrAdmin() ? `
            <label>Branch <span style="color:#dc2626;">*</span>
              <select id="cf-branch-select" required>
                <option value="">Select a branch...</option>
                ${branchOptions.map((b) => `<option value="${b.id}" ${effectiveBranchId === b.id ? "selected" : ""}>${b.name}</option>`).join("")}
              </select>
              ${branchOptions.length ? "" : `<span class="hint">No branches yet — add some in Firm Settings.</span>`}
            </label>

            <label>Team <span style="color:#dc2626;">*</span>
              <select id="cf-team" required>
                <option value="">Select a branch first...</option>
              </select>
              <span class="hint" id="cf-team-hint">Controls who can see this client.</span>
            </label>
          ` : ""}

          <label class="full-width">Company Address
            <input type="text" id="cf-address" value="${existing?.company_address ?? ""}" />
          </label>

          <div class="full-width">
            <p class="directors-label">Directors (up to 5)</p>
            <div class="modal-grid" style="margin-top:6px;">
              ${directorInput(0)}${directorInput(1)}${directorInput(2)}${directorInput(3)}
              <div>${directorInput(4)}</div>
            </div>
          </div>
        </div>

        <p id="cf-error" class="form-error hidden"></p>

        <div class="modal-actions">
          <button type="button" id="cf-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${isEdit ? (isManagerOrAdmin() ? "Save Changes" : "Submit for Approval") : "Add Client"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  function refreshTotalFee() {
    const audit = parseFloat(document.getElementById("cf-audit-fee").value) || 0;
    const tax = parseFloat(document.getElementById("cf-tax-fee").value) || 0;
    const special = parseFloat(document.getElementById("cf-special-fee").value) || 0;
    document.getElementById("cf-total-fee").value = money(audit + tax + special);
  }
  ["cf-audit-fee", "cf-tax-fee", "cf-special-fee"].forEach((id) => {
    document.getElementById(id).addEventListener("input", refreshTotalFee);
  });

  try {
    await loadFlatpickr();
    window.flatpickr("#cf-appointment-date", { dateFormat: "d/m/Y", allowInput: true });
    window.flatpickr("#cf-resignation-date", { dateFormat: "d/m/Y", allowInput: true });
  } catch (err) {
    console.warn(err.message);
  }

  const branchSelect = document.getElementById("cf-branch-select");
  const teamSelect = document.getElementById("cf-team");
  const teamHint = document.getElementById("cf-team-hint");
  function refreshTeamOptions() {
    if (!branchSelect || !teamSelect) return;
    const branchId = branchSelect.value;
    if (!branchId) {
      teamSelect.innerHTML = `<option value="">Select a branch first...</option>`;
      teamSelect.disabled = true;
      return;
    }
    const teamsInBranch = teamOptions.filter((t) => t.branch_id === branchId);
    if (!teamsInBranch.length) {
      teamSelect.innerHTML = `<option value="">No teams yet</option>`;
      teamSelect.disabled = true;
      if (teamHint) teamHint.textContent = "This branch has no teams yet — add one in Firm Settings before assigning a client here.";
      return;
    }
    teamSelect.disabled = false;
    if (teamHint) teamHint.textContent = "Controls who can see this client.";
    const preselect = teamsInBranch.length === 1 ? teamsInBranch[0].id : (existing?.team_id || "");
    teamSelect.innerHTML = `<option value="">Select a team...</option>${teamsInBranch.map((t) => `<option value="${t.id}" ${preselect === t.id ? "selected" : ""}>${t.name}</option>`).join("")}`;
  }
  if (branchSelect) {
    // Auto-select the branch when there's only one to choose from and nothing is set yet.
    if (!effectiveBranchId && branchOptions.length === 1) branchSelect.value = branchOptions[0].id;
    refreshTeamOptions();
    branchSelect.addEventListener("change", refreshTeamOptions);
  }

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  document.getElementById("cf-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  document.getElementById("client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgId = getIdentity()?.organisationId;
    const errorEl = document.getElementById("cf-error");

    const fyeMonth = document.getElementById("cf-fye-month").value || null;

    const directorsList = [0, 1, 2, 3, 4]
      .map((i) => document.getElementById(`cf-director-${i}`).value.trim())
      .filter(Boolean);

    const selectedBranchId = document.getElementById("cf-branch-select")?.value || null;
    const selectedBranchName = selectedBranchId ? branchOptions.find((b) => b.id === selectedBranchId)?.name : null;
    const selectedTeamId = document.getElementById("cf-team")?.value || null;

    if (!document.getElementById("cf-legal-name").value.trim()) {
      errorEl.textContent = "Please enter the Company Name.";
      errorEl.classList.remove("hidden");
      return;
    }
    if (!fyeMonth) {
      errorEl.textContent = "Please select a Financial Year End.";
      errorEl.classList.remove("hidden");
      return;
    }
    if (isManagerOrAdmin()) {
      if (!selectedBranchId) {
        errorEl.textContent = "Please select a Branch.";
        errorEl.classList.remove("hidden");
        return;
      }
      if (!selectedTeamId) {
        errorEl.textContent = "Please select a Team — every client needs one so work orders carry the right branch/team codes.";
        errorEl.classList.remove("hidden");
        return;
      }
    }

    const appointmentDateText = document.getElementById("cf-appointment-date").value.trim();
    const parsedAppointmentDate = appointmentDateText ? dmyToISO(appointmentDateText) : null;
    if (appointmentDateText && parsedAppointmentDate === undefined) {
      errorEl.textContent = `Could not understand the date "${appointmentDateText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }

    const resignationDateText = document.getElementById("cf-resignation-date").value.trim();
    const parsedResignationDate = resignationDateText ? dmyToISO(resignationDateText) : null;
    if (resignationDateText && parsedResignationDate === undefined) {
      errorEl.textContent = `Could not understand the date "${resignationDateText}". Use DD/MM/YYYY.`;
      errorEl.classList.remove("hidden");
      return;
    }

    const payload = {
      organisation_id: orgId,
      legal_name: document.getElementById("cf-legal-name").value.trim(),
      registration_number: document.getElementById("cf-reg-number").value.trim() || null,
      tin: document.getElementById("cf-tin").value.trim() || null,
      e_number: document.getElementById("cf-e-number").value.trim() || null,
      fye_month: fyeMonth ? Number(fyeMonth) : null,
      appointment_of_auditor_date: parsedAppointmentDate || null,
      resignation_date: parsedResignationDate || null,
      remark: document.getElementById("cf-remark").value.trim() || null,
      engagement_type: document.getElementById("cf-engagement-type").value,
      audit_fee: document.getElementById("cf-audit-fee").value || null,
      tax_fee: document.getElementById("cf-tax-fee").value || null,
      special_fee: document.getElementById("cf-special-fee").value || null,
      ...(document.getElementById("cf-branch-select") ? { branch: selectedBranchName, branch_id: selectedBranchId, team_id: selectedTeamId } : {}),
      industry: document.getElementById("cf-industry").value.trim() || null,
      company_address: document.getElementById("cf-address").value.trim() || null,
      directors: directorsList.length ? directorsList : null,
    };

    let clientId = existing?.id;
    let pendingApproval = false;

    if (isEdit && !isManagerOrAdmin()) {
      const normalize = (v) => (Array.isArray(v) ? JSON.stringify(v) : v === null || v === undefined || v === "" ? "" : String(v));
      const proposedChanges = {};
      const previousValues = {};
      for (const [key, newVal] of Object.entries(payload)) {
        if (key === "organisation_id") continue;
        const oldVal = existing[key];
        if (normalize(oldVal) !== normalize(newVal)) {
          proposedChanges[key] = newVal;
          previousValues[key] = oldVal ?? null;
        }
      }

      if (Object.keys(proposedChanges).length > 0) {
        const diffSummary = Object.entries(proposedChanges)
          .map(([key, val]) => `${FIELD_LABELS[key] || key}: "${previousValues[key] ?? "-"}" → "${Array.isArray(val) ? val.join(", ") : val}"`)
          .join("; ");
        const { error } = await supabase.from("work_orders").insert({
          organisation_id: orgId,
          client_id: clientId,
          order_type: "client_update",
          status: "not_started",
          description: diffSummary,
          proposed_changes: proposedChanges,
          previous_values: previousValues,
          created_by: getIdentity().user.id,
        });
        if (error) { errorEl.textContent = "Could not submit change request: " + error.message; errorEl.classList.remove("hidden"); return; }
        pendingApproval = true;
      }
    } else if (isEdit) {
      const { error } = await supabase.from("clients").update(payload).eq("id", clientId);
      if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    } else {
      const { data, error } = await supabase.rpc("create_client", { payload });
      if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
      clientId = data;
    }

    const contactName = document.getElementById("cf-contact-name").value.trim();
    const contactEmail = document.getElementById("cf-contact-email").value.trim();
    const contactPhone = document.getElementById("cf-contact-phone").value.trim();
    if (contactName || contactEmail || contactPhone) {
      if (primaryContact.id) {
        await supabase.from("client_contacts").update({ name: contactName || null, email: contactEmail || null, phone: contactPhone || null }).eq("id", primaryContact.id);
      } else {
        await supabase.from("client_contacts").insert({ organisation_id: orgId, client_id: clientId, name: contactName || null, email: contactEmail || null, phone: contactPhone || null, is_primary: true });
      }
    }

    close();
    resetFilters();
    await loadAndRenderTable();
    if (pendingApproval) alert("Your changes have been submitted for admin approval.");
  });
}

async function handleImportFile(file) {
  const orgId = getIdentity()?.organisationId;
  const importSection = document.getElementById("import-section");
  importSection.innerHTML = `<div class="import-card"><p class="hint">Loading spreadsheet library...</p></div>`;

  try {
    await loadSheetJS();
  } catch (err) {
    importSection.innerHTML = `<div class="import-card"><p class="form-error">${err.message}</p></div>`;
    return;
  }

  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true });
  const { rows, error, sheetName } = parseClientWorkbook(workbook);

  if (error) {
    importSection.innerHTML = `<div class="import-card"><p class="form-error">${error}</p></div>`;
    return;
  }

  const { data: existingClients } = await supabase.from("clients").select("legal_name").eq("organisation_id", orgId);
  const existingNormalizedNames = new Set((existingClients || []).map((c) => c.legal_name.trim().toLowerCase()));

  const validatedRows = rows.map((r) => validateRow(r, existingNormalizedNames));
  const counts = validatedRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const importableCount = (counts.valid || 0) + (counts.warning || 0);

  importSection.innerHTML = `
    <div class="import-card">
      <h3>Import Review — "${sheetName}" sheet</h3>
      <div class="kpi-grid" style="margin-bottom:16px;">
        <div class="kpi-card"><div class="kpi-value">${validatedRows.length}</div><div class="kpi-label">Total rows</div></div>
        <div class="kpi-card"><div class="kpi-value">${counts.valid || 0}</div><div class="kpi-label">Valid</div></div>
        <div class="kpi-card"><div class="kpi-value">${counts.warning || 0}</div><div class="kpi-label">Warnings</div></div>
        <div class="kpi-card"><div class="kpi-value">${counts.rejected || 0}</div><div class="kpi-label">Rejected</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Row</th><th>Company</th><th>FYE</th><th>Branch</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>
          ${validatedRows
            .map(
              (r) => `<tr>
                <td>${r.source_row}</td><td>${r.company_name}</td><td>${r.fye || "-"}</td>
                <td>${r.branch || "-"}</td>
                <td><span class="status-badge status-${r.status}">${r.status}</span></td>
                <td>${r.issues.join("; ") || "-"}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <button id="confirm-import-btn" class="btn-primary" style="width:auto;" ${importableCount === 0 ? "disabled" : ""}>
          Confirm Import (${importableCount} row${importableCount === 1 ? "" : "s"})
        </button>
        <button id="cancel-import-btn" class="btn-link">Cancel</button>
      </div>
      <p id="import-result" class="hint"></p>
    </div>
  `;

  document.getElementById("cancel-import-btn").addEventListener("click", () => { importSection.innerHTML = ""; });

  const confirmBtn = document.getElementById("confirm-import-btn");
  confirmBtn?.addEventListener("click", async () => {
    const resultEl = document.getElementById("import-result");
    const rowsToImport = validatedRows.filter((r) => r.status !== "rejected");
    if (!rowsToImport.length) { resultEl.textContent = "Nothing to import."; return; }

    confirmBtn.disabled = true;
    resultEl.textContent = "Importing...";

    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({ organisation_id: orgId, filename: file.name, imported_by: getIdentity().user.id, status: "pending" })
      .select()
      .single();

    if (batchError) {
      resultEl.textContent = "Could not start import: " + batchError.message;
      confirmBtn.disabled = false;
      return;
    }

    const { data, error: importError } = await supabase.rpc("import_completed_rows", {
      import_batch_uuid: batch.id,
      rows_jsonb: rowsToImport,
    });

    if (importError) {
      resultEl.textContent = "Import failed: " + importError.message;
      confirmBtn.disabled = false;
      return;
    }
    resultEl.textContent = `Done — ${data.inserted} row(s) imported, ${data.skipped} skipped.`;
    resetFilters();
    await loadAndRenderTable();
  });
}
