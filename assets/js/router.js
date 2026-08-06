// assets/js/router.js
// Minimal hash router. Routes are registered as { path: renderFn }.
// renderFn receives the #app-content element and should render into it.

const routes = new Map();
let notFoundHandler = null;
let unauthorizedHandler = null;
let guard = null; // async (path) => true | false

export function registerRoute(path, renderFn) {
  routes.set(path, renderFn);
}

export function setNotFoundHandler(fn) {
  notFoundHandler = fn;
}

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

/**
 * A guard function that runs before every route render. Return false to
 * block rendering (e.g. not signed in, or not permitted for this role) —
 * the guard itself is responsible for redirecting/showing the right screen.
 */
export function setGuard(fn) {
  guard = fn;
}

function currentPath() {
  const hash = window.location.hash || "#/dashboard";
  return hash.replace(/^#/, "") || "/dashboard";
}

export function navigate(path) {
  if (window.location.hash !== `#${path}`) {
    window.location.hash = path;
  } else {
    render();
  }
}

async function render() {
  const path = currentPath();
  const appContent = document.getElementById("app-content");
  if (!appContent) return;

  if (guard) {
    const allowed = await guard(path);
    if (!allowed) return; // guard handles its own redirect/rendering
  }

  const renderFn = routes.get(path);
  if (!renderFn) {
    if (notFoundHandler) notFoundHandler(appContent);
    return;
  }

  await renderFn(appContent);
}

export function startRouter() {
  window.addEventListener("hashchange", render);
  render();
}

export function getCurrentPath() {
  return currentPath();
}
