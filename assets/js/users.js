// assets/js/users.js
import { supabase } from "./supabase-client.js";
import { getIdentity } from "./auth.js";
import { paginationHtml, wirePagination } from "./excel-utils.js";

let userPage = 1;
let userPageSize = 10;

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const DELETE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
const KEY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>`;

const inputStyle = "width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;";
const labelStyle = "display:block;margin-bottom:14px;";
const ROLE_LABELS = { firm_admin: "Firm Admin", manager: "Manager", staff: "Staff" };

// supabase-js's functions.invoke() gives a generic "non-2xx status code"
// message on failure by default — the actual error text our function sent
// back is on error.context (the raw Response), and has to be read separately.
async function extractFunctionError(error, fallbackData) {
  if (fallbackData?.error) return fallbackData.error;
  if (error?.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // context wasn't JSON — fall through to the generic message
    }
  }
  return error?.message || "Unknown error";
}

async function fetchBranchesAndTeams(orgId) {
  const [{ data: branches }, { data: teams }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("organisation_id", orgId).order("name"),
    supabase.from("teams").select("id, name, branch_id").eq("organisation_id", orgId).order("name"),
  ]);
  return { branches: branches || [], teams: teams || [] };
}

function renderAccessChecklist(branches, teams, checkedBranchIds, checkedTeamIds) {
  if (!branches.length) {
    return `<p class="hint">No branches set up yet — add some in Firm Settings first.</p>`;
  }
  return branches
    .map((b) => {
      const branchTeams = teams.filter((t) => t.branch_id === b.id);
      return `
        <div style="margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;">
            <input type="checkbox" class="access-branch-cb" data-branch="${b.id}" style="width:auto;" ${checkedBranchIds.includes(b.id) ? "checked" : ""} />
            ${b.name} <span class="hint" style="font-weight:400;">(all teams)</span>
          </label>
          ${branchTeams.length ? `
            <div style="margin-left:26px;margin-top:4px;display:flex;flex-direction:column;gap:4px;">
              ${branchTeams.map((t) => `
                <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;">
                  <input type="checkbox" class="access-team-cb" data-team="${t.id}" data-branch="${b.id}" style="width:auto;" ${checkedTeamIds.includes(t.id) ? "checked" : ""} />
                  ${t.name}
                </label>`).join("")}
            </div>` : ""}
        </div>`;
    })
    .join("");
}

// Ticking a branch checkbox auto-ticks (and visually implies) all its teams;
// unticking a branch leaves individual team ticks as they were.
function wireAccessChecklist(container) {
  container.querySelectorAll(".access-branch-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) {
        container.querySelectorAll(`.access-team-cb[data-branch="${cb.dataset.branch}"]`).forEach((t) => { t.checked = true; });
      }
    });
  });
}

function readAccessChecklist(container) {
  const branchIds = [...container.querySelectorAll(".access-branch-cb:checked")].map((cb) => cb.dataset.branch);
  const teamIds = [...container.querySelectorAll(".access-team-cb:checked")].map((cb) => cb.dataset.team);
  return { branchIds, teamIds };
}

async function saveAccessGrants(userId, branchIds, teamIds) {
  await Promise.all([
    supabase.from("user_branch_access").delete().eq("user_id", userId),
    supabase.from("user_team_access").delete().eq("user_id", userId),
  ]);
  const inserts = [];
  if (branchIds.length) inserts.push(supabase.from("user_branch_access").insert(branchIds.map((branch_id) => ({ user_id: userId, branch_id }))));
  if (teamIds.length) inserts.push(supabase.from("user_team_access").insert(teamIds.map((team_id) => ({ user_id: userId, team_id }))));
  if (inserts.length) await Promise.all(inserts);
}

export async function renderUsers(el) {
  userPage = 1;
  userPageSize = 10;
  el.innerHTML = `
    <div class="page-header">
      <h1>User Management</h1>
      <div class="page-actions">
        <button id="add-user-btn" class="btn-dark">+ Add User</button>
      </div>
    </div>
    <div id="users-table-wrap" class="import-card">Loading...</div>
  `;

  document.getElementById("add-user-btn").addEventListener("click", () => openAddUserModal());

  await loadAndRenderUsers();
}

async function loadAndRenderUsers() {
  const orgId = getIdentity()?.organisationId;
  const wrap = document.getElementById("users-table-wrap");

  const [{ data, error }, { data: teams }] = await Promise.all([
    supabase
      .from("organisation_members")
      .select("user_id, role, status, is_working_staff, team_id, is_partner, is_engagement_manager, profiles(display_name, email, designation)")
      .eq("organisation_id", orgId)
      .order("role"),
    supabase.from("teams").select("id, name, branches(name)").eq("organisation_id", orgId),
  ]);

  if (error) {
    wrap.innerHTML = `<div class="empty-state">Could not load users.</div>`;
    return;
  }
  if (!data.length) {
    wrap.innerHTML = `<div class="empty-state">No users yet.</div>`;
    return;
  }

  const teamsById = Object.fromEntries((teams || []).map((t) => [t.id, t.branches?.name ? `${t.name} (${t.branches.name})` : t.name]));
  const selfId = getIdentity()?.user?.id;

  const totalPages = Math.max(1, Math.ceil(data.length / userPageSize));
  userPage = Math.min(Math.max(1, userPage), totalPages);
  const pageItems = data.slice((userPage - 1) * userPageSize, userPage * userPageSize);

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Name</th><th>Email</th><th>Designation</th><th>Role</th><th>Home Team</th><th>Working Staff</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems
          .map((m) => {
            const isSelf = m.user_id === selfId;
            const roleBadgeClass = m.role === "firm_admin" ? "status-completed" : m.role === "manager" ? "status-quotation" : "status-wip";
            return `<tr>
              <td><strong>${m.profiles?.display_name || "-"}</strong>${isSelf ? ' <span class="hint">(you)</span>' : ""}</td>
              <td>${m.profiles?.email || "-"}</td>
              <td>${m.profiles?.designation || "-"}</td>
              <td><span class="status-badge ${roleBadgeClass}">${ROLE_LABELS[m.role] || m.role}</span></td>
              <td>${teamsById[m.team_id] || "-"}</td>
              <td>${m.is_working_staff ? `<span class="status-badge status-completed">Yes</span>` : `<span class="status-badge status-wip">No</span>`}</td>
              <td><span class="status-badge ${m.status === "active" ? "status-completed" : "status-rejected"}">${m.status === "active" ? "Active" : "Inactive"}</span></td>
              <td class="row-actions">
                <button class="icon-btn icon-btn-edit" data-edit="${m.user_id}" title="Edit">${EDIT_ICON}</button>
                <button class="icon-btn icon-btn-edit" data-reset="${m.user_id}" title="Reset Password">${KEY_ICON}</button>
                ${isSelf ? "" : `<button class="icon-btn icon-btn-delete" data-delete="${m.user_id}" data-name="${m.profiles?.display_name || m.profiles?.email}" title="Delete">${DELETE_ICON}</button>`}
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    ${paginationHtml("user", userPage, userPageSize, data.length)}
  `;

  const byId = Object.fromEntries(data.map((m) => [m.user_id, m]));

  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditUserModal(byId[btn.dataset.edit]));
  });
  wrap.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => openResetPasswordModal(byId[btn.dataset.reset]));
  });
  wrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => confirmDeleteUser(btn.dataset.delete, btn.dataset.name));
  });
  wirePagination("user", {
    onPrev: () => { userPage--; loadAndRenderUsers(); },
    onNext: () => { userPage++; loadAndRenderUsers(); },
    onPageSizeChange: (size) => { userPageSize = size; userPage = 1; loadAndRenderUsers(); },
  });
}

function buildModal({ title, subtitle, bodyHtml, submitLabel }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-width:480px;">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">${title}</h2>
          <p class="modal-subtitle">${subtitle}</p>
        </div>
        <button type="button" id="modal-close-btn" class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form id="modal-form">
        ${bodyHtml}
        <p id="modal-error" class="form-error hidden"></p>
        <div class="modal-actions">
          <button type="button" id="modal-cancel-btn" class="btn-secondary">Cancel</button>
          <button type="submit" class="btn-dark">${submitLabel}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#modal-close-btn").addEventListener("click", close);
  backdrop.querySelector("#modal-cancel-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  return { backdrop, close };
}

async function openAddUserModal() {
  const orgId = getIdentity()?.organisationId;
  const { branches, teams } = await fetchBranchesAndTeams(orgId);

  const { close } = buildModal({
    title: "Add User",
    subtitle: "Set an initial password — they'll be asked to change it on first login.",
    submitLabel: "Add User",
    bodyHtml: `
      <label style="${labelStyle}">Name
        <input type="text" id="au-name" required style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Email
        <input type="email" id="au-email" required style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Designation
        <input type="text" id="au-designation" placeholder="e.g. Audit Senior" style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Role
        <select id="au-role" style="${inputStyle}">
          <option value="staff">Staff</option>
          <option value="manager">Manager</option>
          <option value="firm_admin">Firm Admin</option>
        </select>
      </label>
      <label style="${labelStyle}">Branch
        <select id="au-branch" style="${inputStyle}">
          <option value="">Select a branch...</option>
          ${branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}
        </select>
      </label>
      <label style="${labelStyle}">Home Team
        <select id="au-team" style="${inputStyle}">
          <option value="">Select a branch first...</option>
        </select>
      </label>
      <label style="${labelStyle}">Password
        <input type="text" id="au-password" required minlength="8" placeholder="At least 8 characters" style="${inputStyle}" />
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:4px;">
        <input type="checkbox" id="au-working-staff" checked style="width:auto;" /> Working Staff
      </label>
      <p class="hint" style="margin-top:0;margin-bottom:16px;">Uncheck this for admin-only accounts that don't do client work — they'll be left out of staff reports (Work Orders by Staff, Budget Fee by Staff, ISQM staff list, etc).</p>
      <label class="option-label">Work Order Roles</label>
      <p class="hint" style="margin-top:0;">Controls who shows up in the Partner/Manager pickers when creating a work order — separate from this person's system access role above.</p>
      <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin-bottom:6px;">
        <input type="checkbox" id="au-is-partner" style="width:auto;" /> Can be assigned as Partner
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin-bottom:16px;">
        <input type="checkbox" id="au-is-manager" style="width:auto;" /> Can be assigned as Manager
      </label>
      <label class="option-label">Client Data Access</label>
      <p class="hint" style="margin-top:0;">Which branches/teams' clients and work orders this person can see. Ticking a branch covers every team under it.</p>
      <div id="au-access-checklist">${renderAccessChecklist(branches, teams, [], [])}</div>
    `,
  });

  wireAccessChecklist(document.getElementById("au-access-checklist"));

  const auBranchSelect = document.getElementById("au-branch");
  const auTeamSelect = document.getElementById("au-team");
  function refreshAuTeamOptions() {
    const branchId = auBranchSelect.value;
    if (!branchId) {
      auTeamSelect.innerHTML = `<option value="">Select a branch first...</option>`;
      auTeamSelect.disabled = true;
      return;
    }
    const teamsInBranch = teams.filter((t) => t.branch_id === branchId);
    auTeamSelect.disabled = false;
    auTeamSelect.innerHTML = `<option value="">None</option>${teamsInBranch.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}`;
  }
  auBranchSelect.addEventListener("change", refreshAuTeamOptions);
  refreshAuTeamOptions();

  document.getElementById("modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("modal-error");
    const submitBtn = e.target.querySelector("button[type=submit]");

    const payload = {
      email: document.getElementById("au-email").value.trim(),
      display_name: document.getElementById("au-name").value.trim(),
      designation: document.getElementById("au-designation").value.trim(),
      role: document.getElementById("au-role").value,
      password: document.getElementById("au-password").value,
      organisation_id: orgId,
      is_working_staff: document.getElementById("au-working-staff").checked,
      team_id: document.getElementById("au-team").value || null,
      is_partner: document.getElementById("au-is-partner").checked,
      is_engagement_manager: document.getElementById("au-is-manager").checked,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Adding...";

    const { data, error } = await supabase.functions.invoke("create-user", { body: payload });

    if (error || data?.error) {
      errorEl.textContent = "Could not add user: " + (await extractFunctionError(error, data));
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Add User";
      return;
    }

    const { branchIds, teamIds } = readAccessChecklist(document.getElementById("au-access-checklist"));
    const homeTeamId = document.getElementById("au-team").value || null;
    const finalTeamIds = homeTeamId && !teamIds.includes(homeTeamId) ? [...teamIds, homeTeamId] : teamIds;
    await saveAccessGrants(data.user_id, branchIds, finalTeamIds);

    close();
    await loadAndRenderUsers();
  });
}

async function openEditUserModal(member) {
  const orgId = getIdentity()?.organisationId;
  const [{ branches, teams }, { data: branchGrants }, { data: teamGrants }] = await Promise.all([
    fetchBranchesAndTeams(orgId),
    supabase.from("user_branch_access").select("branch_id").eq("user_id", member.user_id),
    supabase.from("user_team_access").select("team_id").eq("user_id", member.user_id),
  ]);
  const checkedBranchIds = (branchGrants || []).map((r) => r.branch_id);
  const checkedTeamIds = (teamGrants || []).map((r) => r.team_id);

  const { close } = buildModal({
    title: "Edit User",
    subtitle: `Update ${member.profiles?.display_name || member.profiles?.email}'s details.`,
    submitLabel: "Save Changes",
    bodyHtml: `
      <label style="${labelStyle}">Name
        <input type="text" id="eu-name" required value="${member.profiles?.display_name ?? ""}" style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Designation
        <input type="text" id="eu-designation" value="${member.profiles?.designation ?? ""}" style="${inputStyle}" />
      </label>
      <label style="${labelStyle}">Role
        <select id="eu-role" style="${inputStyle}">
          <option value="staff" ${member.role === "staff" ? "selected" : ""}>Staff</option>
          <option value="manager" ${member.role === "manager" ? "selected" : ""}>Manager</option>
          <option value="firm_admin" ${member.role === "firm_admin" ? "selected" : ""}>Firm Admin</option>
        </select>
      </label>
      <label style="${labelStyle}">Branch
        <select id="eu-branch" style="${inputStyle}">
          <option value="">Select a branch...</option>
          ${branches.map((b) => `<option value="${b.id}" ${teams.find((t) => t.id === member.team_id)?.branch_id === b.id ? "selected" : ""}>${b.name}</option>`).join("")}
        </select>
      </label>
      <label style="${labelStyle}">Home Team
        <select id="eu-team" style="${inputStyle}">
          <option value="">Select a branch first...</option>
        </select>
      </label>
      <label style="${labelStyle}">Status
        <select id="eu-status" style="${inputStyle}">
          <option value="active" ${member.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${member.status === "inactive" ? "selected" : ""}>Inactive</option>
        </select>
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:4px;">
        <input type="checkbox" id="eu-working-staff" ${member.is_working_staff ? "checked" : ""} style="width:auto;" /> Working Staff
      </label>
      <p class="hint" style="margin-top:0;margin-bottom:16px;">Uncheck this for admin-only accounts that don't do client work — they'll be left out of staff reports (Work Orders by Staff, Budget Fee by Staff, ISQM staff list, etc).</p>
      <label class="option-label">Work Order Roles</label>
      <p class="hint" style="margin-top:0;">Controls who shows up in the Partner/Manager pickers when creating a work order — separate from this person's system access role above.</p>
      <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin-bottom:6px;">
        <input type="checkbox" id="eu-is-partner" ${member.is_partner ? "checked" : ""} style="width:auto;" /> Can be assigned as Partner
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-weight:400;font-size:13px;margin-bottom:16px;">
        <input type="checkbox" id="eu-is-manager" ${member.is_engagement_manager ? "checked" : ""} style="width:auto;" /> Can be assigned as Manager
      </label>
      <label class="option-label">Client Data Access</label>
      <p class="hint" style="margin-top:0;">Which branches/teams' clients and work orders this person can see. Ticking a branch covers every team under it.</p>
      <div id="eu-access-checklist">${renderAccessChecklist(branches, teams, checkedBranchIds, checkedTeamIds)}</div>
    `,
  });

  wireAccessChecklist(document.getElementById("eu-access-checklist"));

  const euBranchSelect = document.getElementById("eu-branch");
  const euTeamSelect = document.getElementById("eu-team");
  function refreshEuTeamOptions() {
    const branchId = euBranchSelect.value;
    if (!branchId) {
      euTeamSelect.innerHTML = `<option value="">Select a branch first...</option>`;
      euTeamSelect.disabled = true;
      return;
    }
    const teamsInBranch = teams.filter((t) => t.branch_id === branchId);
    euTeamSelect.disabled = false;
    euTeamSelect.innerHTML = `<option value="">None</option>${teamsInBranch.map((t) => `<option value="${t.id}" ${member.team_id === t.id ? "selected" : ""}>${t.name}</option>`).join("")}`;
  }
  euBranchSelect.addEventListener("change", refreshEuTeamOptions);
  refreshEuTeamOptions();

  document.getElementById("modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("modal-error");

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        display_name: document.getElementById("eu-name").value.trim(),
        designation: document.getElementById("eu-designation").value.trim() || null,
      })
      .eq("id", member.user_id);

    const { error: memberError } = await supabase
      .from("organisation_members")
      .update({
        role: document.getElementById("eu-role").value,
        status: document.getElementById("eu-status").value,
        is_working_staff: document.getElementById("eu-working-staff").checked,
        team_id: document.getElementById("eu-team").value || null,
        is_partner: document.getElementById("eu-is-partner").checked,
        is_engagement_manager: document.getElementById("eu-is-manager").checked,
      })
      .eq("user_id", member.user_id)
      .eq("organisation_id", orgId);

    if (profileError || memberError) {
      errorEl.textContent = "Could not save: " + (profileError?.message || memberError?.message);
      errorEl.classList.remove("hidden");
      return;
    }

    const { branchIds, teamIds } = readAccessChecklist(document.getElementById("eu-access-checklist"));
    const homeTeamId = document.getElementById("eu-team").value || null;
    const finalTeamIds = homeTeamId && !teamIds.includes(homeTeamId) ? [...teamIds, homeTeamId] : teamIds;
    await saveAccessGrants(member.user_id, branchIds, finalTeamIds);

    close();
    await loadAndRenderUsers();
  });
}

function openResetPasswordModal(member) {
  const { close } = buildModal({
    title: "Reset Password",
    subtitle: `Set a new temporary password for ${member.profiles?.display_name || member.profiles?.email}. They'll be asked to change it on next login.`,
    submitLabel: "Reset Password",
    bodyHtml: `
      <label style="${labelStyle}">New Password
        <input type="text" id="rp-password" required minlength="8" placeholder="At least 8 characters" style="${inputStyle}" />
      </label>
    `,
  });

  document.getElementById("modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const orgId = getIdentity()?.organisationId;
    const errorEl = document.getElementById("modal-error");
    const submitBtn = e.target.querySelector("button[type=submit]");

    submitBtn.disabled = true;
    submitBtn.textContent = "Resetting...";

    const { data, error } = await supabase.functions.invoke("reset-user-password", {
      body: { organisation_id: orgId, user_id: member.user_id, new_password: document.getElementById("rp-password").value },
    });

    if (error || data?.error) {
      errorEl.textContent = "Could not reset password: " + (await extractFunctionError(error, data));
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Reset Password";
      return;
    }

    close();
  });
}

async function confirmDeleteUser(userId, name) {
  if (!confirm(`Delete ${name}? This permanently removes their account and cannot be undone.`)) return;

  const orgId = getIdentity()?.organisationId;
  const { data, error } = await supabase.functions.invoke("delete-user", {
    body: { organisation_id: orgId, user_id: userId },
  });

  if (error || data?.error) {
    alert("Could not delete user: " + (await extractFunctionError(error, data)));
    return;
  }

  await loadAndRenderUsers();
}
