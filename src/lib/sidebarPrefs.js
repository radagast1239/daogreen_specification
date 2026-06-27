const KEY = "dg-sidebar-collapsed";

export function getSidebarCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}
