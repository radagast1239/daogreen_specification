/** Frontend-only helpers for /modules?tab=… URL sync. */

const KNOWN_TABS = new Set([
  "stellage",
  "stellage_composition",
  "farm",
  "directories",
  "brand",
  "publish",
  "catalog",
]);

export function resolveModulesTabFromSearch(search, fallback = "farm", allowed = KNOWN_TABS) {
  try {
    const raw = String(search || "");
    const q = raw.startsWith("?") ? raw.slice(1) : raw;
    const t = new URLSearchParams(q).get("tab");
    if (t && allowed.has(t)) return t;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function modulesTabToSearchParams(tabId, prev) {
  const next = new URLSearchParams(prev || "");
  next.set("tab", tabId);
  return next;
}

/** React Router path for a Modules tab (basename applied by BrowserRouter). */
export function modulesTabPath(tabId, allowed = KNOWN_TABS) {
  const tab = allowed.has(tabId) ? tabId : "farm";
  return `/modules?tab=${tab}`;
}
