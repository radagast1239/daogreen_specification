/**
 * Project workspace view query helpers (Phase A).
 * view=design | spec | publish — absent/empty/unknown → spec.
 */

export const PROJECT_WORKSPACE_VIEWS = Object.freeze(["design", "spec", "publish"]);

export const PROJECT_WORKSPACE_VIEW_LABELS = Object.freeze({
  design: "Проектирование",
  spec: "Спецификация",
  publish: "Клиентская выдача",
});

export const DEFAULT_PROJECT_WORKSPACE_VIEW = "spec";

/**
 * @param {unknown} raw
 * @returns {"design"|"spec"|"publish"}
 */
export function normalizeProjectWorkspaceView(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return DEFAULT_PROJECT_WORKSPACE_VIEW;
  if (PROJECT_WORKSPACE_VIEWS.includes(v)) return v;
  return DEFAULT_PROJECT_WORKSPACE_VIEW;
}

/**
 * Read view from URLSearchParams or a plain object / string.
 * @param {URLSearchParams | Record<string,string> | string | null | undefined} source
 */
export function parseProjectWorkspaceView(source) {
  if (source == null || source === "") return DEFAULT_PROJECT_WORKSPACE_VIEW;
  if (typeof source === "string") {
    if (source.includes("=") || source.includes("?")) {
      const q = source.startsWith("?") ? source.slice(1) : source;
      return normalizeProjectWorkspaceView(new URLSearchParams(q).get("view"));
    }
    return normalizeProjectWorkspaceView(source);
  }
  if (typeof source.get === "function") {
    return normalizeProjectWorkspaceView(source.get("view"));
  }
  return normalizeProjectWorkspaceView(source.view);
}

/**
 * Build next search string, preserving all other params.
 * @param {URLSearchParams | string | Record<string,string>} current
 * @param {"design"|"spec"|"publish"|string} nextView
 * @returns {string} search without leading `?` (may be empty)
 */
export function buildProjectWorkspaceSearch(current, nextView) {
  let params;
  if (typeof current === "string") {
    const q = current.startsWith("?") ? current.slice(1) : current;
    params = new URLSearchParams(q);
  } else if (current && typeof current.get === "function") {
    params = new URLSearchParams(current.toString());
  } else {
    params = new URLSearchParams();
    if (current && typeof current === "object") {
      for (const [k, v] of Object.entries(current)) {
        if (v != null && v !== "") params.set(k, String(v));
      }
    }
  }
  const view = normalizeProjectWorkspaceView(nextView);
  params.set("view", view);
  return params.toString();
}

export function isProjectWorkspaceView(value) {
  return PROJECT_WORKSPACE_VIEWS.includes(String(value ?? "").trim().toLowerCase());
}
