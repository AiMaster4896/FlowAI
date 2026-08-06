// assets/js/isqm.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isManagerOrAdmin, isFirmAdmin } from "./permissions.js";
import { loadFlatpickr, paginationHtml, wirePagination } from "./excel-utils.js";

const DECLARATION_STATUS_LABELS = { not_started: "Not Started", pending: "Pending Signature", completed: "Completed" };

const THREAT_ITEMS = [
  ["financial_interest", "Financial interest in the client"],
  ["loans", "Loans or guarantees obtained from the client"],
  ["gifts", "Gifts and hospitality received from the client"],
  ["family", "Family or personal relationships with the client"],
  ["employment", "Employment with the client"],
  ["business_relationship", "Close business relationship with the client"],
  ["others", "Others (as stated in the MIA By-Laws on Professional Ethics, Conduct and Practice)"],
];

function loadPdfLib() {
  return new Promise((resolve, reject) => {
    if (window.PDFLib) { resolve(); return; }
    import("https://esm.sh/pdf-lib@1.17.1")
      .then((mod) => { window.PDFLib = mod; resolve(); })
      .catch(() => reject(new Error("Could not load the PDF library. Check your connection and try again.")));
  });
}

let isqmCurrentYear = new Date().getFullYear();
let isqmMembersCache = [];
let icrPage = 1;
let icrPageSize = 10;
let isqmDeclarationsCache = {};

export async function renderISQM(el) {
  icrPage = 1;
  icrPageSize = 10;
  const identity = getIdentity();
  const orgId = identity?.organisationId;
  const admin = isManagerOrAdmin();
  const years = [isqmCurrentYear, isqmCurrentYear - 1, isqmCurrentYear - 2];

  el.innerHTML = `
    <div class="page-header">
      <h1>ISQM — Independence Declarations</h1>
      <div class="page-actions">
        <select id="isqm-year" class="filter-select">
          ${years.map((y) => `<option value="${y}" ${y === isqmCurrentYear ? "selected" : ""}>${y} (1 Jan – 31 Dec)</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="import-card">
      <p class="hint">Each staff member needs one independence declaration per calendar year. "Complete Declaration" fills it in electronically right here; "Upload Signed Copy" is for a physically signed version instead.</p>
      <div id="isqm-table-wrap">Loading...</div>
    </div>
    <div class="import-card">
      <h3 style="margin-top:0;">${isFirmAdmin() ? "Independence Concern Reports" : "My Independence Concern Reports"}</h3>
      <p class="hint">${isFirmAdmin() ? "Submitted by staff from the \"Report Independence Concern\" button on new-client announcements." : "Reports you've filed from the \"Report Independence Concern\" button on new-client announcements."}</p>
      <div id="icr-table-wrap">Loading...</div>
    </div>
  `;

  document.getElementById("isqm-year").addEventListener("change", async (e) => {
    isqmCurrentYear = parseInt(e.target.value, 10);
    await loadAndRender();
  });

  if (isFirmAdmin()) {
    const { data: members } = await supabase.from("organisation_members").select("user_id, profiles(display_name, email, designation)").eq("organisation_id", orgId).eq("status", "active").eq("is_working_staff", true);
    isqmMembersCache = members || [];
  } else if (admin) {
    // Manager: scope to teams they actually have access to (direct team
    // grants, or branch grants resolved to that branch's teams) - same
    // access model used everywhere else in the app, not firm-wide.
    const [{ data: teamGrants }, { data: branchGrants }] = await Promise.all([
      supabase.from("user_team_access").select("team_id").eq("user_id", identity.user.id),
      supabase.from("user_branch_access").select("branch_id").eq("user_id", identity.user.id),
    ]);
    const directTeamIds = (teamGrants || []).map((r) => r.team_id);
    const branchIds = (branchGrants || []).map((r) => r.branch_id);
    let branchTeamIds = [];
    if (branchIds.length) {
      const { data: teamsInBranches } = await supabase.from("teams").select("id").in("branch_id", branchIds);
      branchTeamIds = (teamsInBranches || []).map((t) => t.id);
    }
    const accessibleTeamIds = [...new Set([...directTeamIds, ...branchTeamIds])];

    const { data: members } = accessibleTeamIds.length
      ? await supabase.from("organisation_members").select("user_id, profiles(display_name, email, designation)").eq("organisation_id", orgId).eq("status", "active").eq("is_working_staff", true).in("team_id", accessibleTeamIds)
      : { data: [] };
    isqmMembersCache = members || [];
  } else {
    isqmMembersCache = [{ user_id: identity.user.id, profiles: identity.profile }];
  }

  await loadAndRender();
  await loadAndRenderConcernReports();
}

async function loadAndRenderConcernReports() {
  const orgId = getIdentity()?.organisationId;
  const wrap = document.getElementById("icr-table-wrap");
  if (!wrap) return;

  const { data, error } = await supabase
    .from("independence_concern_reports")
    .select("id, description, status, created_at, resolved_at, client_id, reported_by")
    .eq("organisation_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    wrap.innerHTML = `<div class="empty-state">Could not load reports: ${error.message}</div>`;
    return;
  }
  if (!data?.length) {
    wrap.innerHTML = `<div class="empty-state">No independence concerns reported.</div>`;
    return;
  }

  const clientIds = [...new Set(data.map((r) => r.client_id).filter(Boolean))];
  const reporterIds = [...new Set(data.map((r) => r.reported_by).filter(Boolean))];
  const [{ data: clientsData }, { data: reportersData }] = await Promise.all([
    clientIds.length ? supabase.from("clients").select("id, legal_name").in("id", clientIds) : Promise.resolve({ data: [] }),
    reporterIds.length ? supabase.from("profiles").select("id, display_name, email").in("id", reporterIds) : Promise.resolve({ data: [] }),
  ]);
  const clientNameById = Object.fromEntries((clientsData || []).map((c) => [c.id, c.legal_name]));
  const reporterNameById = Object.fromEntries((reportersData || []).map((p) => [p.id, p.display_name || p.email]));

  const totalPages = Math.max(1, Math.ceil(data.length / icrPageSize));
  icrPage = Math.min(Math.max(1, icrPage), totalPages);
  const pageItems = data.slice((icrPage - 1) * icrPageSize, icrPage * icrPageSize);

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Client</th><th>Reported By</th><th>Description</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>
        ${pageItems.map((r) => `
          <tr class="clickable-row" data-open-icr="${r.id}">
            <td>${clientNameById[r.client_id] || "-"}</td>
            <td>${reporterNameById[r.reported_by] || "-"}</td>
            <td>${r.description}</td>
            <td>${new Date(r.created_at).toLocaleDateString()}</td>
            <td><span class="status-badge ${r.status === "resolved" ? "status-completed" : "status-wip"}">${r.status === "resolved" ? (r.resolution_outcome === "resign_client" ? "Resigned Client" : "Resolved") : "Open"}</span></td>
          </tr>`).join("")}
      </tbody>
    </table>
    ${paginationHtml("icr", icrPage, icrPageSize, data.length)}
  `;

  wrap.querySelectorAll("[data-open-icr]").forEach((tr) => {
    tr.addEventListener("click", () => openConcernDetailsModal(tr.dataset.openIcr, clientNameById, reporterNameById));
  });
  wirePagination("icr", {
    onPrev: () => { icrPage--; loadAndRenderConcernReports(); },
    onNext: () => { icrPage++; loadAndRenderConcernReports(); },
    onPageSizeChange: (size) => { icrPageSize = size; icrPage = 1; loadAndRenderConcernReports(); },
  });
}

async function openConcernDetailsModal(reportId, clientNameById, reporterNameById) {
  const identity = getIdentity();
  const admin = isFirmAdmin();

  const [{ data: report }, { data: comments }] = await Promise.all([
    supabase.from("independence_concern_reports").select("*").eq("id", reportId).maybeSingle(),
    supabase.from("independence_concern_comments").select("id, author_id, message, created_at").eq("report_id", reportId).order("created_at", { ascending: true }),
  ]);
  if (!report) return;

  const isReporter = identity?.user?.id === report.reported_by;
  const canAct = admin || (isReporter && report.status === "open");
  const canComment = admin || isReporter;

  const authorIds = [...new Set((comments || []).map((c) => c.author_id))];
  const { data: authors } = authorIds.length ? await supabase.from("profiles").select("id, display_name, email").in("id", authorIds) : { data: [] };
  const authorNameById = Object.fromEntries((authors || []).map((p) => [p.id, p.display_name || p.email]));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:560px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${clientNameById[report.client_id] || "Independence Concern"}</h2>
          <p class="modal-subtitle">Reported by ${reporterNameById[report.reported_by] || "-"} — ${new Date(report.created_at).toLocaleDateString()}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>

      <p class="hint" style="margin-top:0;">Status: <strong>${report.status === "resolved" ? (report.resolution_outcome === "resign_client" ? "Resigned Client" : "Resolved") : "Open"}</strong></p>
      <p style="white-space:pre-wrap;">${report.description}</p>

      <h3 style="margin-top:20px;">Discussion</h3>
      <div id="icr-comments" style="display:flex;flex-direction:column;gap:10px;max-height:220px;overflow-y:auto;margin-top:8px;">
        ${(comments || []).length ? comments.map((c) => `
          <div style="background:var(--gray-50);border-radius:8px;padding:8px 12px;">
            <div style="font-size:12px;font-weight:600;">${authorNameById[c.author_id] || "-"} <span class="hint" style="font-weight:400;">${new Date(c.created_at).toLocaleString()}</span></div>
            <div style="white-space:pre-wrap;font-size:14px;margin-top:2px;">${c.message}</div>
          </div>`).join("") : `<p class="hint">No comments yet.</p>`}
      </div>
      ${canComment ? `
        <div style="display:flex;gap:8px;margin-top:10px;">
          <textarea id="icr-new-comment" rows="2" placeholder="Write a reply..." style="flex:1;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;"></textarea>
          <button id="icr-send-comment" class="btn-dark" style="width:auto;align-self:flex-end;">Send</button>
        </div>
      ` : ""}

      ${admin ? `
        <h3 style="margin-top:20px;">Mitigating Action</h3>
        <textarea id="icr-mitigating" rows="3" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;">${report.mitigating_action || ""}</textarea>
        <button id="icr-save-mitigating" class="btn-secondary" style="margin-top:8px;width:auto;">Save Mitigating Action</button>
      ` : report.mitigating_action ? `
        <h3 style="margin-top:20px;">Mitigating Action</h3>
        <p style="white-space:pre-wrap;">${report.mitigating_action}</p>
      ` : ""}

      <p id="icr-modal-error" class="form-error hidden" style="margin-top:10px;"></p>

      <div class="modal-actions" style="margin-top:18px;flex-wrap:wrap;gap:8px;">
        ${admin && report.status === "open" ? `
          <button id="icr-mark-resolved" class="btn-secondary">Mark Resolved</button>
          <button id="icr-mark-resign" class="btn-secondary">Cannot Resolve — Resign Client</button>
        ` : ""}
        ${canAct ? `<button id="icr-edit" class="btn-secondary">Edit Description</button>` : ""}
        ${canAct ? `<button id="icr-delete" class="btn-secondary" style="color:#dc2626;">Delete</button>` : ""}
        <button id="icr-close" class="btn-dark">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#icr-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const errorEl = backdrop.querySelector("#icr-modal-error");
  const refresh = async () => { close(); await loadAndRenderConcernReports(); };

  backdrop.querySelector("#icr-send-comment")?.addEventListener("click", async () => {
    const textarea = backdrop.querySelector("#icr-new-comment");
    const message = textarea.value.trim();
    if (!message) return;
    const { error } = await supabase.from("independence_concern_comments").insert({ report_id: reportId, author_id: identity.user.id, message });
    if (error) { errorEl.textContent = "Could not post reply: " + error.message; errorEl.classList.remove("hidden"); return; }
    close();
    await openConcernDetailsModal(reportId, clientNameById, reporterNameById);
  });

  backdrop.querySelector("#icr-save-mitigating")?.addEventListener("click", async () => {
    const value = backdrop.querySelector("#icr-mitigating").value.trim();
    const { error } = await supabase.from("independence_concern_reports").update({ mitigating_action: value || null }).eq("id", reportId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
  });

  backdrop.querySelector("#icr-mark-resolved")?.addEventListener("click", async () => {
    const { error } = await supabase.from("independence_concern_reports").update({
      status: "resolved", resolution_outcome: "resolved", resolved_at: new Date().toISOString(), resolved_by: identity.user.id,
    }).eq("id", reportId);
    if (error) { errorEl.textContent = "Could not update: " + error.message; errorEl.classList.remove("hidden"); return; }
    await refresh();
  });

  backdrop.querySelector("#icr-mark-resign")?.addEventListener("click", async () => {
    if (!confirm("Mark this as unresolved, with the client to be resigned? This only records the decision here — resigning the client itself is still a separate step in Client List.")) return;
    const { error } = await supabase.from("independence_concern_reports").update({
      status: "resolved", resolution_outcome: "resign_client", resolved_at: new Date().toISOString(), resolved_by: identity.user.id,
    }).eq("id", reportId);
    if (error) { errorEl.textContent = "Could not update: " + error.message; errorEl.classList.remove("hidden"); return; }
    await refresh();
  });

  backdrop.querySelector("#icr-edit")?.addEventListener("click", async () => {
    const newDescription = prompt("Edit description:", report.description);
    if (newDescription === null || !newDescription.trim() || newDescription.trim() === report.description) return;
    const { error } = await supabase.from("independence_concern_reports").update({ description: newDescription.trim() }).eq("id", reportId);
    if (error) { errorEl.textContent = "Could not update: " + error.message; errorEl.classList.remove("hidden"); return; }
    await refresh();
  });

  backdrop.querySelector("#icr-delete")?.addEventListener("click", async () => {
    if (!confirm("Delete this independence concern report? This cannot be undone.")) return;
    const { error } = await supabase.from("independence_concern_reports").delete().eq("id", reportId);
    if (error) { errorEl.textContent = "Could not delete: " + error.message; errorEl.classList.remove("hidden"); return; }
    await refresh();
  });
}

async function loadAndRender() {
  const orgId = getIdentity()?.organisationId;
  const admin = isManagerOrAdmin();
  const wrap = document.getElementById("isqm-table-wrap");

  const memberIds = isqmMembersCache.map((m) => m.user_id);
  let query = supabase.from("independence_declarations").select("user_id, status, method, signed_document_url, completed_at").eq("organisation_id", orgId).eq("declaration_year", isqmCurrentYear);
  query = memberIds.length ? query.in("user_id", memberIds) : query.eq("user_id", getIdentity().user.id);
  const { data: declarations } = await query;
  isqmDeclarationsCache = Object.fromEntries((declarations || []).map((d) => [d.user_id, d]));

  if (!isqmMembersCache.length) {
    wrap.innerHTML = `<div class="empty-state">No staff to show.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Staff</th><th>Designation</th><th>Status</th><th>Method</th><th>Actions</th></tr></thead>
      <tbody>
        ${isqmMembersCache
          .map((m) => {
            const d = isqmDeclarationsCache[m.user_id];
            const status = d?.status || "not_started";
            const methodLabel = d?.method === "manual_upload" ? "Manual Upload" : d?.method === "declared" ? "Declared In-App" : d?.method === "e_sign" ? "E-Sign" : "-";
            return `<tr>
              <td><strong>${m.profiles?.display_name || m.profiles?.email}</strong></td>
              <td>${m.profiles?.designation || "-"}</td>
              <td><span class="status-badge ${status === "completed" ? "status-completed" : status === "pending" ? "status-quotation" : "status-wip"}">${DECLARATION_STATUS_LABELS[status]}</span></td>
              <td>${methodLabel}</td>
              <td class="row-actions">
                <button class="btn-link" data-declare="${m.user_id}">Complete Declaration</button>
                <label class="btn-link" style="cursor:pointer;">Upload Signed Copy
                  <input type="file" accept="application/pdf" class="hidden" data-upload="${m.user_id}" />
                </label>
                ${status === "completed" ? `<button class="btn-link" data-view="${m.user_id}">View Document</button>` : ""}
                ${admin && status !== "not_started" ? `<button class="btn-link btn-link-danger" data-remove="${m.user_id}">Remove Declaration</button>` : ""}
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-declare]").forEach((btn) => {
    btn.addEventListener("click", () => openDeclarationModal(btn.dataset.declare));
  });
  wrap.querySelectorAll("[data-upload]").forEach((input) => {
    input.addEventListener("change", (e) => handleUpload(input.dataset.upload, e.target.files[0]));
  });
  wrap.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => viewSignedCopy(btn.dataset.view));
  });
  wrap.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeDeclaration(btn.dataset.remove));
  });
}

async function removeDeclaration(userId) {
  if (!confirm("Remove this declaration record? This deletes the stored document too and cannot be undone.")) return;
  const orgId = getIdentity()?.organisationId;
  const d = isqmDeclarationsCache[userId];

  if (d?.signed_document_url) {
    await supabase.storage.from("compliance-documents").remove([d.signed_document_url]);
  }

  const { error } = await supabase
    .from("independence_declarations")
    .delete()
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .eq("declaration_year", isqmCurrentYear);

  if (error) {
    alert("Could not remove: " + error.message);
    return;
  }
  await loadAndRender();
}

async function openDeclarationModal(userId) {
  const member = isqmMembersCache.find((m) => m.user_id === userId);
  if (!member) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:600px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Annual Independence Declaration</h2>
          <p class="modal-subtitle">${member.profiles?.display_name || member.profiles?.email} — ${isqmCurrentYear}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="decl-form">
        <p class="hint" style="margin-bottom:16px;">I confirm to the best of my knowledge and belief that I am compliant with the independence requirements of Section 290 of the MIA By-Laws on Professional Ethics, Conduct and Practice / the firm's statement of policy on independence, except for matters checked below.</p>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:6px;">
          ${THREAT_ITEMS.map(([key, label]) => `
            <label style="display:flex;align-items:flex-start;gap:8px;font-weight:400;font-size:13px;">
              <input type="checkbox" data-threat="${key}" style="width:auto;margin-top:2px;" /> ${label}
            </label>`).join("")}
        </div>

        <div id="threat-details-section" class="hidden" style="margin-top:14px;">
          <label style="display:block;margin-bottom:14px;">Details of Threats to Independence
            <textarea id="decl-details" rows="3" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;"></textarea>
          </label>
          <label style="display:block;margin-bottom:14px;">Appropriate Safeguards to Eliminate or Reduce Threats to an Acceptable Level
            <textarea id="decl-safeguards" rows="3" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;"></textarea>
          </label>
        </div>

        <label style="display:block;margin:14px 0;">Date
          <input type="text" id="decl-date" placeholder="31/12/2025" autocomplete="off" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>

        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin:16px 0;font-size:13px;">
          <input type="checkbox" id="decl-confirm" style="width:auto;" /> I confirm the above declaration is true and accurate.
        </label>

        <p id="decl-error" class="form-error hidden"></p>
        <div class="modal-actions">
          <button type="button" id="decl-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">Submit Declaration</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const todayDMY = (() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  })();
  backdrop.querySelector("#decl-date").value = todayDMY;

  try {
    await loadFlatpickr();
    window.flatpickr(backdrop.querySelector("#decl-date"), { dateFormat: "d/m/Y", allowInput: true });
  } catch (err) {
    console.warn(err.message);
  }

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  document.getElementById("decl-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelectorAll("[data-threat]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const anyChecked = [...backdrop.querySelectorAll("[data-threat]")].some((c) => c.checked);
      document.getElementById("threat-details-section").classList.toggle("hidden", !anyChecked);
    });
  });

  document.getElementById("decl-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("decl-error");
    const submitBtn = e.target.querySelector("button[type=submit]");

    if (!document.getElementById("decl-confirm").checked) {
      errorEl.textContent = "Please confirm the declaration before submitting.";
      errorEl.classList.remove("hidden");
      return;
    }

    const responses = {};
    backdrop.querySelectorAll("[data-threat]").forEach((cb) => { responses[cb.dataset.threat] = cb.checked; });
    responses.details = document.getElementById("decl-details").value.trim();
    responses.safeguards = document.getElementById("decl-safeguards").value.trim();

    const dateStr = document.getElementById("decl-date").value.trim() || todayDMY;
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      await loadPdfLib();
      const pdfBytes = await generateDeclarationPDF(member, isqmCurrentYear, dateStr, responses);
      const identity = getIdentity();
      const orgId = identity.organisationId;
      const path = `${orgId}/${userId}/${isqmCurrentYear}.pdf`;

      const { error: uploadError } = await supabase.storage.from("compliance-documents").upload(path, new Blob([pdfBytes], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("independence_declarations").upsert(
        {
          organisation_id: orgId,
          user_id: userId,
          declaration_year: isqmCurrentYear,
          method: "declared",
          status: "completed",
          signed_document_url: path,
          completed_at: new Date().toISOString(),
          created_by: identity.user.id,
          responses,
        },
        { onConflict: "organisation_id,user_id,declaration_year" }
      );
      if (dbError) throw dbError;

      const downloadUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `Independence-Declaration-${(member.profiles?.display_name || "staff").replace(/\s+/g, "-")}-${isqmCurrentYear}.pdf`;
      a.click();
      URL.revokeObjectURL(downloadUrl);

      close();
      await loadAndRender();
    } catch (err) {
      errorEl.textContent = "Could not submit: " + err.message;
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Declaration";
    }
  });
}

async function generateDeclarationPDF(member, year, dateStr, responses) {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  const maxWidth = 595 - margin * 2;
  let y = 792;

  function draw(text, { size = 10, bold = false, gapAfter = 8 } = {}) {
    const useFont = bold ? boldFont : font;
    const words = String(text).split(" ");
    let line = "";
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (useFont.widthOfTextAtSize(testLine, size) > maxWidth && line) {
        page.drawText(line, { x: margin, y, size, font: useFont });
        y -= size + 4;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      page.drawText(line, { x: margin, y, size, font: useFont });
      y -= size + 4;
    }
    y -= gapAfter;
  }

  draw("Annual Independence Declaration", { size: 16, bold: true, gapAfter: 14 });
  draw(`Declaration Year: ${year}`, { size: 10, gapAfter: 12 });
  draw(
    "I confirm to the best of my knowledge and belief that I am in compliant with the independence requirements of Section 290 of the MIA By-Laws on Professional Ethics, Conduct and Practice / the firm's statement of policy on independence except for matters listed below, if any.",
    { size: 10 }
  );
  draw(
    "To the best of my knowledge and belief, the following matters might affect the independence of the firm in providing professional services to its clients:",
    { size: 10, gapAfter: 10 }
  );

  THREAT_ITEMS.forEach(([key, label], i) => {
    const letter = String.fromCharCode(97 + i);
    draw(`${letter}) ${label}: ${responses[key] ? "YES" : "No"}`, { size: 10, gapAfter: 2 });
  });

  y -= 8;
  draw(
    "I understand that each matter above will be reviewed by the firm for the assessment of independence and consent to provide further information if required.",
    { size: 10, gapAfter: 12 }
  );

  draw(`Name: ${member.profiles?.display_name || member.profiles?.email}`, { size: 11, bold: true, gapAfter: 4 });
  draw(`Position: ${member.profiles?.designation || "-"}`, { size: 11, bold: true, gapAfter: 4 });
  draw(`Date: ${dateStr}`, { size: 11, bold: true, gapAfter: 16 });

  const anyFlagged = THREAT_ITEMS.some(([key]) => responses[key]);
  draw("Details of Threats to Independence:", { size: 10, bold: true, gapAfter: 2 });
  draw(anyFlagged ? responses.details || "N/A" : "N/A", { size: 10, gapAfter: 10 });
  draw("Appropriate Safeguards to Eliminate or Reduce Threats to an Acceptable Level:", { size: 10, bold: true, gapAfter: 2 });
  draw(anyFlagged ? responses.safeguards || "N/A" : "N/A", { size: 10, gapAfter: 16 });

  draw("Electronically declared and submitted via AuditFlow.", { size: 9, gapAfter: 4 });

  return pdfDoc.save();
}

async function handleUpload(userId, file) {
  if (!file) return;
  const identity = getIdentity();
  const orgId = identity.organisationId;
  const path = `${orgId}/${userId}/${isqmCurrentYear}.pdf`;

  const { error: uploadError } = await supabase.storage.from("compliance-documents").upload(path, file, { upsert: true });
  if (uploadError) {
    alert("Could not upload: " + uploadError.message);
    return;
  }

  const { error: dbError } = await supabase.from("independence_declarations").upsert(
    {
      organisation_id: orgId,
      user_id: userId,
      declaration_year: isqmCurrentYear,
      method: "manual_upload",
      status: "completed",
      signed_document_url: path,
      completed_at: new Date().toISOString(),
      created_by: identity.user.id,
    },
    { onConflict: "organisation_id,user_id,declaration_year" }
  );

  if (dbError) {
    alert("Uploaded, but could not update the record: " + dbError.message);
    return;
  }

  await loadAndRender();
}

async function viewSignedCopy(userId) {
  const d = isqmDeclarationsCache[userId];
  if (!d?.signed_document_url) return;
  const { data, error } = await supabase.storage.from("compliance-documents").createSignedUrl(d.signed_document_url, 300);
  if (error) { alert("Could not open the file: " + error.message); return; }
  window.open(data.signedUrl, "_blank");
}
