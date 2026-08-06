// assets/js/announcements.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isFirmAdmin } from "./permissions.js";
import { paginationHtml, wirePagination } from "./excel-utils.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

function isoToDMYAnn(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const TYPE_LABELS = { client_onboarded: "New Client", client_resigned: "Client Resigned", general: "Announcement" };
const ANN_TYPE_COLORS = { client_onboarded: "status-completed", client_resigned: "status-rejected", general: "status-wip" };

let highlightId = null;
let annPage = 1;
let annPageSize = 10;
export function setHighlightAnnouncement(id) {
  highlightId = id;
}

export async function renderAnnouncements(el) {
  if (!highlightId) { annPage = 1; annPageSize = 10; }
  const admin = isFirmAdmin();
  el.innerHTML = `
    <div class="page-header">
      <h1>Firm Announcements</h1>
      ${admin ? `<div class="page-actions"><button id="unflash-all-btn" class="btn-secondary">Unflash All</button><button id="new-announcement-btn" class="btn-dark">+ New Announcement</button></div>` : ""}
    </div>
    <div id="announcements-feed"></div>
  `;

  if (admin) {
    document.getElementById("new-announcement-btn").addEventListener("click", () => openAnnouncementModal());
    document.getElementById("unflash-all-btn").addEventListener("click", async () => {
      if (!confirm("Turn off flashing for every announcement? This won't delete anything — just stops them all from appearing in the rotating banner.")) return;
      const orgId = getIdentity()?.organisationId;
      const { error } = await supabase.from("firm_announcements").update({ is_flash_enabled: false }).eq("organisation_id", orgId);
      if (error) { alert("Could not update: " + error.message); return; }
      await loadAndRenderFeed();
    });
  }

  await loadAndRenderFeed();
}

async function loadAndRenderFeed() {
  const orgId = getIdentity()?.organisationId;
  const admin = isFirmAdmin();
  const wrap = document.getElementById("announcements-feed");

  const { data, error } = await supabase
    .from("firm_announcements")
    .select("id, type, title, body, image_url, is_flash_enabled, client_id, announcement_date, created_at")
    .eq("organisation_id", orgId)
    .order("announcement_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    wrap.innerHTML = `<div class="empty-state">Could not load announcements.</div>`;
    return;
  }
  if (!data?.length) {
    wrap.innerHTML = `<div class="empty-state">No announcements yet.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(data.length / annPageSize));
  if (highlightId) {
    const idx = data.findIndex((a) => a.id === highlightId);
    if (idx >= 0) annPage = Math.floor(idx / annPageSize) + 1;
  }
  annPage = Math.min(Math.max(1, annPage), totalPages);
  const pageItems = data.slice((annPage - 1) * annPageSize, annPage * annPageSize);

  wrap.innerHTML = pageItems.map((a) => `
    <div class="import-card announcement-card" id="announcement-${a.id}" style="${a.id === highlightId ? "outline:2px solid var(--blue-600);" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <span class="status-badge ${ANN_TYPE_COLORS[a.type]}">${TYPE_LABELS[a.type]}</span>
          <h3 style="margin:8px 0 4px;">${a.title}</h3>
          <p class="hint" style="margin:0;">${isoToDMYAnn(a.announcement_date)}</p>
        </div>
        ${admin ? `
          <div style="display:flex;gap:6px;align-items:center;">
            <label style="font-size:12px;display:flex;align-items:center;gap:4px;">
              <input type="checkbox" class="ann-flash-toggle" data-id="${a.id}" ${a.is_flash_enabled ? "checked" : ""} /> Flash
            </label>
            <button class="icon-btn icon-btn-edit" data-edit-ann="${a.id}" title="Edit">${EDIT_ICON}</button>
            <button class="icon-btn icon-btn-delete" data-delete-ann="${a.id}" title="Delete">${DELETE_ICON}</button>
          </div>
        ` : ""}
      </div>
      ${a.body ? `<p style="white-space:pre-wrap;margin-top:12px;">${a.body}</p>` : ""}
      ${a.image_url ? `<img src="${a.image_url}" style="max-width:100%;border-radius:8px;margin-top:12px;" />` : ""}
      ${a.type === "client_onboarded" ? `<button class="btn-secondary" style="margin-top:14px;" data-report-concern="${a.id}" data-client-id="${a.client_id || ""}">Report Independence Concern</button>` : ""}
    </div>
  `).join("") + paginationHtml("ann", annPage, annPageSize, data.length);

  wirePagination("ann", {
    onPrev: () => { annPage--; loadAndRenderFeed(); },
    onNext: () => { annPage++; loadAndRenderFeed(); },
    onPageSizeChange: (size) => { annPageSize = size; annPage = 1; loadAndRenderFeed(); },
  });

  if (highlightId) {
    document.getElementById(`announcement-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightId = null;
  }

  if (admin) {
    wrap.querySelectorAll(".ann-flash-toggle").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const { error } = await supabase.from("firm_announcements").update({ is_flash_enabled: cb.checked }).eq("id", cb.dataset.id);
        if (error) { alert("Could not update: " + error.message); cb.checked = !cb.checked; }
      });
    });
    wrap.querySelectorAll("[data-edit-ann]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { data: existing } = await supabase.from("firm_announcements").select("*").eq("id", btn.dataset.editAnn).maybeSingle();
        if (existing) openAnnouncementModal(existing);
      });
    });
    wrap.querySelectorAll("[data-delete-ann]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this announcement?")) return;
        const { error } = await supabase.from("firm_announcements").delete().eq("id", btn.dataset.deleteAnn);
        if (error) { alert("Could not delete: " + error.message); return; }
        await loadAndRenderFeed();
      });
    });
  }

  wrap.querySelectorAll("[data-report-concern]").forEach((btn) => {
    btn.addEventListener("click", () => openIndependenceReportModal(btn.dataset.reportConcern, btn.dataset.clientId));
  });
}

function openAnnouncementModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:520px;">
      <div class="modal-header">
        <div><h2 class="modal-title">${isEdit ? "Edit Announcement" : "New Announcement"}</h2></div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <label>Title
        <input type="text" id="ann-title" value="${existing?.title ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-top:14px;">Body
        <textarea id="ann-body" rows="5" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;">${existing?.body ?? ""}</textarea>
      </label>
      <label style="display:block;margin-top:14px;">Photo (optional)
        <input type="file" id="ann-photo" accept="image/*" style="width:100%;margin-top:6px;" />
        ${existing?.image_url ? `<img src="${existing.image_url}" style="max-width:160px;margin-top:8px;border-radius:6px;display:block;" />` : ""}
      </label>
      <label style="display:block;margin-top:14px;">Announcement Date
        <input type="date" id="ann-date" value="${existing?.announcement_date ?? new Date().toISOString().slice(0, 10)}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
        <span class="hint">Can be backdated if needed.</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;">
        <input type="checkbox" id="ann-flash" ${existing?.is_flash_enabled ? "checked" : ""} /> Include in rotating banner
      </label>
      <p id="ann-error" class="form-error hidden"></p>
      <div class="modal-actions" style="margin-top:16px;">
        <button type="button" id="ann-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="ann-save" class="btn-dark">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#ann-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#ann-save").addEventListener("click", async () => {
    const errorEl = backdrop.querySelector("#ann-error");
    const orgId = getIdentity()?.organisationId;
    const title = backdrop.querySelector("#ann-title").value.trim();
    const body = backdrop.querySelector("#ann-body").value.trim();
    const date = backdrop.querySelector("#ann-date").value;
    const flash = backdrop.querySelector("#ann-flash").checked;
    const photoFile = backdrop.querySelector("#ann-photo").files[0];

    if (!title) { errorEl.textContent = "Please enter a title."; errorEl.classList.remove("hidden"); return; }

    let imageUrl = existing?.image_url || null;
    if (photoFile) {
      const path = `${orgId}/announcements/${Date.now()}_${photoFile.name}`;
      const { error: uploadError } = await supabase.storage.from("firm-assets").upload(path, photoFile, { upsert: true });
      if (uploadError) { errorEl.textContent = "Could not upload photo: " + uploadError.message; errorEl.classList.remove("hidden"); return; }
      imageUrl = supabase.storage.from("firm-assets").getPublicUrl(path).data.publicUrl;
    }

    const payload = { title, body, image_url: imageUrl, is_flash_enabled: flash, announcement_date: date };

    const { error } = isEdit
      ? await supabase.from("firm_announcements").update(payload).eq("id", existing.id)
      : await supabase.from("firm_announcements").insert({ ...payload, organisation_id: orgId, type: "general", created_by: getIdentity()?.user?.id });

    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    close();
    await loadAndRenderFeed();
  });
}

function openIndependenceReportModal(announcementId, clientId) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:460px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Report Independence Concern</h2>
          <p class="modal-subtitle">This goes directly to the firm's partners for review.</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <label>Describe the concern
        <textarea id="icr-desc" rows="5" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;" placeholder="e.g. prior employment, financial interest, close personal relationship..."></textarea>
      </label>
      <p id="icr-error" class="form-error hidden"></p>
      <div class="modal-actions" style="margin-top:16px;">
        <button type="button" id="icr-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="icr-save" class="btn-dark">Submit Report</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#icr-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#icr-save").addEventListener("click", async () => {
    const errorEl = backdrop.querySelector("#icr-error");
    const description = backdrop.querySelector("#icr-desc").value.trim();
    if (!description) { errorEl.textContent = "Please describe the concern."; errorEl.classList.remove("hidden"); return; }

    const { error } = await supabase.from("independence_concern_reports").insert({
      organisation_id: getIdentity()?.organisationId,
      announcement_id: announcementId,
      client_id: clientId || null,
      reported_by: getIdentity()?.user?.id,
      description,
    });

    if (error) { errorEl.textContent = "Could not submit: " + error.message; errorEl.classList.remove("hidden"); return; }
    close();
    alert("Thank you — your report has been submitted to the partners.");
  });
}
