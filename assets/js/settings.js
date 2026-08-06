// assets/js/settings.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { isFirmAdmin } from "./permissions.js";

const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

export async function renderSettings(el) {
  el.innerHTML = `
    <div class="page-header"><h1>Firm Settings</h1></div>
    <div class="import-card">
      <h3>Firm Profile</h3>
      <p class="hint">Your firm name and logo appear on the workspace spotlight board that everyone sees.</p>
      <label style="display:block;max-width:360px;margin-bottom:16px;">Firm Name
        <input type="text" id="firm-name-input" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
      </label>
      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        <div>
          <p class="option-label">Firm Logo</p>
          <div id="logo-preview" class="asset-preview"></div>
          <input type="file" id="logo-file-input" accept="image/*" class="hidden" />
          <button id="logo-upload-btn" class="btn-secondary" style="margin-top:8px;">Upload Logo</button>
        </div>
      </div>
      <button id="save-firm-name-btn" class="btn-dark" style="margin-top:16px;">Save Firm Name</button>
      <p id="firm-profile-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Staff Permissions</h3>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;">
        <input type="checkbox" id="staff-client-list-toggle" /> Allow staff to access Client List directly
      </label>
      <p class="hint" style="margin-top:6px;">When turned off, staff no longer see Client List in the sidebar or can navigate to it directly. They can still view full client details by clicking through from the Dashboard.</p>
      <p id="staff-permissions-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Branches &amp; Teams</h3>
      <p class="hint">Every team belongs to one branch. Assign clients and staff to teams in Client List and User Management — access to client data is scoped by these.</p>
      ${isFirmAdmin() ? `
        <div style="display:flex;gap:10px;margin-bottom:16px;">
          <input type="text" id="new-branch-name" placeholder="New branch name" style="flex:1;max-width:200px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          <input type="text" id="new-branch-code" placeholder="Code, e.g. PJ" style="width:110px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          <button id="add-branch-btn" class="btn-secondary">+ Add Branch</button>
        </div>
      ` : ""}
      <p id="branches-error" class="form-error hidden"></p>
      <div id="branches-list">Loading...</div>
    </div>

    <div class="import-card">
      <h3>Work Order Types</h3>
      <p class="hint">Every type your firm uses — built-in ones can be renamed and have their workflow customised, but not deleted (their name change is safe, the underlying behaviour like invoice fields or the approval flow stays tied to the type itself). Add your own below for anything else.</p>
      ${isFirmAdmin() ? `
        <div style="display:flex;gap:10px;margin-bottom:16px;">
          <input type="text" id="new-wo-type-label" placeholder="e.g. Company Secretarial" style="flex:1;max-width:220px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          <input type="text" id="new-wo-type-code" placeholder="Code, e.g. CS" style="width:110px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
          <button id="add-wo-type-btn" class="btn-secondary">+ Add Type</button>
        </div>
      ` : ""}
      <p id="wo-types-error" class="form-error hidden"></p>
      <div id="wo-types-list">Loading...</div>
    </div>

    <div class="import-card">
      <h3>Virtual Workspace Background</h3>
      <p class="hint">Upload a photo of your actual office (or any background you like) to use in the Virtual Workspace instead of the default layout. Avatars and the AI Assistant will appear on top of it.</p>
      <div id="bg-preview" class="asset-preview" style="width:100%;max-width:480px;height:160px;"></div>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <input type="file" id="bg-file-input" accept="image/*" class="hidden" />
        <button id="bg-upload-btn" class="btn-secondary">Upload Background</button>
        <button id="bg-reset-btn" class="btn-secondary">Reset to Default</button>
      </div>
      <p id="bg-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Announcement Banner</h3>
      <p class="hint">Shown at the top of the app for everyone in your firm.</p>
      <div style="display:flex;gap:20px;margin-top:8px;margin-bottom:12px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;">
          <input type="radio" name="banner-mode" id="banner-mode-manual" value="manual" /> Manual Text
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px;">
          <input type="radio" name="banner-mode" id="banner-mode-ticker" value="ticker" /> Rotating Ticker (from Firm Announcements)
        </label>
      </div>
      <div id="banner-manual-fields">
        <input type="text" id="announcement-input" placeholder="e.g. Office closed for Hari Raya on 31 Mar" style="width:100%;max-width:480px;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        <div style="display:flex;gap:10px;margin-top:10px;">
          <button id="announcement-save-btn" class="btn-dark">Save Announcement</button>
          <button id="announcement-clear-btn" class="btn-secondary">Clear</button>
        </div>
      </div>
      <p id="banner-ticker-note" class="hint hidden">Pulls the 5 most recent announcements marked "Include in rotating banner" from Firm Announcements — each one scrolls across, then swaps to the next every 5 seconds.</p>
      <p id="announcement-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Announcement Templates</h3>
      <p class="hint">Used automatically whenever a client is added or removed from Client List. <code>{client_name}</code> is replaced with the actual company name.</p>
      <label style="display:block;margin-top:10px;">Client Won
        <textarea id="template-client-won" rows="4" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;"></textarea>
      </label>
      <label style="display:block;margin-top:14px;">Client Lost
        <textarea id="template-client-lost" rows="4" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box;"></textarea>
      </label>
      <button id="templates-save-btn" class="btn-dark" style="margin-top:12px;">Save Templates</button>
      <p id="templates-error" class="form-error hidden"></p>
    </div>

    <div class="import-card">
      <h3>Independence Declaration Template</h3>
      <p class="hint">Upload a PDF with fillable form fields named <code>staff_name</code>, <code>designation</code>, <code>year</code>, and <code>date</code> — ISQM uses this to generate a prefilled copy per staff member each year. Any field it doesn't find is simply left blank.</p>
      <p id="template-status" class="hint"></p>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <input type="file" id="template-file-input" accept="application/pdf" class="hidden" />
        <button id="template-upload-btn" class="btn-secondary">Upload Template</button>
      </div>
      <p id="template-error" class="form-error hidden"></p>
    </div>
  `;

  const identity = getIdentity();
  const orgId = identity.organisationId;

  const [{ data: org }, { data: orgSettings }] = await Promise.all([
    supabase.from("organisations").select("id, name").eq("id", orgId).single(),
    supabase.from("organisation_settings").select("logo_url, workspace_background_url, independence_template_url, announcement_text, banner_mode, client_won_template, client_lost_template, staff_client_list_access").eq("organisation_id", orgId).maybeSingle(),
  ]);

  document.getElementById("firm-name-input").value = org?.name || "";
  renderAssetPreview("logo-preview", orgSettings?.logo_url, "Logo");
  renderAssetPreview("bg-preview", orgSettings?.workspace_background_url, "Background");
  document.getElementById("announcement-input").value = orgSettings?.announcement_text || "";
  document.getElementById("template-client-won").value = orgSettings?.client_won_template || "";
  document.getElementById("template-client-lost").value = orgSettings?.client_lost_template || "";
  document.getElementById("template-status").textContent = orgSettings?.independence_template_url
    ? "A template is currently uploaded."
    : "No template uploaded yet.";

  document.getElementById("staff-client-list-toggle").checked = orgSettings?.staff_client_list_access ?? true;
  document.getElementById("staff-client-list-toggle").addEventListener("change", async (e) => {
    const errorEl = document.getElementById("staff-permissions-error");
    const { error } = await supabase.from("organisation_settings").update({ staff_client_list_access: e.target.checked }).eq("organisation_id", orgId);
    if (error) {
      errorEl.textContent = "Could not save: " + error.message;
      errorEl.classList.remove("hidden");
      e.target.checked = !e.target.checked;
      return;
    }
    errorEl.classList.add("hidden");
  });

  const bannerMode = orgSettings?.banner_mode || "manual";
  document.getElementById(bannerMode === "ticker" ? "banner-mode-ticker" : "banner-mode-manual").checked = true;
  function applyBannerModeUI(mode) {
    document.getElementById("banner-manual-fields").classList.toggle("hidden", mode !== "manual");
    document.getElementById("banner-ticker-note").classList.toggle("hidden", mode !== "ticker");
  }
  applyBannerModeUI(bannerMode);
  document.querySelectorAll('input[name="banner-mode"]').forEach((radio) => {
    radio.addEventListener("change", async (e) => {
      applyBannerModeUI(e.target.value);
      const { error } = await supabase.from("organisation_settings").update({ banner_mode: e.target.value }).eq("organisation_id", orgId);
      if (error) alert("Could not update: " + error.message);
    });
  });

  document.getElementById("templates-save-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("templates-error");
    const { error } = await supabase.from("organisation_settings").update({
      client_won_template: document.getElementById("template-client-won").value.trim() || null,
      client_lost_template: document.getElementById("template-client-lost").value.trim() || null,
    }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
  });

  await loadAndRenderBranches();
  await loadAndRenderWorkOrderTypes();

  if (isFirmAdmin()) {
    document.getElementById("add-branch-btn").addEventListener("click", async () => {
      const errorEl = document.getElementById("branches-error");
      const nameInput = document.getElementById("new-branch-name");
      const codeInput = document.getElementById("new-branch-code");
      const name = nameInput.value.trim();
      if (!name) return;
      const { error } = await supabase.from("branches").insert({ organisation_id: orgId, name, code: codeInput.value.trim() || null });
      if (error) { errorEl.textContent = "Could not add branch: " + error.message; errorEl.classList.remove("hidden"); return; }
      errorEl.classList.add("hidden");
      nameInput.value = "";
      codeInput.value = "";
      await loadAndRenderBranches();
    });

    document.getElementById("add-wo-type-btn").addEventListener("click", async () => {
      const errorEl = document.getElementById("wo-types-error");
      const labelInput = document.getElementById("new-wo-type-label");
      const codeInput = document.getElementById("new-wo-type-code");
      const label = labelInput.value.trim();
      if (!label) return;
      const key = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!key) { errorEl.textContent = "Please enter a valid name."; errorEl.classList.remove("hidden"); return; }
      const { error } = await supabase.from("work_order_types").insert({ organisation_id: orgId, key, label, code: codeInput.value.trim() || null });
      if (error) { errorEl.textContent = "Could not add type: " + error.message; errorEl.classList.remove("hidden"); return; }
      errorEl.classList.add("hidden");
      labelInput.value = "";
      codeInput.value = "";
      await loadAndRenderWorkOrderTypes();
    });
  }

  document.getElementById("save-firm-name-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("firm-profile-error");
    const { error } = await supabase.from("organisations").update({ name: document.getElementById("firm-name-input").value.trim() }).eq("id", orgId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
  });

  document.getElementById("announcement-save-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("announcement-error");
    const text = document.getElementById("announcement-input").value.trim();
    const { error } = await supabase.from("organisation_settings").update({ announcement_text: text || null }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not save: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
    updateLiveBanner(text);
  });

  document.getElementById("announcement-clear-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("announcement-error");
    document.getElementById("announcement-input").value = "";
    const { error } = await supabase.from("organisation_settings").update({ announcement_text: null }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not clear: " + error.message; errorEl.classList.remove("hidden"); return; }
    errorEl.classList.add("hidden");
    updateLiveBanner("");
  });

  const logoInput = document.getElementById("logo-file-input");
  document.getElementById("logo-upload-btn").addEventListener("click", () => logoInput.click());
  logoInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadFirmAsset(file, "logo", "logo_url", "logo-preview", "firm-profile-error");
    logoInput.value = "";
  });

  const bgInput = document.getElementById("bg-file-input");
  document.getElementById("bg-upload-btn").addEventListener("click", () => bgInput.click());
  bgInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await uploadFirmAsset(file, "workspace-bg", "workspace_background_url", "bg-preview", "bg-error");
    bgInput.value = "";
  });

  document.getElementById("bg-reset-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("bg-error");
    const { error } = await supabase.from("organisation_settings").update({ workspace_background_url: null }).eq("organisation_id", orgId);
    if (error) { errorEl.textContent = "Could not reset: " + error.message; errorEl.classList.remove("hidden"); return; }
    renderAssetPreview("bg-preview", null, "Background");
    errorEl.classList.add("hidden");
  });

  const templateInput = document.getElementById("template-file-input");
  document.getElementById("template-upload-btn").addEventListener("click", () => templateInput.click());
  templateInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const errorEl = document.getElementById("template-error");
    errorEl.classList.add("hidden");

    const path = `${orgId}/independence-template.pdf`;
    const { error: uploadError } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
    if (uploadError) {
      errorEl.textContent = "Could not upload: " + uploadError.message;
      errorEl.classList.remove("hidden");
      return;
    }

    const { data: urlData } = supabase.storage.from("firm-assets").getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const { error: dbError } = await supabase.from("organisation_settings").update({ independence_template_url: publicUrl }).eq("organisation_id", orgId);
    if (dbError) {
      errorEl.textContent = "Uploaded, but could not save reference: " + dbError.message;
      errorEl.classList.remove("hidden");
      return;
    }

    document.getElementById("template-status").textContent = "A template is currently uploaded.";
    templateInput.value = "";
  });
}

async function loadAndRenderBranches() {
  const identity = getIdentity();
  const orgId = identity.organisationId;
  const admin = isFirmAdmin();
  const wrap = document.getElementById("branches-list");

  const [{ data: branches }, { data: teams }] = await Promise.all([
    supabase.from("branches").select("id, name, code").eq("organisation_id", orgId).order("name"),
    supabase.from("teams").select("id, name, code, branch_id").eq("organisation_id", orgId).order("name"),
  ]);

  if (!branches?.length) {
    wrap.innerHTML = `<div class="empty-state">No branches yet. ${admin ? "Add one above to get started." : "Ask your admin to set one up."}</div>`;
    return;
  }

  wrap.innerHTML = branches
    .map((b) => {
      const branchTeams = (teams || []).filter((t) => t.branch_id === b.id);
      return `
        <div style="border:1px solid var(--gray-200);border-radius:10px;padding:14px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${b.name} ${b.code ? `<span class="hint">(${b.code})</span>` : ""}</strong>
            ${admin ? `<div style="display:flex;gap:6px;">
              <button class="icon-btn icon-btn-edit" data-rename-branch="${b.id}" data-name="${b.name}" data-code="${b.code || ""}" title="Rename Branch / Edit Code">${EDIT_ICON}</button>
              <button class="icon-btn icon-btn-delete" data-delete-branch="${b.id}" title="Delete Branch">${DELETE_ICON}</button>
            </div>` : ""}
          </div>
          <ul style="margin:10px 0 0;padding-left:18px;">
            ${branchTeams.map((t) => `
              <li style="display:flex;justify-content:space-between;align-items:center;max-width:340px;margin-bottom:4px;">
                <span>${t.name} ${t.code ? `<span class="hint">(${t.code})</span>` : ""}</span>
                ${admin ? `<div style="display:flex;gap:6px;">
                  <button class="icon-btn icon-btn-edit" data-rename-team="${t.id}" data-name="${t.name}" data-code="${t.code || ""}" title="Rename Team / Edit Code">${EDIT_ICON}</button>
                  <button class="icon-btn icon-btn-delete" data-delete-team="${t.id}" title="Delete Team">${DELETE_ICON}</button>
                </div>` : ""}
              </li>`).join("")}
          </ul>
          ${admin ? `
            <div style="display:flex;gap:8px;margin-top:10px;">
              <input type="text" class="new-team-name" data-branch="${b.id}" placeholder="New team name" style="flex:1;max-width:180px;padding:7px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;" />
              <input type="text" class="new-team-code" data-branch="${b.id}" placeholder="Code, e.g. 01" style="width:90px;padding:7px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;" />
              <button class="btn-secondary add-team-btn" data-branch="${b.id}" style="padding:7px 12px;font-size:13px;">+ Add Team</button>
            </div>
          ` : ""}
        </div>`;
    })
    .join("");

  if (!admin) return;

  wrap.querySelectorAll(".add-team-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const input = wrap.querySelector(`.new-team-name[data-branch="${btn.dataset.branch}"]`);
      const codeInput = wrap.querySelector(`.new-team-code[data-branch="${btn.dataset.branch}"]`);
      const name = input.value.trim();
      if (!name) return;
      const { error } = await supabase.from("teams").insert({ organisation_id: orgId, branch_id: btn.dataset.branch, name, code: codeInput.value.trim() || null });
      if (error) { alert("Could not add team: " + error.message); return; }
      await loadAndRenderBranches();
    });
  });

  wrap.querySelectorAll("[data-rename-branch]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const result = await promptNameAndCode({
        title: "Edit Branch", nameLabel: "Branch Name", currentName: btn.dataset.name,
        codeLabel: "Code (used in work order numbers)", codePlaceholder: "e.g. PJ", currentCode: btn.dataset.code,
      });
      if (!result) return;
      const { error } = await supabase.from("branches").update({ name: result.name || btn.dataset.name, code: result.code || null }).eq("id", btn.dataset.renameBranch);
      if (error) { alert("Could not update: " + error.message); return; }
      await loadAndRenderBranches();
    });
  });

  wrap.querySelectorAll("[data-rename-team]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const result = await promptNameAndCode({
        title: "Edit Team", nameLabel: "Team Name", currentName: btn.dataset.name,
        codeLabel: "Code (used in work order numbers)", codePlaceholder: "e.g. 01", currentCode: btn.dataset.code,
      });
      if (!result) return;
      const { error } = await supabase.from("teams").update({ name: result.name || btn.dataset.name, code: result.code || null }).eq("id", btn.dataset.renameTeam);
      if (error) { alert("Could not update: " + error.message); return; }
      await loadAndRenderBranches();
    });
  });

  wrap.querySelectorAll("[data-delete-branch]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this branch? All its teams will be deleted too, and any clients/staff assigned to them will need reassigning.")) return;
      const { error } = await supabase.from("branches").delete().eq("id", btn.dataset.deleteBranch);
      if (error) { alert("Could not delete: " + error.message); return; }
      await loadAndRenderBranches();
    });
  });

  wrap.querySelectorAll("[data-delete-team]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this team? Any clients/staff assigned to it will need reassigning.")) return;
      const { error } = await supabase.from("teams").delete().eq("id", btn.dataset.deleteTeam);
      if (error) { alert("Could not delete: " + error.message); return; }
      await loadAndRenderBranches();
    });
  });
}

async function loadAndRenderWorkOrderTypes() {
  const identity = getIdentity();
  const orgId = identity.organisationId;
  const admin = isFirmAdmin();
  const wrap = document.getElementById("wo-types-list");

  const { data: types } = await supabase.from("work_order_types").select("id, key, label, code, is_builtin, has_steps, show_in_dashboard").eq("organisation_id", orgId).order("label");

  if (!types?.length) {
    wrap.innerHTML = `<div class="empty-state">Nothing to show yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Type</th><th>Code</th><th>Has Steps</th><th>Show in Dashboard</th><th>Actions</th></tr></thead>
      <tbody>
        ${types.map((t) => `
          <tr>
            <td>${t.label}${t.is_builtin ? ` <span class="hint">(built-in)</span>` : ""}</td>
            <td>${t.code || "-"}</td>
            <td><input type="checkbox" class="wo-type-has-steps" data-id="${t.id}" ${t.has_steps ? "checked" : ""} ${admin ? "" : "disabled"} /></td>
            <td><input type="checkbox" class="wo-type-show-dash" data-id="${t.id}" ${t.show_in_dashboard ? "checked" : ""} ${admin ? "" : "disabled"} /></td>
            <td class="row-actions">
              ${admin ? `<button class="icon-btn icon-btn-edit" data-rename-wo-type="${t.id}" data-label="${t.label}" data-code="${t.code || ""}" title="Rename / Edit Code">${EDIT_ICON}</button>` : ""}
              ${admin && t.has_steps ? `<button class="btn-link" data-edit-steps="${t.id}" data-key="${t.key}" data-label="${t.label}">Edit Steps</button>` : ""}
              ${admin && !t.is_builtin ? `<button class="icon-btn icon-btn-delete" data-delete-wo-type="${t.id}" title="Delete">${DELETE_ICON}</button>` : ""}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;

  if (!admin) return;

  wrap.querySelectorAll("[data-rename-wo-type]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const result = await promptNameAndCode({
        title: "Edit Work Order Type", nameLabel: "Type Name", currentName: btn.dataset.label,
        codeLabel: "Code (used in work order numbers)", codePlaceholder: "e.g. A", currentCode: btn.dataset.code,
      });
      if (!result) return;
      const { error } = await supabase.from("work_order_types").update({ label: result.name || btn.dataset.label, code: result.code || null }).eq("id", btn.dataset.renameWoType);
      if (error) { alert("Could not update: " + error.message); return; }
      await loadAndRenderWorkOrderTypes();
    });
  });

  wrap.querySelectorAll(".wo-type-has-steps").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const { error } = await supabase.from("work_order_types").update({ has_steps: cb.checked }).eq("id", cb.dataset.id);
      if (error) { alert("Could not update: " + error.message); cb.checked = !cb.checked; return; }
      await loadAndRenderWorkOrderTypes();
    });
  });

  wrap.querySelectorAll(".wo-type-show-dash").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const { error } = await supabase.from("work_order_types").update({ show_in_dashboard: cb.checked }).eq("id", cb.dataset.id);
      if (error) { alert("Could not update: " + error.message); cb.checked = !cb.checked; return; }
    });
  });

  wrap.querySelectorAll("[data-edit-steps]").forEach((btn) => {
    btn.addEventListener("click", () => openStepsEditor(btn.dataset.editSteps, btn.dataset.label));
  });

  wrap.querySelectorAll("[data-delete-wo-type]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this work order type? Existing work orders of this type will keep it, but it won't be selectable for new ones.")) return;
      const { error } = await supabase.from("work_order_types").delete().eq("id", btn.dataset.deleteWoType);
      if (error) { alert("Could not delete: " + error.message); return; }
      await loadAndRenderWorkOrderTypes();
    });
  });
}

function promptNameAndCode({ title, nameLabel, currentName, codeLabel, codePlaceholder, currentCode }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-card" style="max-width:380px;">
        <div class="modal-header">
          <div><h2 class="modal-title">${title}</h2></div>
          <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
        </div>
        <label style="display:block;margin-bottom:14px;">${nameLabel}
          <input type="text" id="pnc-name" value="${currentName || ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <label style="display:block;margin-bottom:4px;">${codeLabel}
          <input type="text" id="pnc-code" placeholder="${codePlaceholder}" value="${currentCode || ""}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;" />
        </label>
        <div class="modal-actions" style="margin-top:16px;">
          <button type="button" id="pnc-cancel" class="btn-secondary">Cancel</button>
          <button type="button" id="pnc-save" class="btn-dark">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = (result) => { backdrop.remove(); resolve(result); };
    backdrop.querySelector("#modal-close-btn").addEventListener("click", () => close(null));
    backdrop.querySelector("#pnc-cancel").addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector("#pnc-save").addEventListener("click", () => {
      close({ name: backdrop.querySelector("#pnc-name").value.trim(), code: backdrop.querySelector("#pnc-code").value.trim() });
    });
  });
}

async function openStepsEditor(typeId, label) {
  const { data: steps } = await supabase.from("work_order_type_steps").select("step_name").eq("work_order_type_id", typeId).order("step_number");
  const currentText = (steps || []).map((s) => s.step_name).join("\n");

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Steps — ${label}</h2>
          <p class="modal-subtitle">One step per line, in order. This changes the workflow for new work orders of this type — existing ones keep their current steps.</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <textarea id="steps-textarea" rows="10" style="width:100%;padding:10px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;">${currentText}</textarea>
      <p id="steps-error" class="form-error hidden"></p>
      <div class="modal-actions" style="margin-top:16px;">
        <button type="button" id="steps-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="steps-save" class="btn-dark">Save Steps</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#steps-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#steps-save").addEventListener("click", async () => {
    const errorEl = backdrop.querySelector("#steps-error");
    const lines = backdrop.querySelector("#steps-textarea").value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { errorEl.textContent = "Enter at least one step."; errorEl.classList.remove("hidden"); return; }

    const { error: deleteError } = await supabase.from("work_order_type_steps").delete().eq("work_order_type_id", typeId);
    if (deleteError) { errorEl.textContent = "Could not save: " + deleteError.message; errorEl.classList.remove("hidden"); return; }

    const { error: insertError } = await supabase.from("work_order_type_steps").insert(
      lines.map((step_name, i) => ({ work_order_type_id: typeId, step_number: i + 1, step_name }))
    );
    if (insertError) { errorEl.textContent = "Could not save: " + insertError.message; errorEl.classList.remove("hidden"); return; }

    close();
  });
}

function renderAssetPreview(elementId, url, label) {
  const el = document.getElementById(elementId);
  el.innerHTML = url ? `<img src="${url}" alt="${label}" />` : `<span class="hint">No ${label.toLowerCase()} set</span>`;
}

async function uploadFirmAsset(file, filenamePrefix, dbColumn, previewElId, errorElId) {
  const identity = getIdentity();
  const orgId = identity.organisationId;
  const errorEl = document.getElementById(errorElId);
  errorEl.classList.add("hidden");

  const ext = file.name.split(".").pop();
  const path = `${orgId}/${filenamePrefix}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("firm-assets").upload(path, file, { upsert: true });
  if (uploadError) {
    errorEl.textContent = "Could not upload: " + uploadError.message;
    errorEl.classList.remove("hidden");
    return;
  }

  const { data: urlData } = supabase.storage.from("firm-assets").getPublicUrl(path);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`; // cache-bust so updates show immediately

  const { error: dbError } = await supabase
    .from("organisation_settings")
    .update({ [dbColumn]: publicUrl })
    .eq("organisation_id", orgId);

  if (dbError) {
    errorEl.textContent = "Uploaded, but could not save reference: " + dbError.message;
    errorEl.classList.remove("hidden");
    return;
  }

  renderAssetPreview(previewElId, publicUrl, filenamePrefix === "logo" ? "Logo" : "Background");
}

function updateLiveBanner(text) {
  const banner = document.getElementById("announcement-banner");
  if (!banner) return;
  if (text) {
    banner.textContent = text;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}
