// assets/js/excel-utils.js
// Shared spreadsheet helpers used by the Client List page: template
// generation, parsing, and normalization.

export function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the spreadsheet library. Check your connection and try again."));
    document.head.appendChild(script);
  });
}

export function loadFlatpickr() {
  return new Promise((resolve, reject) => {
    if (window.flatpickr) { resolve(); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the calendar picker. Check your connection and try again."));
    document.head.appendChild(script);
  });
}

const PLACEHOLDER_VALUES = new Set(["", "-", "0", "#ref!"]);
function isPlaceholder(v) {
  if (v == null) return true;
  return PLACEHOLDER_VALUES.has(String(v).trim().toLowerCase());
}
function cleanText(v) {
  if (v == null) return "";
  return String(v).replace(/\s+/g, " ").trim();
}
function normalizeCompanyName(v) {
  let s = cleanText(v);
  s = s.replace(/^\d+\.\s*/, "");
  s = s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");
  return s;
}
function cleanRegNumber(v) {
  if (v == null) return "";
  return String(v).trim().replace(/\.0$/, "");
}
function excelDateToISO(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && window.XLSX?.SSF) {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}
function cleanAmount(v) {
  if (isPlaceholder(v)) return "";
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? "" : String(n);
}
function cleanPhone(v) {
  if (v == null) return "";
  return String(v).trim();
}

export const TEMPLATE_HEADERS = [
  "Company Name", "Registration Number", "Financial Year End", "Audit Fee", "Tax Fee", "Special Fee",
  "Contact Person", "Email", "Phone", "Industry", "Branch", "Team", "Engagement Type", "Company Address",
  "Director 1", "Director 2", "Director 3", "Director 4", "Director 5",
];

// Multiple header spellings map to the same field, so a hand-edited workbook
// (like the one used to design this template) still parses correctly.
const HEADER_MAP = {
  "company name": "company_name",
  "registration number": "registration_number",
  "company registration number": "registration_number",
  "financial year end": "fye",
  "fye": "fye",
  "annum fee": "audit_fee",
  "audit fee": "audit_fee",
  "tax fee": "tax_fee",
  "special fee": "special_fee",
  "annual fee": "audit_fee",
  "audit fee": "audit_fee",
  "contact person": "pic_name",
  "contact persom": "pic_name",
  "pic name": "pic_name",
  "email": "pic_email",
  "pic email": "pic_email",
  "phone": "pic_phone",
  "pic contact number": "pic_phone",
  "industry": "industry",
  "branch": "branch",
  "associate in charge": "branch",
  "team": "team",
  "engagement type": "engagement_type",
  "service type": "engagement_type",
  "company address": "company_address",
  "director 1": "director_1", "directors1": "director_1", "director1": "director_1",
  "director 2": "director_2", "directors2": "director_2", "director2": "director_2",
  "director 3": "director_3", "directors3": "director_3", "director3": "director_3",
  "director 4": "director_4", "directors4": "director_4", "director4": "director_4",
  "director 5": "director_5", "directors5": "director_5", "director5": "director_5",
};

function findHeaderRow(aoa, maxScan = 6) {
  let bestRow = -1, bestScore = 0;
  for (let r = 0; r < Math.min(maxScan, aoa.length); r++) {
    const row = aoa[r] || [];
    let score = 0;
    row.forEach((cell) => { if (HEADER_MAP[cleanText(cell).toLowerCase()]) score++; });
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }
  return bestScore >= 2 ? bestRow : -1;
}

/** Downloads a blank template workbook with the correct headers for re-upload. */
export async function downloadBlankTemplate() {
  await loadSheetJS();
  // Company Name is left blank on purpose — a blank name is already
  // skipped automatically on import, so this row can't accidentally
  // become a real client even if someone forgets to delete it.
  const formatHintRow = [
    "", "", "31/12/2025 (any date within the FYE month — only the month itself is tracked)", "", "", "",
    "", "", "", "", "", "", "Audit / Tax / Both (leave blank for Both)",
    "", "", "", "", "", "",
  ];
  const ws = window.XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, formatHintRow]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Completed");
  window.XLSX.writeFile(wb, "AuditFlow-Client-Template.xlsx");
}

/** Exports the current client list (plus primary contact info) to a workbook using the template headers. */
export async function exportClientsWorkbook(clients, contactsByClientId, teamNameById) {
  await loadSheetJS();
  const rows = [TEMPLATE_HEADERS];
  (clients || []).forEach((c) => {
    const contact = (contactsByClientId && contactsByClientId[c.id]) || {};
    const directors = c.directors || [];
    const fyeExport = c.fye_month
      ? `${String(new Date(2024, c.fye_month, 0).getDate()).padStart(2, "0")}/${String(c.fye_month).padStart(2, "0")}/2024`
      : "";
    rows.push([
      c.legal_name ?? "",
      c.registration_number ?? "",
      fyeExport,
      c.audit_fee ?? "",
      c.tax_fee ?? "",
      c.special_fee ?? "",
      contact.name ?? "",
      contact.email ?? "",
      contact.phone ?? "",
      c.industry ?? "",
      c.branch ?? "",
      (teamNameById && teamNameById[c.team_id]) ?? "",
      c.engagement_type === "audit" ? "Audit" : c.engagement_type === "tax" ? "Tax" : "Both",
      c.company_address ?? "",
      directors[0] ?? "", directors[1] ?? "", directors[2] ?? "", directors[3] ?? "", directors[4] ?? "",
    ]);
  });
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Completed");
  window.XLSX.writeFile(wb, "AuditFlow-Clients-Export.xlsx");
}

/** Parses an uploaded workbook's client sheet into normalized row objects. */
export function parseClientWorkbook(workbook) {
  const sheetName = workbook.SheetNames.includes("Completed") ? "Completed" : workbook.SheetNames[0];
  if (!sheetName) return { rows: [], error: "The workbook has no sheets." };

  const sheet = workbook.Sheets[sheetName];
  const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const headerRowIdx = findHeaderRow(aoa);
  if (headerRowIdx === -1) {
    return { rows: [], error: "Could not find a recognizable header row. Use the downloaded template's headers." };
  }

  const colMap = {};
  (aoa[headerRowIdx] || []).forEach((cell, idx) => {
    const key = cleanText(cell).toLowerCase();
    if (HEADER_MAP[key]) colMap[HEADER_MAP[key]] = idx;
  });

  const rows = [];
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const rawRow = aoa[r] || [];
    if (rawRow.every((c) => c == null || String(c).trim() === "")) continue;

    const get = (field) => (colMap[field] != null ? rawRow[colMap[field]] : null);
    const companyNameRaw = get("company_name");
    if (isPlaceholder(companyNameRaw)) continue;

    const directors = ["director_1", "director_2", "director_3", "director_4", "director_5"]
      .map((f) => (isPlaceholder(get(f)) ? "" : cleanText(get(f))))
      .filter(Boolean);

    rows.push({
      source_row: r + 1,
      company_name: normalizeCompanyName(companyNameRaw),
      registration_number: cleanRegNumber(get("registration_number")),
      fye: excelDateToISO(get("fye")) || "",
      audit_fee: cleanAmount(get("audit_fee")),
      tax_fee: cleanAmount(get("tax_fee")),
      special_fee: cleanAmount(get("special_fee")),
      pic_name: isPlaceholder(get("pic_name")) ? "" : cleanText(get("pic_name")),
      pic_email: isPlaceholder(get("pic_email")) ? "" : cleanText(get("pic_email")),
      pic_phone: isPlaceholder(get("pic_phone")) ? "" : cleanPhone(get("pic_phone")),
      industry: isPlaceholder(get("industry")) ? "" : cleanText(get("industry")),
      branch: isPlaceholder(get("branch")) ? "" : cleanText(get("branch")),
      team: isPlaceholder(get("team")) ? "" : cleanText(get("team")),
      engagement_type: (() => {
        const raw = cleanText(get("engagement_type")).toLowerCase();
        if (raw.startsWith("audit")) return "audit";
        if (raw.startsWith("tax")) return "tax";
        return "both";
      })(),
      company_address: isPlaceholder(get("company_address")) ? "" : cleanText(get("company_address")),
      directors,
    });
  }
  return { rows, sheetName };
}

export function validateRow(row, existingNormalizedNames) {
  const issues = [];
  let status = "valid";

  if (!row.company_name) {
    issues.push("Missing company name");
    return { ...row, status: "rejected", issues };
  }
  if (row.fye === null) {
    issues.push("Unparseable FYE date — left blank");
    status = "warning";
  }
  const normalized = row.company_name.toLowerCase();
  if (existingNormalizedNames.has(normalized)) {
    issues.push("Matches an existing client — will keep the existing client's details rather than duplicate");
    if (status === "valid") status = "warning";
  }
  return { ...row, status, issues };
}

// Supabase's REST API caps any single request at 1000 rows by default,
// silently truncating anything beyond that rather than erroring. As data
// volume grows, queries without this can quietly lose rows with no error
// shown anywhere — this loops with .range() until everything is retrieved.
export async function fetchAllRows(queryBuilder, pageSize = 1000) {
  let allRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    allRows = allRows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: allRows, error: null };
}

// Shared pagination UI used across every data table in the app - default
// 10/page, selectable up to 50, with an explicit item count shown so counts
// are never ambiguous. Returns HTML; call wirePagination() after inserting
// it into the DOM to attach the Prev/Next/page-size handlers.
export function paginationHtml(namespace, page, pageSize, totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);
  return `
    <div class="pagination-controls">
      <span class="hint">Showing ${startItem}-${endItem} of ${totalItems}</span>
      <button id="${namespace}-page-prev" class="btn-secondary" ${page <= 1 ? "disabled" : ""}>Previous</button>
      <span class="hint">Page ${page} of ${totalPages}</span>
      <button id="${namespace}-page-next" class="btn-secondary" ${page >= totalPages ? "disabled" : ""}>Next</button>
      <select id="${namespace}-page-size" class="filter-select">
        <option value="10" ${pageSize === 10 ? "selected" : ""}>10 / page</option>
        <option value="25" ${pageSize === 25 ? "selected" : ""}>25 / page</option>
        <option value="50" ${pageSize === 50 ? "selected" : ""}>50 / page</option>
      </select>
    </div>
  `;
}

export function wirePagination(namespace, { onPrev, onNext, onPageSizeChange }) {
  document.getElementById(`${namespace}-page-prev`)?.addEventListener("click", onPrev);
  document.getElementById(`${namespace}-page-next`)?.addEventListener("click", onNext);
  document.getElementById(`${namespace}-page-size`)?.addEventListener("change", (e) => onPageSizeChange(parseInt(e.target.value, 10)));
}
