// assets/js/app.js
import { supabase } from "./supabase-client.js";
import { getSession, resolveIdentity, getIdentity, signIn, signOut, sendPasswordReset, updatePassword, endImpersonation } from "./auth.js";
import { visibleSidebarItems, canAccess } from "./permissions.js";
import { registerRoute, setGuard, setNotFoundHandler, startRouter, navigate, getCurrentPath } from "./router.js";

import { renderDashboard } from "./dashboard.js";
import { renderClients } from "./clients.js";
import { renderWorkOrders } from "./work-orders.js";
import { renderMonitoring } from "./monitoring.js";
import { renderTaxEstimateMonitoring } from "./taxEstimateMonitoring.js";
import { renderCommandCenter } from "./commandCenter.js";
import { renderReports } from "./reports.js";
import { renderAnnouncements, setHighlightAnnouncement } from "./announcements.js";
import { renderResources } from "./resources.js";
import { renderAiBot } from "./ai-bot.js";
import { renderUsers } from "./users.js";
import { renderSettings } from "./settings.js";
import { renderWorkspace } from "./workspace.js";
import { renderISQM } from "./isqm.js";

const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const appContent = document.getElementById("app-content");
const sidebarNav = document.getElementById("sidebar-nav");
const topbarUser = document.getElementById("topbar-user");

function showAuthScreen() {
  appShell.classList.add("hidden");
  authScreen.classList.remove("hidden");
}

function showAppShell() {
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function renderSidebar() {
  const items = visibleSidebarItems();
  sidebarNav.innerHTML = items
    .map(
      (item) => `
      <a href="#${item.route}" class="sidebar-link" data-route="${item.route}">
        <span class="sidebar-label">${item.label}</span>
      </a>`
    )
    .join("");

  sidebarNav.querySelectorAll(".sidebar-link").forEach((link) => {
    link.addEventListener("click", () => {
      sidebarNav.querySelectorAll(".sidebar-link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

function renderTopbarUser() {
  const identity = getIdentity();
  if (!identity) return;
  topbarUser.innerHTML = `
    <span class="topbar-name">${identity.profile.display_name || identity.user.email}</span>
    <span class="topbar-role">${identity.role === "firm_admin" ? "Firm Admin" : "Staff"}</span>
    <button id="sign-out-btn" class="btn-link">Sign Out</button>
  `;
  document.getElementById("sign-out-btn").addEventListener("click", async () => {
    await signOut();
    renderLoginForm();
    showAuthScreen();
  });
}

function renderLoginForm() {
  authScreen.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">AuditFlow</div>
      <form id="login-form">
        <label>Email
          <input type="email" id="login-email" required autocomplete="username" />
        </label>
        <label>Password
          <div class="password-row">
            <input type="password" id="login-password" required autocomplete="current-password" />
            <button type="button" id="toggle-password" class="btn-link">Show</button>
          </div>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="remember-session" checked />
          Remember session
        </label>
        <div id="login-error" class="form-error hidden"></div>
        <button type="submit" class="btn-primary">Sign In</button>
        <button type="button" id="forgot-password-link" class="btn-link">Forgot Password</button>
      </form>
    </div>
  `;

  const form = document.getElementById("login-form");
  const errorBox = document.getElementById("login-error");
  const pwInput = document.getElementById("login-password");

  document.getElementById("toggle-password").addEventListener("click", (e) => {
    pwInput.type = pwInput.type === "password" ? "text" : "password";
    e.target.textContent = pwInput.type === "password" ? "Show" : "Hide";
  });

  document.getElementById("forgot-password-link").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value;
    if (!email) {
      errorBox.textContent = "Enter your email above first, then click Forgot Password.";
      errorBox.classList.remove("hidden");
      return;
    }
    try {
      await sendPasswordReset(email);
      errorBox.classList.add("hidden");
      alert("If that email is registered, a password reset link has been sent.");
    } catch (err) {
      errorBox.textContent = "Could not send reset email. Please try again.";
      errorBox.classList.remove("hidden");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.classList.add("hidden");
    const email = document.getElementById("login-email").value;
    const password = pwInput.value;
    try {
      await signIn(email, password);
      await bootAfterLogin();
    } catch (err) {
      errorBox.textContent = err.message || "Invalid email or password";
      errorBox.classList.remove("hidden");
    }
  });
}

function renderForcedPasswordChange() {
  appContent.innerHTML = `
    <div class="auth-card">
      <h2>Set a new password</h2>
      <p>For security, you must set a new password before continuing.</p>
      <form id="change-password-form">
        <label>New password
          <input type="password" id="new-password" minlength="8" required />
        </label>
        <label>Confirm new password
          <input type="password" id="confirm-password" minlength="8" required />
        </label>
        <div id="change-password-error" class="form-error hidden"></div>
        <button type="submit" class="btn-primary">Update Password</button>
      </form>
      <p class="hint">At least 8 characters, one uppercase letter, one lowercase letter, and one number.</p>
    </div>
  `;

  document.getElementById("change-password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw1 = document.getElementById("new-password").value;
    const pw2 = document.getElementById("confirm-password").value;
    const errorBox = document.getElementById("change-password-error");

    const strongEnough = /[a-z]/.test(pw1) && /[A-Z]/.test(pw1) && /[0-9]/.test(pw1) && pw1.length >= 8;

    if (pw1 !== pw2) {
      errorBox.textContent = "Passwords do not match.";
      errorBox.classList.remove("hidden");
      return;
    }
    if (!strongEnough) {
      errorBox.textContent = "Password does not meet the requirements.";
      errorBox.classList.remove("hidden");
      return;
    }

    try {
      await updatePassword(pw1);
      navigate("/dashboard");
      await boot();
    } catch (err) {
      errorBox.textContent = "Could not update password. Please try again.";
      errorBox.classList.remove("hidden");
    }
  });
}

function registerRoutes() {
  registerRoute("/dashboard", renderDashboard);
  registerRoute("/clients", renderClients);
  registerRoute("/work-orders", renderWorkOrders);
  registerRoute("/monitoring", renderMonitoring);
  registerRoute("/tax-estimate", renderTaxEstimateMonitoring);
  registerRoute("/hq", renderCommandCenter);
  registerRoute("/reports", renderReports);
  registerRoute("/announcements", renderAnnouncements);
  registerRoute("/resources", renderResources);
  registerRoute("/ai-bot", renderAiBot);
  registerRoute("/users", renderUsers);
  registerRoute("/settings", renderSettings);
  registerRoute("/workspace", renderWorkspace);
  registerRoute("/isqm", renderISQM);

  setNotFoundHandler((el) => {
    el.innerHTML = `<div class="empty-state"><h2>Page not found</h2></div>`;
  });

  setGuard(async (path) => {
    const identity = getIdentity();
    if (!identity) {
      showAuthScreen();
      return false;
    }
    if (identity.mustChangePassword) {
      showAppShell();
      renderForcedPasswordChange();
      return false;
    }
    if (path === "/hq") {
      if (!identity.isPlatformAdmin) {
        appContent.innerHTML = `<div class="empty-state"><h2>Page not found</h2></div>`;
        return false;
      }
      return true;
    }
    if (!canAccess(path)) {
      appContent.innerHTML = `<div class="empty-state"><h2>Unauthorised</h2><p>You don't have access to this page.</p></div>`;
      return false;
    }
    return true;
  });
}

function renderImpersonationBanner() {
  const impersonating = getIdentity()?.impersonating;
  const banner = document.getElementById("impersonation-banner");
  if (!impersonating) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return;
  }
  banner.classList.remove("hidden");
  banner.innerHTML = `
    <div style="background:#1e1b4b;color:#fff;font-size:13px;padding:8px 16px;display:flex;justify-content:center;align-items:center;gap:12px;">
      <span>Viewing as: <strong>${impersonating.organisationName}</strong></span>
      <button id="exit-impersonation-btn" style="background:#fff;color:#1e1b4b;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;">Exit</button>
    </div>
  `;
  document.getElementById("exit-impersonation-btn").addEventListener("click", async () => {
    await endImpersonation();
    window.location.hash = "/hq";
    window.location.reload();
  });
}

let bannerRotationTimer = null;

async function renderAnnouncementBanner() {
  const orgId = getIdentity()?.organisationId;
  const banner = document.getElementById("announcement-banner");
  if (bannerRotationTimer) { clearInterval(bannerRotationTimer); bannerRotationTimer = null; }
  if (!orgId) return;

  const { data: settings } = await supabase.from("organisation_settings").select("announcement_text, banner_mode").eq("organisation_id", orgId).maybeSingle();

  if (settings?.banner_mode === "ticker") {
    const { data: items } = await supabase
      .from("firm_announcements")
      .select("id, title, body")
      .eq("organisation_id", orgId)
      .eq("is_flash_enabled", true)
      .order("announcement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (!items?.length) {
      banner.classList.add("hidden");
      return;
    }

    let idx = 0;
    const paint = () => {
      const item = items[idx];
      const text = item.title + (item.body ? " — " + item.body.split("\n")[0] : "");
      banner.innerHTML = `<span class="announcement-ticker-text">${text}</span>`;
      banner.dataset.annId = item.id;
    };
    paint();
    banner.classList.remove("hidden");
    banner.style.cursor = "pointer";
    banner.onclick = () => {
      setHighlightAnnouncement(banner.dataset.annId);
      navigate("/announcements");
    };
    bannerRotationTimer = setInterval(() => {
      idx = (idx + 1) % items.length;
      paint();
    }, 10000);
    return;
  }

  banner.onclick = null;
  banner.style.cursor = "";
  if (settings?.announcement_text) {
    banner.textContent = settings.announcement_text;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

async function bootAfterLogin() {
  await resolveIdentity();
  const identity = getIdentity();
  showAppShell();
  renderSidebar();
  renderTopbarUser();
  renderImpersonationBanner();
  await renderAnnouncementBanner();

  if (identity?.mustChangePassword) {
    renderForcedPasswordChange();
    return;
  }
  // Respect whatever path was already in the URL (e.g. someone opened a
  // direct link, or typed a hash like #/hq, before logging in) rather than
  // always bouncing to the dashboard.
  const requestedPath = getCurrentPath();
  const fallback = identity?.isPlatformAdmin && !identity?.impersonating && !identity?.organisationId ? "/hq" : "/dashboard";
  navigate(requestedPath && requestedPath !== "/" ? requestedPath : fallback);
  startRouter();
}

async function boot() {
  registerRoutes();

  const session = await getSession();
  if (!session) {
    renderLoginForm();
    showAuthScreen();
    return;
  }

  try {
    await resolveIdentity();
  } catch (err) {
    console.error("Failed to resolve identity", err);
    renderLoginForm();
    showAuthScreen();
    return;
  }

  showAppShell();
  renderSidebar();
  renderTopbarUser();
  renderImpersonationBanner();
  await renderAnnouncementBanner();

  const identity = getIdentity();
  if (identity?.isPlatformAdmin && !identity?.impersonating && !identity?.organisationId && (getCurrentPath() === "/" || getCurrentPath() === "/dashboard")) {
    navigate("/hq");
  }
  startRouter();
}

// Clicking the app name/logo returns to dashboard.
document.getElementById("app-logo").addEventListener("click", () => navigate("/dashboard"));

// Mobile sidebar toggle
const sidebarEl = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
function closeSidebar() {
  sidebarEl.classList.remove("sidebar-open");
  sidebarBackdrop.classList.add("hidden");
}
document.getElementById("hamburger-btn").addEventListener("click", () => {
  sidebarEl.classList.toggle("sidebar-open");
  sidebarBackdrop.classList.toggle("hidden");
});
sidebarBackdrop.addEventListener("click", closeSidebar);
sidebarNav.addEventListener("click", (e) => {
  if (e.target.closest(".sidebar-link")) closeSidebar();
});

boot();
