// assets/js/taxEstimateMonitoring.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { fetchAllRows, paginationHtml, wirePagination } from "./excel-utils.js";
import { openClientDetailsById } from "./clients.js";
import { isFirmAdmin } from "./permissions.js";

const TET_STATUS_LABELS = {
  pending_client_reply: "Pending Client Reply",
  preparing_draft: "Preparing Draft CP204",
  pending_signature: "Pending Client Signature",
  pending_submission: "Pending Submission to MyTax",
  complete: "Complete",
  complete_no_reply: "Complete (No Reply from Client)",
};

let tetCache = [];
let tetSelectedIds = new Set();
let tetPage = 1;
let tetPageSize = 10;
let tetChartBranchFilter = "";
let tetChartTeamFilter = "";
let tetTeamsByBranch = {};
let tetMonthsRef = [];

function isoToDMYTet(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function moneyTet(v) {
  return v != null ? `$${Number(v).toLocaleString()}` : "-";
}

export async function renderTaxEstimateMonitoring(el) {
  tetPage = 1;
  tetPageSize = 10;
  tetChartBranchFilter = "";
  tetChartTeamFilter = "";
  const orgId = getIdentity()?.organisationId;

  el.innerHTML = `
    <div class="page-header">
      <h1>Tax Estimate Monitoring</h1>
      ${isFirmAdmin() ? `<div class="page-actions"><button id="tet-setup-automation-btn" class="btn-secondary">Setup Automation</button></div>` : ""}
    </div>
    <div class="import-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <h3 style="margin-top:0;">CP204 / CP204A — Next 12 Months</h3>
          <p class="hint" style="margin-top:0;">Click a bar segment to list those clients below.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <select id="tet-branch-filter" class="filter-select"><option value="">All Branches</option></select>
          <select id="tet-team-filter" class="filter-select"><option value="">All Teams</option></select>
        </div>
      </div>
      <div id="tet-chart">Loading...</div>
    </div>
    <div class="import-card">
      <h3 style="margin-top:0;" id="tet-list-title">All Clients</h3>
      <div id="tet-table-wrap">Loading...</div>
    </div>
  `;

  if (isFirmAdmin()) {
    document.getElementById("tet-setup-automation-btn").addEventListener("click", openAutomationSetupModal);
  }
  const [{ data: tracking }, { data: deadlines }, { data: clientsData }, { data: teamsData }, { data: branchesData }, { data: contacts }] = await Promise.all([
    fetchAllRows(supabase.from("tax_estimate_tracking").select("*").eq("organisation_id", orgId)),
    fetchAllRows(
      supabase
        .from("client_deadlines")
        .select("client_id, financial_year, deadline_type, deadline_date")
        .eq("organisation_id", orgId)
        .in("deadline_type", ["CP204", "CP204A 6th", "CP204A 9th", "CP204A 11th"])
        .neq("status", "not_applicable")
    ),
    supabase.from("clients").select("id, legal_name, tin, team_id, engagement_type").eq("organisation_id", orgId).in("engagement_type", ["tax", "both"]),
    supabase.from("teams").select("id, name, branch_id").eq("organisation_id", orgId).order("name"),
    supabase.from("branches").select("id, name").eq("organisation_id", orgId).order("name"),
    supabase.from("client_contacts").select("client_id, email").eq("organisation_id", orgId).eq("is_primary", true),
  ]);

  const deadlineByKey = Object.fromEntries((deadlines || []).map((d) => [`${d.client_id}|${d.financial_year}|${d.deadline_type}`, d.deadline_date]));
  const clientById = Object.fromEntries((clientsData || []).map((c) => [c.id, c]));
  const emailByClient = Object.fromEntries((contacts || []).map((c) => [c.client_id, c.email]));
  tetTeamsByBranch = Object.fromEntries((teamsData || []).map((t) => [t.id, t.branch_id]));

  const todayStr = new Date().toISOString().slice(0, 10);
  tetCache = (tracking || [])
    .map((t) => {
      const client = clientById[t.client_id];
      if (!client) return null; // audit-only clients excluded, or deadline marked not_applicable
      return {
        ...t,
        deadline_date: deadlineByKey[`${t.client_id}|${t.financial_year}|${t.deadline_type}`] || null,
        legal_name: client.legal_name,
        tin: client.tin,
        team_id: client.team_id,
        email: emailByClient[t.client_id],
      };
    })
    .filter((t) => t && t.deadline_date)
    // Already-overdue, not-yet-complete records are excluded entirely -
    // we don't send reminders for something whose deadline has passed.
    // Completed ones still show, since there's no reminder concern there.
    .filter((t) => t.deadline_date >= todayStr || t.status === "complete" || t.status === "complete_no_reply");

  document.getElementById("tet-branch-filter").innerHTML += (branchesData || []).map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
  document.getElementById("tet-team-filter").innerHTML += (teamsData || []).map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  document.getElementById("tet-branch-filter").addEventListener("change", (e) => {
    tetChartBranchFilter = e.target.value;
    renderChart();
  });
  document.getElementById("tet-team-filter").addEventListener("change", (e) => {
    tetChartTeamFilter = e.target.value;
    renderChart();
  });

  renderChart();
  tetPage = 1;
  renderList(tetCache, "All Clients");
}

function scopedTetItems() {
  return tetCache.filter((t) => {
    if (tetChartTeamFilter && t.team_id !== tetChartTeamFilter) return false;
    if (tetChartBranchFilter && (!t.team_id || tetTeamsByBranch[t.team_id] !== tetChartBranchFilter)) return false;
    return true;
  });
}

function renderChart() {
  const wrap = document.getElementById("tet-chart");
  const today = new Date();
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${d.toLocaleString("default", { month: "short" })} ${d.getFullYear()}` });
  }
  tetMonthsRef = months;

  const TYPES = ["CP204", "CP204A 6th", "CP204A 9th", "CP204A 11th"];
  const TYPE_ABBR = { "CP204": "204", "CP204A 6th": "6th", "CP204A 9th": "9th", "CP204A 11th": "11th" };
  const relevant = scopedTetItems();
  const BAR_HEIGHT = 160;

  const counts = {};
  months.forEach((m) => {
    const key = `${m.year}-${m.month}`;
    counts[key] = {};
    TYPES.forEach((t) => { counts[key][t] = { complete: 0, pending: 0 }; });
  });
  relevant.forEach((t) => {
    if (!t.deadline_date) return;
    const [y, m] = t.deadline_date.split("-").map(Number);
    const key = `${y}-${m}`;
    if (!counts[key] || !counts[key][t.deadline_type]) return;
    const isComplete = t.status === "complete" || t.status === "complete_no_reply";
    counts[key][t.deadline_type][isComplete ? "complete" : "pending"]++;
  });

  const max = Math.max(1, ...Object.values(counts).flatMap((byType) => Object.values(byType).map((c) => c.complete + c.pending)));

  wrap.innerHTML = `
    <div class="grouped-chart-wrap">
      ${months.map((m) => {
        const key = `${m.year}-${m.month}`;
        return `
        <div class="grouped-chart-month">
          <div class="grouped-chart-bars" style="height:${BAR_HEIGHT}px;">
            ${TYPES.map((t) => {
              const c = counts[key][t];
              const completeH = (c.complete / max) * BAR_HEIGHT;
              const pendingH = (c.pending / max) * BAR_HEIGHT;
              return `
              <div class="chart-column" title="${t}">
                ${c.complete ? `<div class="chart-col-segment chart-seg-clickable" data-month="${key}" data-type="${t}" data-bucket="complete" style="height:${completeH}px;background:#16a34a;" title="${t} — Complete: ${c.complete}"></div>` : ""}
                ${c.pending ? `<div class="chart-col-segment chart-seg-clickable" data-month="${key}" data-type="${t}" data-bucket="pending" style="height:${pendingH}px;background:#2563eb;" title="${t} — Pending: ${c.pending}"></div>` : ""}
              </div>`;
            }).join("")}
          </div>
          <div class="grouped-chart-type-labels">
            ${TYPES.map((t) => `<span>${TYPE_ABBR[t]}</span>`).join("")}
          </div>
          <div class="grouped-chart-month-label">${m.label}</div>
        </div>`;
      }).join("")}
    </div>
    <div style="display:flex;gap:16px;margin-top:14px;font-size:12px;color:var(--gray-600);flex-wrap:wrap;">
      <span><span class="pie-legend-swatch" style="background:#16a34a;display:inline-block;"></span> Complete</span>
      <span><span class="pie-legend-swatch" style="background:#2563eb;display:inline-block;"></span> Pending</span>
    </div>
  `;

  wrap.querySelectorAll(".chart-seg-clickable").forEach((seg) => {
    seg.addEventListener("click", () => {
      const [y, m] = seg.dataset.month.split("-").map(Number);
      const type = seg.dataset.type;
      const bucket = seg.dataset.bucket;
      const filtered = relevant.filter((t) => {
        if (!t.deadline_date || t.deadline_type !== type) return false;
        const [ty, tm] = t.deadline_date.split("-").map(Number);
        if (ty !== y || tm !== m) return false;
        const isComplete = t.status === "complete" || t.status === "complete_no_reply";
        return bucket === "complete" ? isComplete : !isComplete;
      });
      tetPage = 1;
      const monthLabel = tetMonthsRef.find((mo) => mo.year === y && mo.month === m)?.label;
      renderList(filtered, `${type} — ${bucket === "complete" ? "Complete" : "Pending"} — ${monthLabel}`);
    });
  });
}

function renderList(items, title) {
  document.getElementById("tet-list-title").textContent = title;
  tetSelectedIds.clear();
  const wrap = document.getElementById("tet-table-wrap");
  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state">No matching records.</div>`;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(items.length / tetPageSize));
  tetPage = Math.min(Math.max(1, tetPage), totalPages);
  const pageItems = items.slice((tetPage - 1) * tetPageSize, tetPage * tetPageSize);

  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
      <span class="hint" id="tet-selected-count">0 selected</span>
      <button id="tet-send-now-btn" class="btn-dark" disabled>Send Reminder Now</button>
    </div>
    <table class="data-table">
      <thead><tr>
        <th style="width:36px;"><input type="checkbox" id="tet-select-all" /></th>
        <th>Client</th><th>Type</th><th>Financial Year</th><th>Due Date</th><th>Status</th><th>Reminders Sent</th><th style="white-space:nowrap;">Automate</th><th>Ready for Automation</th>
      </tr></thead>
      <tbody>
        ${pageItems
          .map((t) => {
            const ready = t.tin && t.email;
            const isDone = t.status === "complete" || t.status === "complete_no_reply";
            const remindersSent = [t.reminder_1_sent_at && "1st", t.reminder_2_sent_at && "2nd", t.reminder_final_sent_at && "Final"].filter(Boolean).join(", ") || "-";
            return `<tr data-tet-row="${t.id}">
            <td><input type="checkbox" class="tet-row-checkbox" data-tet-checkbox="${t.id}" ${!ready || isDone ? "disabled" : ""} title="${!ready ? "Not ready - missing TIN or contact email" : isDone ? "Already complete" : ""}" /></td>
            <td class="clickable-row" data-tet-id="${t.id}">${t.legal_name || "-"}</td>
            <td class="clickable-row" data-tet-id="${t.id}">${t.deadline_type}</td>
            <td class="clickable-row" data-tet-id="${t.id}">FY${t.financial_year}</td>
            <td class="clickable-row" data-tet-id="${t.id}">${isoToDMYTet(t.deadline_date)}</td>
            <td class="clickable-row" data-tet-id="${t.id}"><span class="status-badge ${isDone ? "status-completed" : "status-wip"}">${TET_STATUS_LABELS[t.status]}</span></td>
            <td class="clickable-row" data-tet-id="${t.id}" style="font-size:12px;">${remindersSent}</td>
            <td class="clickable-row" data-tet-id="${t.id}" style="white-space:nowrap;">${t.automate_reminders ? `<span class="status-badge status-completed" style="white-space:nowrap;">Automated</span>` : `<span class="status-badge status-wip" style="white-space:nowrap;">Manual</span>`}</td>
            <td class="clickable-row" data-tet-id="${t.id}"><span class="status-badge ${ready ? "status-completed" : "status-rejected"}">${ready ? "Ready" : "Not Ready"}</span></td>
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    ${paginationHtml("tet", tetPage, tetPageSize, items.length)}
  `;

  function updateSendButton() {
    const count = tetSelectedIds.size;
    document.getElementById("tet-selected-count").textContent = `${count} selected`;
    document.getElementById("tet-send-now-btn").disabled = count === 0;
  }

  wrap.querySelectorAll(".tet-row-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      if (cb.checked) tetSelectedIds.add(cb.dataset.tetCheckbox);
      else tetSelectedIds.delete(cb.dataset.tetCheckbox);
      updateSendButton();
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
  });

  document.getElementById("tet-select-all").addEventListener("change", (e) => {
    wrap.querySelectorAll(".tet-row-checkbox:not(:disabled)").forEach((cb) => {
      cb.checked = e.target.checked;
      if (e.target.checked) tetSelectedIds.add(cb.dataset.tetCheckbox);
      else tetSelectedIds.delete(cb.dataset.tetCheckbox);
    });
    updateSendButton();
  });

  document.getElementById("tet-send-now-btn").addEventListener("click", async () => {
    const btn = document.getElementById("tet-send-now-btn");
    const ids = [...tetSelectedIds];
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const { data, error } = await supabase.functions.invoke("send-tax-reminder", { body: { tracking_ids: ids } });
      if (error) {
        alert("Could not send reminders: " + error.message);
        return;
      }
      const succeeded = (data?.results || []).filter((r) => r.success).length;
      const failed = (data?.results || []).filter((r) => !r.success);
      let message = `${succeeded} of ${ids.length} reminder(s) sent successfully.`;
      if (failed.length) {
        message += `\n\nFailed:\n` + failed.map((f) => `- ${f.error}`).join("\n");
      }
      alert(message);
      const originalIds = items.map((i) => i.id);
      await loadData();
      const refreshed = tetCache.filter((t) => originalIds.includes(t.id));
      renderList(refreshed, title);
    } finally {
      btn.textContent = "Send Reminder Now";
      updateSendButton();
    }
  });

  wrap.querySelectorAll("[data-tet-id]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const record = items.find((t) => t.id === cell.dataset.tetId);
      if (record) openTetDetailsModal(record, items, title);
    });
  });
  wirePagination("tet", {
    onPrev: () => {
      tetPage--;
      renderList(items, title);
    },
    onNext: () => {
      tetPage++;
      renderList(items, title);
    },
    onPageSizeChange: (size) => {
      tetPageSize = size;
      tetPage = 1;
      renderList(items, title);
    },
  });
}

async function openTetDetailsModal(record, items, title) {
  const isCP204A = record.deadline_type !== "CP204";
  const missing = [];
  if (!record.tin) missing.push("TIN");
  if (!record.email) missing.push("Contact Email");
  const ready = missing.length === 0;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:600px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${record.legal_name}</h2>
          <p class="modal-subtitle">${record.deadline_type} — FY${record.financial_year} — Due ${isoToDMYTet(record.deadline_date)}</p>
          <button type="button" id="tet-view-client" class="btn-link" style="padding:0;margin-top:4px;">View Full Client Details</button>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>

      <div class="modal-grid">
        <div><label class="option-label">TIN</label><div>${record.tin || "-"}</div></div>
        <div><label class="option-label">Contact Email</label><div>${record.email || "-"}</div></div>
      </div>
      <p style="margin-top:6px;">
        <span class="status-badge ${ready ? "status-completed" : "status-rejected"}">${ready ? "Ready for Automation" : "Not Ready"}</span>
        ${!ready ? `<span class="hint" style="margin-left:8px;">Missing: ${missing.join(", ")} — update on the client's record in Client List.</span>` : ""}
      </p>

      <h3 style="margin-top:20px;">Status</h3>
      <select id="tet-status" style="width:100%;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
        <option value="pending_client_reply" ${record.status === "pending_client_reply" ? "selected" : ""}>Pending Client Reply</option>
        <option value="preparing_draft" ${record.status === "preparing_draft" ? "selected" : ""}>Preparing Draft CP204</option>
        <option value="pending_signature" ${record.status === "pending_signature" ? "selected" : ""}>Pending Client Signature</option>
        <option value="pending_submission" ${record.status === "pending_submission" ? "selected" : ""}>Pending Submission to MyTax</option>
        <option value="complete" ${record.status === "complete" ? "selected" : ""}>Complete</option>
        ${isCP204A ? `<option value="complete_no_reply" ${record.status === "complete_no_reply" ? "selected" : ""}>Complete (No Reply from Client)</option>` : ""}
      </select>

      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;">
        <input type="checkbox" id="tet-automate" ${record.automate_reminders ? "checked" : ""} />
        <span>Automatically send reminder emails for this client</span>
      </label>
      <p class="hint" style="margin-top:2px;">When unchecked, reminders won't send automatically — use "Mark Sent Now" below if you send one manually.</p>

      <h3 style="margin-top:20px;">Reminders Sent</h3>
      <div class="modal-grid">
        <div>
          <label class="option-label">1st Reminder</label>
          <div>${record.reminder_1_sent_at ? new Date(record.reminder_1_sent_at).toLocaleDateString() : "Not sent"}</div>
          ${!record.reminder_1_sent_at ? `<button type="button" class="btn-link" id="tet-mark-r1">Mark Sent Now</button>` : ""}
        </div>
        <div>
          <label class="option-label">2nd Reminder</label>
          <div>${record.reminder_2_sent_at ? new Date(record.reminder_2_sent_at).toLocaleDateString() : "Not sent"}</div>
          ${!record.reminder_2_sent_at ? `<button type="button" class="btn-link" id="tet-mark-r2">Mark Sent Now</button>` : ""}
        </div>
        <div>
          <label class="option-label">Final Reminder</label>
          <div>${record.reminder_final_sent_at ? new Date(record.reminder_final_sent_at).toLocaleDateString() : "Not sent"}</div>
          ${!record.reminder_final_sent_at ? `<button type="button" class="btn-link" id="tet-mark-rf">Mark Sent Now</button>` : ""}
        </div>
      </div>

      <h3 style="margin-top:20px;">Tax Estimate Figures</h3>
      <div class="modal-grid">
        <label>${record.deadline_type === "CP204" ? "Tax Estimate" : "Revision"} ($)
          <input type="number" step="0.01" id="tet-this-year" value="${record.this_year_estimate ?? ""}" />
        </label>
        <label>Prior Year Estimate ($)
          <input type="number" step="0.01" id="tet-prior-estimate" value="${record.prior_year_estimate ?? ""}" />
        </label>
        <label>Prior Year Final Tax ($)
          <input type="number" step="0.01" id="tet-prior-final" value="${record.prior_year_final_tax ?? ""}" />
        </label>
      </div>
      <p class="hint" style="margin-top:6px;">Final Tax (from Form C) is entered via the Compliance Tracker's Mark as Completed action — it shows there and flows into this record automatically.</p>
      <p class="hint" id="tet-85-check" style="margin-top:8px;"></p>

      <p id="tet-modal-error" class="form-error hidden" style="margin-top:10px;"></p>

      <div class="modal-actions" style="margin-top:18px;">
        <button type="button" id="tet-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="tet-save" class="btn-dark">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#tet-cancel").addEventListener("click", close);
  backdrop.querySelector("#tet-view-client").addEventListener("click", () => openClientDetailsById(record.client_id));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  function refresh85Check() {
    const thisYear = parseFloat(document.getElementById("tet-this-year").value) || 0;
    const priorEstimate = parseFloat(document.getElementById("tet-prior-estimate").value) || 0;
    const priorFinal = parseFloat(document.getElementById("tet-prior-final").value) || 0;
    const el85 = document.getElementById("tet-85-check");
    if (!thisYear && !priorEstimate && !priorFinal) {
      el85.textContent = "Enter all three figures to check the 85% requirement.";
      return;
    }
    const higher = Math.max(priorEstimate, priorFinal);
    const required = higher * 0.85;
    const pass = thisYear >= required;
    el85.innerHTML = pass
      ? `✅ This year's estimate meets the 85% requirement (needs at least ${moneyTet(required)}).`
      : `⚠️ This year's estimate is below 85% of the higher prior figure — needs at least ${moneyTet(required)}.`;
  }
  ["tet-this-year", "tet-prior-estimate", "tet-prior-final"].forEach((id) => {
    document.getElementById(id).addEventListener("input", refresh85Check);
  });
  refresh85Check();

  const markReminder = async (field, btnId) => {
    const { error } = await supabase.from("tax_estimate_tracking").update({ [field]: new Date().toISOString() }).eq("id", record.id);
    if (error) {
      alert("Could not update: " + error.message);
      return;
    }
    record[field] = new Date().toISOString();
    close();
    await openTetDetailsModal(record, items, title);
  };
  backdrop.querySelector("#tet-mark-r1")?.addEventListener("click", () => markReminder("reminder_1_sent_at", "tet-mark-r1"));
  backdrop.querySelector("#tet-mark-r2")?.addEventListener("click", () => markReminder("reminder_2_sent_at", "tet-mark-r2"));
  backdrop.querySelector("#tet-mark-rf")?.addEventListener("click", () => markReminder("reminder_final_sent_at", "tet-mark-rf"));

  backdrop.querySelector("#tet-save").addEventListener("click", async () => {
    const errorEl = document.getElementById("tet-modal-error");
    const payload = {
      status: document.getElementById("tet-status").value,
      automate_reminders: document.getElementById("tet-automate").checked,
      this_year_estimate: document.getElementById("tet-this-year").value || null,
      prior_year_estimate: document.getElementById("tet-prior-estimate").value || null,
      prior_year_final_tax: document.getElementById("tet-prior-final").value || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("tax_estimate_tracking").update(payload).eq("id", record.id);
    if (error) {
      errorEl.textContent = "Could not save: " + error.message;
      errorEl.classList.remove("hidden");
      return;
    }
    Object.assign(record, payload);
    close();
    renderChart();
    renderList(items, title);
  });
}

function templateStageEditor(prefix, stageKey, stageLabel) {
  return `
    <label style="display:block;margin-top:14px;">${stageLabel} — Subject
      <input type="text" id="tmpl-${prefix}-${stageKey}-subject" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
    </label>
    <label style="display:block;margin-top:10px;">${stageLabel} — Body
      <textarea id="tmpl-${prefix}-${stageKey}-body" rows="6" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;"></textarea>
    </label>
  `;
}

async function openAutomationSetupModal() {
  const orgId = getIdentity()?.organisationId;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:640px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Setup Automation</h2>
          <p class="modal-subtitle">Automatic CP204/CP204A reminder emails, sent via Resend.</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>

      <p class="hint">Powers automatic CP204/CP204A reminder emails, sent via <a href="https://resend.com" target="_blank" rel="noopener">Resend</a>. Create a free account there, verify your domain, then paste the API key below.</p>
      <p style="margin-top:10px;">Status: <strong id="resend-status-label">Checking...</strong></p>

      <label style="display:block;margin-top:10px;">Resend API Key
        <input type="password" id="resend-api-key" placeholder="Paste your Resend API key to set or replace it" autocomplete="off" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
        <span class="hint">Never shown again once saved — leave blank to keep the existing key unchanged.</span>
      </label>
      <label style="display:block;margin-top:14px;">Sender Name
        <input type="text" id="resend-sender-name" placeholder="e.g. NBL & Associates PLT" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-top:14px;">Sender Email
        <input type="text" id="resend-sender-email" placeholder="noreply@nbla.com.my" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-top:14px;">Reply-To / CC Email
        <input type="text" id="resend-reply-to" placeholder="e.g. tax@nbla.com.my" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
        <span class="hint">Since reminders are sent from a no-reply address, this real staff/general inbox is shown in the email text and automatically CC'd on every send, so replies land somewhere real.</span>
      </label>
      <button id="resend-save-btn" class="btn-dark" style="margin-top:12px;">Save Automation Settings</button>
      <p id="resend-error" class="form-error hidden"></p>

      <h4 style="margin-top:24px;margin-bottom:8px;">Reminder Timing</h4>
      <p class="hint">How many days before the due date each reminder is sent automatically. These are just sensible starting points — change them to whatever fits your workflow.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;">
        <label style="flex:1;min-width:140px;">1st Reminder
          <input type="number" id="tet-days-r1" min="1" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          <span class="hint">days before due date</span>
        </label>
        <label style="flex:1;min-width:140px;">2nd Reminder
          <input type="number" id="tet-days-r2" min="1" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          <span class="hint">days before due date</span>
        </label>
        <label style="flex:1;min-width:140px;">Final Reminder
          <input type="number" id="tet-days-rf" min="1" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          <span class="hint">days before due date</span>
        </label>
      </div>
      <p class="hint" style="margin-top:8px;">Reply-by date shown in 1st/2nd reminders is always 10 days before the due date, calculated automatically.</p>
      <button id="tet-days-save-btn" class="btn-dark" style="margin-top:12px;">Save Reminder Timing</button>
      <p id="tet-days-error" class="form-error hidden"></p>

      <h4 style="margin-top:24px;margin-bottom:8px;">CP204 Reminder Templates</h4>
      <p class="hint">Placeholders: <code>{client_name}</code>, <code>{ya}</code>, <code>{financial_year_end}</code>, <code>{due_date}</code>, <code>{reply_by_date}</code>, <code>{reply_to_email}</code>, <code>{firm_name}</code></p>
      ${templateStageEditor("cp204", "1", "1st Reminder")}
      ${templateStageEditor("cp204", "2", "2nd Reminder")}
      ${templateStageEditor("cp204", "final", "Final Reminder")}
      <button id="cp204-templates-save-btn" class="btn-dark" style="margin-top:12px;">Save CP204 Templates</button>
      <p id="cp204-templates-error" class="form-error hidden"></p>

      <h4 style="margin-top:24px;margin-bottom:8px;">CP204A Reminder Templates</h4>
      <p class="hint">Same placeholders as above, plus <code>{revision_month}</code> (6th / 9th / 11th) — one template set covers all three revision months.</p>
      ${templateStageEditor("cp204a", "1", "1st Reminder")}
      ${templateStageEditor("cp204a", "2", "2nd Reminder")}
      ${templateStageEditor("cp204a", "final", "Final Reminder")}
      <button id="cp204a-templates-save-btn" class="btn-dark" style="margin-top:12px;">Save CP204A Templates</button>
      <p id="cp204a-templates-error" class="form-error hidden"></p>

      <h4 style="margin-top:24px;margin-bottom:8px;">Send Test Email</h4>
      <p class="hint">Sends one of the templates above, filled in with sample placeholder values, to any address you choose — useful for checking your Resend setup and template wording before it goes out to real clients. Subject line is prefixed with [TEST].</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <input type="email" id="tet-test-email-address" placeholder="you@example.com" style="flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
        <select id="tet-test-template" class="filter-select">
          <option value="cp204_reminder_1">CP204 — 1st Reminder</option>
          <option value="cp204_reminder_2">CP204 — 2nd Reminder</option>
          <option value="cp204_reminder_final">CP204 — Final Reminder</option>
          <option value="cp204a_reminder_1">CP204A — 1st Reminder</option>
          <option value="cp204a_reminder_2">CP204A — 2nd Reminder</option>
          <option value="cp204a_reminder_final">CP204A — Final Reminder</option>
        </select>
        <button id="tet-send-test-btn" class="btn-secondary">Send Test</button>
      </div>
      <p id="tet-test-email-status" class="hint" style="margin-top:8px;"></p>

      <div class="modal-actions" style="margin-top:18px;">
        <button type="button" id="tet-automation-close" class="btn-secondary">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#tet-automation-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const [{ data: orgSettings }, resendConfigured] = await Promise.all([
    supabase.from("organisation_settings").select(
      "sender_name, sender_email, reminder_reply_to_email, reminder_1_days_before, reminder_2_days_before, reminder_final_days_before, " +
      "cp204_reminder_1_subject, cp204_reminder_1_body, cp204_reminder_2_subject, cp204_reminder_2_body, cp204_reminder_final_subject, cp204_reminder_final_body, " +
      "cp204a_reminder_1_subject, cp204a_reminder_1_body, cp204a_reminder_2_subject, cp204a_reminder_2_body, cp204a_reminder_final_subject, cp204a_reminder_final_body"
    ).eq("organisation_id", orgId).maybeSingle(),
    supabase.rpc("is_resend_configured", { org_id: orgId }),
  ]);

  backdrop.querySelector("#resend-status-label").textContent = resendConfigured?.data ? "API key configured ✓" : "Not yet configured";
  backdrop.querySelector("#resend-sender-name").value = orgSettings?.sender_name || "";
  backdrop.querySelector("#resend-sender-email").value = orgSettings?.sender_email || "";
  backdrop.querySelector("#resend-reply-to").value = orgSettings?.reminder_reply_to_email || "";
  backdrop.querySelector("#tet-days-r1").value = orgSettings?.reminder_1_days_before ?? 30;
  backdrop.querySelector("#tet-days-r2").value = orgSettings?.reminder_2_days_before ?? 15;
  backdrop.querySelector("#tet-days-rf").value = orgSettings?.reminder_final_days_before ?? 1;

  ["cp204", "cp204a"].forEach((prefix) => {
    ["1", "2", "final"].forEach((stage) => {
      backdrop.querySelector(`#tmpl-${prefix}-${stage}-subject`).value = orgSettings?.[`${prefix}_reminder_${stage}_subject`] || "";
      backdrop.querySelector(`#tmpl-${prefix}-${stage}-body`).value = orgSettings?.[`${prefix}_reminder_${stage}_body`] || "";
    });
  });

  backdrop.querySelector("#resend-save-btn").addEventListener("click", async () => {
    const errorEl = backdrop.querySelector("#resend-error");
    const newKey = backdrop.querySelector("#resend-api-key").value.trim();
    if (newKey) {
      const { error: keyError } = await supabase.rpc("set_resend_api_key", { org_id: orgId, new_key: newKey });
      if (keyError) { errorEl.textContent = "Could not save API key: " + keyError.message; errorEl.classList.remove("hidden"); return; }
      backdrop.querySelector("#resend-api-key").value = "";
      backdrop.querySelector("#resend-status-label").textContent = "API key configured ✓";
    }
    const { error } = await supabase.from("organisation_settings").update({
      sender_name: backdrop.querySelector("#resend-sender-name").value.trim() || null,
      sender_email: backdrop.querySelector("#resend-sender-email").value.trim() || null,
      reminder_reply_to_email: backdrop.querySelector("#resend-reply-to").value.trim() || null,
    }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
  });

  backdrop.querySelector("#tet-days-save-btn").addEventListener("click", async () => {
    const errorEl = backdrop.querySelector("#tet-days-error");
    const d1 = parseInt(backdrop.querySelector("#tet-days-r1").value, 10);
    const d2 = parseInt(backdrop.querySelector("#tet-days-r2").value, 10);
    const df = parseInt(backdrop.querySelector("#tet-days-rf").value, 10);
    if (!d1 || !d2 || !df || d1 < 1 || d2 < 1 || df < 1) {
      errorEl.textContent = "Please enter a whole number of days (1 or more) for each reminder.";
      errorEl.classList.remove("hidden");
      return;
    }
    const { error } = await supabase.from("organisation_settings").update({
      reminder_1_days_before: d1,
      reminder_2_days_before: d2,
      reminder_final_days_before: df,
    }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
  });

  ["cp204", "cp204a"].forEach((prefix) => {
    backdrop.querySelector(`#${prefix}-templates-save-btn`).addEventListener("click", async () => {
      const errorEl = backdrop.querySelector(`#${prefix}-templates-error`);
      const payload = {};
      ["1", "2", "final"].forEach((stage) => {
        payload[`${prefix}_reminder_${stage}_subject`] = backdrop.querySelector(`#tmpl-${prefix}-${stage}-subject`).value.trim() || null;
        payload[`${prefix}_reminder_${stage}_body`] = backdrop.querySelector(`#tmpl-${prefix}-${stage}-body`).value.trim() || null;
      });
      const { error } = await supabase.from("organisation_settings").update(payload).eq("organisation_id", orgId);
      if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
      errorEl.classList.add("hidden");
    });
  });

  backdrop.querySelector("#tet-send-test-btn").addEventListener("click", async () => {
    const statusEl = backdrop.querySelector("#tet-test-email-status");
    const btn = backdrop.querySelector("#tet-send-test-btn");
    const toEmail = backdrop.querySelector("#tet-test-email-address").value.trim();
    const templateKey = backdrop.querySelector("#tet-test-template").value;
    if (!toEmail) { statusEl.textContent = "Please enter an email address to send the test to."; return; }

    btn.disabled = true;
    btn.textContent = "Sending...";
    statusEl.textContent = "";
    try {
      const { data, error } = await supabase.functions.invoke("send-test-email", {
        body: { organisation_id: orgId, to_email: toEmail, template_key: templateKey },
      });
      if (error || data?.error) {
        statusEl.textContent = "Could not send: " + (data?.error || error.message);
        return;
      }
      statusEl.textContent = `Test email sent to ${toEmail}.`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Send Test";
    }
  });
}
