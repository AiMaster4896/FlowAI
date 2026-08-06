// assets/js/commandCenter.js
import { supabase } from "./supabase-client.js";
import { getIdentity, startImpersonation } from "./auth.js";
import { navigate } from "./router.js";
import { paginationHtml, wirePagination } from "./excel-utils.js";

let hqPage = 1;
let hqPageSize = 10;

function isoToDMYHQ(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export async function renderCommandCenter(el) {
  hqPage = 1;
  hqPageSize = 10;
  if (!getIdentity()?.isPlatformAdmin) {
    el.innerHTML = `<div class="empty-state">Not found.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="page-header">
      <h1>AuditFlow Command Center</h1>
      <div class="page-actions">
        <button id="hq-onboard-btn" class="btn-dark">+ Onboard Company</button>
      </div>
    </div>
    <div class="import-card"><div id="hq-org-table">Loading...</div></div>
  `;

  document.getElementById("hq-onboard-btn").addEventListener("click", openOnboardModal);
  await loadAndRenderOrgs();
}

async function loadAndRenderOrgs() {
  const wrap = document.getElementById("hq-org-table");
  const { data, error } = await supabase.rpc("hq_list_organisations");

  if (error) {
    wrap.innerHTML = `<div class="empty-state">Could not load companies: ${error.message}</div>`;
    return;
  }

  if (!data?.length) {
    wrap.innerHTML = `<div class="empty-state">No companies yet.</div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(data.length / hqPageSize));
  hqPage = Math.min(Math.max(1, hqPage), totalPages);
  const pageItems = data.slice((hqPage - 1) * hqPageSize, hqPage * hqPageSize);

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Company</th><th>Status</th><th>Onboarded</th><th>Clients</th><th>Users</th><th>Last Active</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map((o) => `
          <tr>
            <td><strong>${o.name}</strong></td>
            <td><span class="status-badge status-completed">${o.status}</span></td>
            <td>${isoToDMYHQ(o.created_at)}</td>
            <td>${o.client_count}</td>
            <td>${o.user_count}</td>
            <td>${o.last_active ? isoToDMYHQ(o.last_active) : "Never"}</td>
            <td><button class="btn-link" data-enter-org="${o.id}" data-org-name="${o.name}">Enter as Company</button></td>
          </tr>`).join("")}
      </tbody>
    </table>
    ${paginationHtml("hq", hqPage, hqPageSize, data.length)}
  `;

  wirePagination("hq", {
    onPrev: () => { hqPage--; loadAndRenderOrgs(); },
    onNext: () => { hqPage++; loadAndRenderOrgs(); },
    onPageSizeChange: (size) => { hqPageSize = size; hqPage = 1; loadAndRenderOrgs(); },
  });

  wrap.querySelectorAll("[data-enter-org]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await startImpersonation(btn.dataset.enterOrg, btn.dataset.orgName);
      window.location.hash = "/dashboard";
      window.location.reload();
    });
  });
}

function openOnboardModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Onboard Company</h2>
          <p class="modal-subtitle">Creates the organisation and its first admin login in one step.</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <label>Company Name
        <input type="text" id="hq-org-name" placeholder="e.g. Teh Ng & Co" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-top:14px;">Admin Display Name
        <input type="text" id="hq-admin-name" placeholder="e.g. Teh Ng Admin" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-top:14px;">Admin Email
        <input type="text" id="hq-admin-email" placeholder="e.g. admin@tehng.auditflow.local" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </label>
      <label style="display:block;margin-top:14px;">Temporary Password
        <input type="text" id="hq-admin-password" value="${generateTempPassword()}" style="width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;" />
        <span class="hint">They'll be forced to change this on first login.</span>
      </label>
      <p id="hq-onboard-error" class="form-error hidden"></p>
      <div class="modal-actions" style="margin-top:16px;">
        <button type="button" id="hq-onboard-cancel" class="btn-secondary">Cancel</button>
        <button type="button" id="hq-onboard-save" class="btn-dark">Create Company</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#hq-onboard-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  backdrop.querySelector("#hq-onboard-save").addEventListener("click", async () => {
    const errorEl = backdrop.querySelector("#hq-onboard-error");
    const orgName = backdrop.querySelector("#hq-org-name").value.trim();
    const adminName = backdrop.querySelector("#hq-admin-name").value.trim();
    const adminEmail = backdrop.querySelector("#hq-admin-email").value.trim();
    const adminPassword = backdrop.querySelector("#hq-admin-password").value.trim();

    if (!orgName || !adminName || !adminEmail || !adminPassword) {
      errorEl.textContent = "Please fill in every field.";
      errorEl.classList.remove("hidden");
      return;
    }

    const { error } = await supabase.rpc("hq_onboard_organisation", {
      p_org_name: orgName,
      p_admin_email: adminEmail,
      p_admin_password: adminPassword,
      p_admin_display_name: adminName,
    });

    if (error) {
      errorEl.textContent = "Could not create company: " + error.message;
      errorEl.classList.remove("hidden");
      return;
    }

    close();
    showCredentialsSummary(orgName, adminEmail, adminPassword);
    await loadAndRenderOrgs();
  });
}

function showCredentialsSummary(orgName, email, password) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:420px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${orgName} is ready</h2>
          <p class="modal-subtitle">Share these with their admin — they'll be asked to change the password on first login.</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-grid">
        <div><label class="option-label">Login Email</label><div>${email}</div></div>
        <div><label class="option-label">Temporary Password</label><div>${password}</div></div>
      </div>
      <div class="modal-actions" style="margin-top:16px;">
        <button type="button" id="hq-cred-close" class="btn-dark">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#hq-cred-close").addEventListener("click", close);
}

function generateTempPassword() {
  const words = ["Falcon", "Harbor", "Meadow", "Comet", "Bridge", "Anchor", "Summit", "Ember"];
  const word = words[Math.floor(Math.random() * words.length)];
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${word}#${digits}!`;
}
