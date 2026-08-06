// assets/js/permissions.js
import { getIdentity } from "./auth.js";

// Route -> roles allowed. Manager has the same access as Admin everywhere
// except User Management, which stays Admin-only.
export const ROUTE_ACCESS = {
  "/dashboard": ["firm_admin", "manager", "staff"],
  "/clients": ["firm_admin", "manager", "staff"],
  "/work-orders": ["firm_admin", "manager", "staff"],
  "/monitoring": ["firm_admin", "manager", "staff"],
  "/tax-estimate": ["firm_admin", "manager", "staff"],
  "/reports": ["firm_admin", "manager"],
  "/announcements": ["firm_admin", "manager", "staff"],
  "/resources": ["firm_admin", "manager", "staff"],
  "/ai-bot": ["firm_admin", "manager", "staff"],
  "/users": ["firm_admin"],
  "/settings": ["firm_admin"],
  "/workspace": ["firm_admin", "manager", "staff"],
  "/isqm": ["firm_admin", "manager", "staff"],
  "/change-password": ["firm_admin", "manager", "staff"],
  "/account-security": ["firm_admin", "manager", "staff"],
};

export function canAccess(route) {
  const identity = getIdentity();
  if (!identity || !identity.role) return false;
  if (route === "/clients" && identity.role === "staff" && !identity.staffClientListAccess) return false;
  const allowed = ROUTE_ACCESS[route];
  if (!allowed) return false;
  return allowed.includes(identity.role);
}

export function isFirmAdmin() {
  return getIdentity()?.role === "firm_admin";
}

// Manager has admin-equivalent rights everywhere except User Management —
// use this (not isFirmAdmin) for gating actions like edit/delete/approve
// buttons throughout the app. isFirmAdmin stays reserved for the handful
// of places that must remain Admin-only (User Management itself).
export function isManagerOrAdmin() {
  const role = getIdentity()?.role;
  return role === "firm_admin" || role === "manager";
}

export const SIDEBAR_ITEMS = [
  { route: "/dashboard", label: "Dashboard", icon: "layout-dashboard", roles: ["firm_admin", "manager", "staff"] },
  { route: "/clients", label: "Client List", icon: "users", roles: ["firm_admin", "manager", "staff"] },
  { route: "/work-orders", label: "Work Orders", icon: "clipboard-list", roles: ["firm_admin", "manager", "staff"] },
  { route: "/monitoring", label: "Audit & Tax Monitoring", icon: "calendar-clock", roles: ["firm_admin", "manager", "staff"] },
  { route: "/tax-estimate", label: "Tax Estimate Monitoring", icon: "calculator", roles: ["firm_admin", "manager", "staff"] },
  { route: "/reports", label: "Generate Report", icon: "file-bar-chart", roles: ["firm_admin", "manager"] },
  { route: "/resources", label: "Resources", icon: "folder", roles: ["firm_admin", "manager", "staff"] },
  { route: "/ai-bot", label: "AI Bot", icon: "bot", roles: ["firm_admin", "manager", "staff"] },
  { route: "/isqm", label: "ISQM", icon: "shield-check", roles: ["firm_admin", "manager", "staff"] },
  { route: "/users", label: "User Management", icon: "user-cog", roles: ["firm_admin"] },
  { route: "/announcements", label: "Firm Announcements", icon: "megaphone", roles: ["firm_admin", "manager", "staff"] },
  { route: "/settings", label: "Firm Settings", icon: "settings", roles: ["firm_admin"] },
  { route: "/workspace", label: "Virtual Workspace", icon: "building-2", roles: ["firm_admin", "manager", "staff"] },
];

export function visibleSidebarItems() {
  const identity = getIdentity();
  if (!identity || !identity.role) return [];
  return SIDEBAR_ITEMS.filter((item) => {
    if (!item.roles.includes(identity.role)) return false;
    if (item.route === "/clients" && identity.role === "staff" && !identity.staffClientListAccess) return false;
    return true;
  });
}
