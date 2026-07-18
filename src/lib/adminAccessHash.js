/**
 * Magic-link access token lives only in the URL fragment (#access=...).
 * Fragments are never sent to the server in the HTTP request URL.
 */

export function parseAccessTokenFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return "";
  // Prefer URLSearchParams so #access=...&x=1 works; also plain access=...
  const params = new URLSearchParams(raw.includes("=") ? raw : "");
  const fromParams = params.get("access");
  if (fromParams != null && fromParams !== "") return fromParams;
  return "";
}

/** Query ?access= must never be treated as a magic token. */
export function parseAccessTokenFromSearch(_search) {
  return "";
}

export function takeAccessTokenFromLocation(locationLike = typeof window !== "undefined" ? window.location : null) {
  if (!locationLike) return "";
  return parseAccessTokenFromHash(locationLike.hash || "");
}

export function clearAccessHashFromUrl(historyLike = typeof window !== "undefined" ? window.history : null, locationLike = typeof window !== "undefined" ? window.location : null) {
  if (!historyLike || !locationLike || typeof historyLike.replaceState !== "function") return;
  const next = `${locationLike.pathname || ""}${locationLike.search || ""}`;
  historyLike.replaceState(historyLike.state, "", next);
}
