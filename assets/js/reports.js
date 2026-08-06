// assets/js/reports.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { loadSheetJS, fetchAllRows } from "./excel-utils.js";
import { getOrderTypeLabel } from "./work-orders.js";

function isoToDMYRep(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function downloadWorkbook(headers, rows, filename) {
  const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Report");
  window.XLSX.writeFile(wb, filename);
}

async function runClientKeyDatesReport(orgId) {
  const statusEl = document.getElementById("rep-keydates-status");
  const primary = document.getElementById("rep-keydates-primary").value;
  const dateFrom = document.getElementById("rep-keydates-date-from").value;
  const dateTo = document.getElementById("rep-keydates-date-to").value;
  const includeAppointment = document.getElementById("rep-keydates-include-appointment").checked;
  const includeResignation = document.getElementById("rep-keydates-include-resignation").checked;
  const includeReport = document.getElementById("rep-keydates-include-report").checked;
  const includeArchival = document.getElementById("rep-keydates-include-archival").checked;

  statusEl.textContent = "Generating...";
  await loadSheetJS();

  let rowObjects = [];

  if (primary === "appointment" || primary === "resignation") {
    const dateColumn = primary === "appointment" ? "appointment_of_auditor_date" : "resignation_date";
    let query = supabase.from("clients").select("id, legal_name, registration_number, tin, appointment_of_auditor_date, resignation_date").eq("organisation_id", orgId).not(dateColumn, "is", null);
    if (dateFrom) query = query.gte(dateColumn, dateFrom);
    if (dateTo) query = query.lte(dateColumn, dateTo);
    const { data: clientsData, error } = await query;
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }

    const clientIds = (clientsData || []).map((c) => c.id);
    const latestAuditByClient = {};
    if (clientIds.length) {
      const { data: audits } = await fetchAllRows(
        supabase
          .from("client_deadlines")
          .select("client_id, financial_year, manual_report_date, manual_archival_date, work_orders(audit_report_date, archival_date)")
          .eq("deadline_type", "Audit")
          .in("client_id", clientIds)
          .order("financial_year", { ascending: false })
      );
      (audits || []).forEach((a) => { if (!latestAuditByClient[a.client_id]) latestAuditByClient[a.client_id] = a; });
    }

    rowObjects = (clientsData || []).map((c) => {
      const a = latestAuditByClient[c.id];
      return {
        legal_name: c.legal_name || "", registration_number: c.registration_number || "", tin: c.tin || "",
        appointment_date: c.appointment_of_auditor_date, resignation_date: c.resignation_date,
        financial_year: a ? `FY${a.financial_year}` : "",
        report_date: a ? (a.work_orders?.audit_report_date ?? a.manual_report_date) : null,
        archival_date: a ? (a.work_orders?.archival_date ?? a.manual_archival_date) : null,
      };
    });
  } else {
    const { data: allClientIds } = await supabase.from("clients").select("id").eq("organisation_id", orgId);
    const clientIds = (allClientIds || []).map((c) => c.id);
    if (!clientIds.length) { statusEl.textContent = "No clients found."; return; }

    const { data: audits, error } = await fetchAllRows(
      supabase
        .from("client_deadlines")
        .select("client_id, financial_year, manual_report_date, manual_archival_date, work_orders(audit_report_date, archival_date), clients(legal_name, registration_number, tin, appointment_of_auditor_date, resignation_date)")
        .eq("deadline_type", "Audit")
        .in("client_id", clientIds)
    );
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }

    const filtered = (audits || []).filter((a) => {
      const dateVal = primary === "report" ? (a.work_orders?.audit_report_date ?? a.manual_report_date) : (a.work_orders?.archival_date ?? a.manual_archival_date);
      if (!dateVal) return false;
      if (dateFrom && dateVal < dateFrom) return false;
      if (dateTo && dateVal > dateTo) return false;
      return true;
    });

    rowObjects = filtered.map((a) => ({
      legal_name: a.clients?.legal_name || "", registration_number: a.clients?.registration_number || "", tin: a.clients?.tin || "",
      appointment_date: a.clients?.appointment_of_auditor_date, resignation_date: a.clients?.resignation_date,
      financial_year: `FY${a.financial_year}`,
      report_date: a.work_orders?.audit_report_date ?? a.manual_report_date,
      archival_date: a.work_orders?.archival_date ?? a.manual_archival_date,
    }));
  }

  if (!rowObjects.length) {
    statusEl.textContent = "No records found for the selected criteria.";
    return;
  }

  const headers = ["Company Name", "Registration Number", "TIN"];
  if (includeAppointment) headers.push("Appointment Date");
  if (includeResignation) headers.push("Resignation Date");
  headers.push("Financial Year");
  if (includeReport) headers.push("Audit Report Date");
  if (includeArchival) headers.push("Archival Date");

  const rows = rowObjects.map((r) => {
    const row = [r.legal_name, r.registration_number, r.tin];
    if (includeAppointment) row.push(isoToDMYRep(r.appointment_date));
    if (includeResignation) row.push(isoToDMYRep(r.resignation_date));
    row.push(r.financial_year);
    if (includeReport) row.push(isoToDMYRep(r.report_date));
    if (includeArchival) row.push(isoToDMYRep(r.archival_date));
    return row;
  });

  downloadWorkbook(headers, rows, "Client-Key-Dates-Report.xlsx");
  statusEl.textContent = `Downloaded (${rows.length} row${rows.length === 1 ? "" : "s"}).`;
}

export async function renderReports(el) {
  el.innerHTML = `
    <div class="page-header"><h1>Generate Report</h1></div>

    <div class="import-card">
      <h3 style="margin-top:0;">Built-in Reports</h3>
      <p class="hint">One click, respects whatever branch/team data you have access to.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;">
        <button class="btn-secondary" style="width:auto;align-self:flex-start;" data-builtin="audit_completion">Audit Completion Report</button>
        <button class="btn-secondary" style="width:auto;align-self:flex-start;" data-builtin="client_directory">Client Directory</button>
        <button class="btn-secondary" style="width:auto;align-self:flex-start;" data-builtin="work_orders_summary">Work Orders Summary</button>
        <button class="btn-secondary" style="width:auto;align-self:flex-start;" data-builtin="overdue_deadlines">Overdue Deadlines</button>
        <button class="btn-secondary" style="width:auto;align-self:flex-start;" data-builtin="independence_concerns">Independence Concerns</button>
      </div>
      <p id="builtin-status" class="hint" style="margin-top:10px;"></p>
    </div>

    <div class="import-card">
      <h3 style="margin-top:0;">Client Key Dates Report</h3>
      <p class="hint">Choose which date drives the report and its range, then pick which other dates to include as extra columns.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <select id="rep-keydates-primary" class="filter-select">
          <option value="appointment">Client Appointed</option>
          <option value="resignation">Client Resigned</option>
          <option value="report">Audit Report Date</option>
          <option value="archival">Archival Date</option>
        </select>
        <input type="date" id="rep-keydates-date-from" class="filter-select" title="From date" />
        <input type="date" id="rep-keydates-date-to" class="filter-select" title="To date" />
        <button id="rep-keydates-generate" class="btn-dark">Generate & Download</button>
      </div>
      <p class="hint" style="margin-top:8px;">Picking Client Appointed or Client Resigned gives one row per client (with their latest audit dates shown for reference, if included below). Picking Audit Report Date or Archival Date gives one row per client per financial year, since those can repeat across years.</p>
      <p class="option-label" style="margin-top:12px;margin-bottom:4px;">Include these as extra columns:</p>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="checkbox" id="rep-keydates-include-appointment" checked /> Appointment Date</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="checkbox" id="rep-keydates-include-resignation" checked /> Resignation Date</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="checkbox" id="rep-keydates-include-report" checked /> Audit Report Date</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="checkbox" id="rep-keydates-include-archival" checked /> Archival Date</label>
      </div>
      <p id="rep-keydates-status" class="hint" style="margin-top:10px;"></p>
    </div>

    <div class="import-card">
      <h3 style="margin-top:0;">Custom Report</h3>
      <p class="hint">Pick a data source and narrow it down, then download.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <select id="rep-source" class="filter-select">
          <option value="clients">Clients</option>
          <option value="work_orders">Work Orders</option>
          <option value="deadlines">Deadlines</option>
        </select>
        <select id="rep-branch" class="filter-select"><option value="">All Branches</option></select>
        <select id="rep-team" class="filter-select"><option value="">All Teams</option></select>
        <input type="date" id="rep-date-from" class="filter-select" title="From date" />
        <input type="date" id="rep-date-to" class="filter-select" title="To date" />
        <button id="rep-generate" class="btn-dark">Generate & Download</button>
      </div>
      <p class="hint" id="rep-date-hint" style="margin-top:8px;"></p>
      <p id="custom-status" class="hint" style="margin-top:6px;"></p>
    </div>
  `;

  const orgId = getIdentity()?.organisationId;
  const [{ data: branchesData }, { data: teamsData }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("organisation_id", orgId).order("name"),
    supabase.from("teams").select("id, name, branch_id").eq("organisation_id", orgId).order("name"),
  ]);
  const branches = branchesData || [];
  const teams = teamsData || [];

  document.getElementById("rep-keydates-generate").addEventListener("click", () => runClientKeyDatesReport(orgId));

  document.getElementById("rep-branch").innerHTML += branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
  document.getElementById("rep-team").innerHTML += teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");

  const dateHints = {
    clients: "Date range applies to Appointment of Auditor Date.",
    work_orders: "Date range applies to Created date.",
    deadlines: "Date range applies to Due Date.",
  };
  const sourceSelect = document.getElementById("rep-source");
  const updateHint = () => { document.getElementById("rep-date-hint").textContent = dateHints[sourceSelect.value]; };
  sourceSelect.addEventListener("change", updateHint);
  updateHint();

  document.querySelectorAll("[data-builtin]").forEach((btn) => {
    btn.addEventListener("click", () => runBuiltinReport(btn.dataset.builtin, orgId));
  });

  document.getElementById("rep-generate").addEventListener("click", () => runCustomReport(orgId, teams));
}

async function runBuiltinReport(key, orgId) {
  const statusEl = document.getElementById("builtin-status");
  statusEl.textContent = "Generating...";
  await loadSheetJS();

  if (key === "audit_completion") {
    const { data, error } = await supabase
      .from("work_orders")
      .select("work_order_number, financial_year_end, audit_report_date, archival_date, status, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email)")
      .eq("organisation_id", orgId)
      .eq("order_type", "audit");
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    downloadWorkbook(
      ["WO Number", "Client", "Financial Year", "Audit Report Date", "Archival Date", "Staff", "Partner", "Status"],
      (data || []).map((wo) => [
        wo.work_order_number || "", wo.clients?.legal_name || "", isoToDMYRep(wo.financial_year_end),
        isoToDMYRep(wo.audit_report_date), isoToDMYRep(wo.archival_date),
        wo.assigned?.display_name || wo.assigned?.email || "", wo.partner?.display_name || wo.partner?.email || "", wo.status,
      ]),
      "Audit-Completion-Report.xlsx"
    );
  }

  if (key === "client_directory") {
    const { data, error } = await supabase
      .from("clients")
      .select("legal_name, registration_number, industry, branch, fye_month, appointment_of_auditor_date, audit_fee, tax_fee, special_fee, total_fee")
      .eq("organisation_id", orgId);
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    downloadWorkbook(
      ["Company Name", "Registration Number", "Industry", "Branch", "Financial Year End", "Appointment of Auditor Date", "Audit Fee", "Tax Fee", "Special Fee", "Total Fee"],
      (data || []).map((c) => [
        c.legal_name || "", c.registration_number || "", c.industry || "", c.branch || "",
        c.fye_month ? monthNames[c.fye_month - 1] : "", isoToDMYRep(c.appointment_of_auditor_date),
        c.audit_fee ?? "", c.tax_fee ?? "", c.special_fee ?? "", c.total_fee ?? "",
      ]),
      "Client-Directory.xlsx"
    );
  }

  if (key === "work_orders_summary") {
    const { data, error } = await supabase
      .from("work_orders")
      .select("work_order_number, order_type, financial_year_end, deadline_date, status, budget_fee, created_at, clients(legal_name), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email)")
      .eq("organisation_id", orgId);
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    downloadWorkbook(
      ["WO Number", "Client", "Type", "Financial Year", "Deadline", "Status", "Budget Fee", "Staff", "Partner", "Created"],
      (data || []).map((wo) => [
        wo.work_order_number || "", wo.clients?.legal_name || "", getOrderTypeLabel(wo.order_type), isoToDMYRep(wo.financial_year_end),
        isoToDMYRep(wo.deadline_date), wo.status, wo.budget_fee ?? "",
        wo.assigned?.display_name || wo.assigned?.email || "", wo.partner?.display_name || wo.partner?.email || "",
        wo.created_at ? isoToDMYRep(wo.created_at.slice(0, 10)) : "",
      ]),
      "Work-Orders-Summary.xlsx"
    );
  }

  if (key === "overdue_deadlines") {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("client_deadlines")
      .select("deadline_type, deadline_date, financial_year, status, clients(legal_name)")
      .eq("organisation_id", orgId)
      .lt("deadline_date", todayStr)
      .not("status", "in", "(completed,not_applicable)");
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    downloadWorkbook(
      ["Client", "Deadline Type", "Financial Year", "Due Date", "Status"],
      (data || []).map((d) => [d.clients?.legal_name || "", d.deadline_type, `FY${d.financial_year}`, isoToDMYRep(d.deadline_date), d.status]),
      "Overdue-Deadlines.xlsx"
    );
  }

  if (key === "independence_concerns") {
    const { data, error } = await supabase
      .from("independence_concern_reports")
      .select("description, status, created_at, resolved_at, client_id, reported_by")
      .eq("organisation_id", orgId);
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    const clientIds = [...new Set((data || []).map((r) => r.client_id).filter(Boolean))];
    const reporterIds = [...new Set((data || []).map((r) => r.reported_by).filter(Boolean))];
    const [{ data: clientsData }, { data: reportersData }] = await Promise.all([
      clientIds.length ? supabase.from("clients").select("id, legal_name").in("id", clientIds) : Promise.resolve({ data: [] }),
      reporterIds.length ? supabase.from("profiles").select("id, display_name, email").in("id", reporterIds) : Promise.resolve({ data: [] }),
    ]);
    const clientNameById = Object.fromEntries((clientsData || []).map((c) => [c.id, c.legal_name]));
    const reporterNameById = Object.fromEntries((reportersData || []).map((p) => [p.id, p.display_name || p.email]));
    downloadWorkbook(
      ["Client", "Reported By", "Description", "Status", "Reported On", "Resolved On"],
      (data || []).map((r) => [
        clientNameById[r.client_id] || "", reporterNameById[r.reported_by] || "", r.description, r.status,
        isoToDMYRep(r.created_at.slice(0, 10)), r.resolved_at ? isoToDMYRep(r.resolved_at.slice(0, 10)) : "",
      ]),
      "Independence-Concerns.xlsx"
    );
  }

  statusEl.textContent = "Downloaded.";
}

async function runCustomReport(orgId, teams) {
  const statusEl = document.getElementById("custom-status");
  statusEl.textContent = "Generating...";
  await loadSheetJS();

  const source = document.getElementById("rep-source").value;
  const branchId = document.getElementById("rep-branch").value;
  const teamId = document.getElementById("rep-team").value;
  const dateFrom = document.getElementById("rep-date-from").value;
  const dateTo = document.getElementById("rep-date-to").value;
  const teamsInBranch = branchId ? new Set(teams.filter((t) => t.branch_id === branchId).map((t) => t.id)) : null;

  if (source === "clients") {
    let query = supabase.from("clients").select("legal_name, registration_number, industry, branch, team_id, fye_month, appointment_of_auditor_date, resignation_date, audit_fee, tax_fee, special_fee, total_fee").eq("organisation_id", orgId);
    if (teamId) query = query.eq("team_id", teamId);
    if (dateFrom) query = query.gte("appointment_of_auditor_date", dateFrom);
    if (dateTo) query = query.lte("appointment_of_auditor_date", dateTo);
    const { data, error } = await query;
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    const filtered = teamsInBranch ? (data || []).filter((c) => teamsInBranch.has(c.team_id)) : (data || []);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    downloadWorkbook(
      ["Company Name", "Registration Number", "Industry", "Branch", "Financial Year End", "Appointment of Auditor Date", "Resignation Date", "Audit Fee", "Tax Fee", "Special Fee", "Total Fee"],
      filtered.map((c) => [
        c.legal_name || "", c.registration_number || "", c.industry || "", c.branch || "", c.fye_month ? monthNames[c.fye_month - 1] : "", isoToDMYRep(c.appointment_of_auditor_date), isoToDMYRep(c.resignation_date),
        c.audit_fee ?? "", c.tax_fee ?? "", c.special_fee ?? "", c.total_fee ?? "",
      ]),
      "Custom-Clients-Report.xlsx"
    );
  }

  if (source === "work_orders") {
    let query = supabase
      .from("work_orders")
      .select("work_order_number, order_type, financial_year_end, deadline_date, status, budget_fee, created_at, client_id, clients(legal_name, team_id), assigned:profiles!assigned_user_id(display_name, email), partner:profiles!partner_user_id(display_name, email)")
      .eq("organisation_id", orgId);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59");
    const { data, error } = await query;
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    let filtered = data || [];
    if (teamId) filtered = filtered.filter((wo) => wo.clients?.team_id === teamId);
    else if (teamsInBranch) filtered = filtered.filter((wo) => teamsInBranch.has(wo.clients?.team_id));
    downloadWorkbook(
      ["WO Number", "Client", "Type", "Financial Year", "Deadline", "Status", "Budget Fee", "Staff", "Partner", "Created"],
      filtered.map((wo) => [
        wo.work_order_number || "", wo.clients?.legal_name || "", getOrderTypeLabel(wo.order_type), isoToDMYRep(wo.financial_year_end),
        isoToDMYRep(wo.deadline_date), wo.status, wo.budget_fee ?? "",
        wo.assigned?.display_name || wo.assigned?.email || "", wo.partner?.display_name || wo.partner?.email || "",
        wo.created_at ? isoToDMYRep(wo.created_at.slice(0, 10)) : "",
      ]),
      "Custom-Work-Orders-Report.xlsx"
    );
  }

  if (source === "deadlines") {
    let query = supabase
      .from("client_deadlines")
      .select("deadline_type, deadline_date, financial_year, status, client_id, clients(legal_name, team_id)")
      .eq("organisation_id", orgId);
    if (dateFrom) query = query.gte("deadline_date", dateFrom);
    if (dateTo) query = query.lte("deadline_date", dateTo);
    const { data, error } = await query;
    if (error) { statusEl.textContent = "Could not generate: " + error.message; return; }
    let filtered = data || [];
    if (teamId) filtered = filtered.filter((d) => d.clients?.team_id === teamId);
    else if (teamsInBranch) filtered = filtered.filter((d) => teamsInBranch.has(d.clients?.team_id));
    downloadWorkbook(
      ["Client", "Deadline Type", "Financial Year", "Due Date", "Status"],
      filtered.map((d) => [d.clients?.legal_name || "", d.deadline_type, `FY${d.financial_year}`, isoToDMYRep(d.deadline_date), d.status]),
      "Custom-Deadlines-Report.xlsx"
    );
  }

  statusEl.textContent = "Downloaded.";
}
