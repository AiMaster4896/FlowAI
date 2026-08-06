// assets/js/resources.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isManagerOrAdmin } from "./permissions.js";

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

const CATEGORY_LABELS = { firm_policy: "Firm Policy", audit: "Audit", tax: "Tax", accounting: "Accounting", others: "Others" };

function iconForContentType(contentType) {
  if (!contentType) return "📄";
  if (contentType.includes("pdf")) return "📕";
  if (contentType.includes("word") || contentType.includes("msword")) return "📘";
  if (contentType.includes("sheet") || contentType.includes("excel")) return "📗";
  return "📄";
}

let resourcesCache = [];
let categoryFilter = "";

export async function renderResources(el) {
  const admin = isManagerOrAdmin();
  el.innerHTML = `
    <div class="page-header">
      <h1>Resources</h1>
      <div class="page-actions">
        <select id="res-filter-category" class="filter-select">
          <option value="">All Categories</option>
          ${Object.entries(CATEGORY_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        ${admin ? `<button id="add-resource-btn" class="btn-dark">+ Add Resource</button>` : ""}
      </div>
    </div>
    <div class="import-card"><div id="resources-table-wrap">Loading...</div></div>
  `;

  document.getElementById("res-filter-category").addEventListener("change", (e) => {
    categoryFilter = e.target.value;
    renderTable();
  });

  const addBtn = document.getElementById("add-resource-btn");
  if (addBtn) addBtn.addEventListener("click", () => openResourceModal(null));

  await loadAndRenderResources();
}

async function loadAndRenderResources() {
  const orgId = getIdentity()?.organisationId;
  const wrap = document.getElementById("resources-table-wrap");
  const { data, error } = await supabase
    .from("resources")
    .select("id, display_name, file_name, storage_path, content_type, category, description, created_at")
    .eq("organisation_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    wrap.innerHTML = `<div class="empty-state">Could not load resources.</div>`;
    return;
  }
  resourcesCache = data || [];
  renderTable();
}

function renderTable() {
  const wrap = document.getElementById("resources-table-wrap");
  const admin = isManagerOrAdmin();
  const filtered = categoryFilter ? resourcesCache.filter((r) => r.category === categoryFilter) : resourcesCache;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><p>No resources yet.</p></div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Type</th><th>Document Name</th><th>Description</th><th>File</th><th>Actions</th></tr></thead>
      <tbody>
        ${filtered
          .map(
            (r) => `<tr>
              <td><span class="status-badge status-wip">${CATEGORY_LABELS[r.category] || "Others"}</span></td>
              <td><strong>${r.display_name || r.file_name}</strong></td>
              <td>${r.description || "-"}</td>
              <td>${iconForContentType(r.content_type)} ${r.file_name}</td>
              <td class="row-actions">
                <button class="btn-link" data-preview="${r.id}">Preview</button>
                <button class="btn-link" data-download="${r.id}">Download</button>
                ${admin ? `<button class="icon-btn icon-btn-edit" data-edit="${r.id}" title="Edit">${EDIT_ICON}</button>` : ""}
                ${admin ? `<button class="icon-btn icon-btn-delete" data-delete="${r.id}" title="Delete">${DELETE_ICON}</button>` : ""}
              </td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-preview]").forEach((btn) => {
    btn.addEventListener("click", () => openFile(btn.dataset.preview, false));
  });
  wrap.querySelectorAll("[data-download]").forEach((btn) => {
    btn.addEventListener("click", () => openFile(btn.dataset.download, true));
  });
  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const resource = resourcesCache.find((r) => r.id === btn.dataset.edit);
      openResourceModal(resource);
    });
  });
  wrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const resource = resourcesCache.find((r) => r.id === btn.dataset.delete);
      if (!confirm(`Delete "${resource?.display_name || resource?.file_name}"? This cannot be undone.`)) return;
      await supabase.storage.from("resources").remove([resource.storage_path]);
      const { error } = await supabase.from("resources").delete().eq("id", resource.id);
      if (error) { alert("Could not delete: " + error.message); return; }
      await loadAndRenderResources();
    });
  });
}

async function openFile(resourceId, forceDownload) {
  const resource = resourcesCache.find((r) => r.id === resourceId);
  if (!resource) return;
  const { data, error } = await supabase.storage.from("resources").createSignedUrl(resource.storage_path, 300, forceDownload ? { download: resource.file_name } : undefined);
  if (error) { alert("Could not open the file: " + error.message); return; }
  window.open(data.signedUrl, "_blank");
}

function openResourceModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${isEdit ? "Edit Resource" : "Add Resource"}</h2>
          <p class="modal-subtitle">${isEdit ? "Update this resource's details." : "Upload a PDF, Word, or Excel file for your team."}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="res-form">
        <label style="display:block;margin-bottom:14px;">Type
          <select id="res-category" required style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;">
            ${Object.entries(CATEGORY_LABELS).map(([k, v]) => `<option value="${k}" ${existing?.category === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label style="display:block;margin-bottom:14px;">Document Name
          <input type="text" id="res-name" required value="${existing?.display_name ?? ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <label style="display:block;margin-bottom:14px;">Description
          <textarea id="res-description" rows="3" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;">${existing?.description ?? ""}</textarea>
        </label>
        <label style="display:block;margin-bottom:4px;">${isEdit ? "Replace File (optional)" : "File"}
          <input type="file" id="res-file" accept=".pdf,.doc,.docx,.xls,.xlsx" ${isEdit ? "" : "required"} style="width:100%;margin-top:6px;" />
        </label>
        ${isEdit ? `<p class="hint" style="margin-top:0;">Currently: ${existing.file_name}</p>` : ""}
        <p id="res-error" class="form-error hidden"></p>
        <div class="modal-actions">
          <button type="button" id="res-cancel" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${isEdit ? "Save Changes" : "Add Resource"}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#res-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#res-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = backdrop.querySelector("#res-error");
    const submitBtn = e.target.querySelector("button[type=submit]");
    const identity = getIdentity();
    const orgId = identity.organisationId;
    const file = backdrop.querySelector("#res-file").files[0];

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";

    let storagePath = existing?.storage_path;
    let fileName = existing?.file_name;
    let contentType = existing?.content_type;

    if (file) {
      const ext = file.name.split(".").pop();
      storagePath = `${orgId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("resources").upload(storagePath, file, { contentType: file.type });
      if (uploadError) {
        errorEl.textContent = "Could not upload: " + uploadError.message;
        errorEl.classList.remove("hidden");
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? "Save Changes" : "Add Resource";
        return;
      }
      fileName = file.name;
      contentType = file.type;

      // Replacing a file on edit — remove the old one so storage doesn't accumulate orphans.
      if (isEdit && existing.storage_path && existing.storage_path !== storagePath) {
        await supabase.storage.from("resources").remove([existing.storage_path]);
      }
    }

    const payload = {
      organisation_id: orgId,
      display_name: backdrop.querySelector("#res-name").value.trim(),
      description: backdrop.querySelector("#res-description").value.trim() || null,
      category: backdrop.querySelector("#res-category").value,
      storage_path: storagePath,
      file_name: fileName,
      content_type: contentType,
      size_bytes: file ? file.size : existing?.size_bytes,
      uploaded_by: identity.user.id,
    };

    const { error } = isEdit
      ? await supabase.from("resources").update(payload).eq("id", existing.id)
      : await supabase.from("resources").insert(payload);

    if (error) {
      errorEl.textContent = "Could not save: " + error.message;
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? "Save Changes" : "Add Resource";
      return;
    }

    close();
    await loadAndRenderResources();
  });
}
