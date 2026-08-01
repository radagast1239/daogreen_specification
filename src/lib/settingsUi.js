/** Frontend helpers for Settings page (Phase 1E / 1E.2). */

export const SETTINGS_TABS = [
  { id: "overview", label: "Обзор" },
  { id: "links", label: "Ссылки" },
  { id: "security", label: "Безопасность" },
  { id: "system", label: "Система" },
];

/** Stable id of the env ADMIN_KEY row seeded by backend auth.js. */
export const PRIMARY_ADMIN_USER_ID = "env-primary";

/**
 * Detect primary/env server access entry from listAdminUsers payload.
 * Uses stable id from backend seed — not the display name alone.
 */
export function isPrimaryAdminUser(user) {
  if (!user || typeof user !== "object") return false;
  return String(user.id || "") === PRIMARY_ADMIN_USER_ID;
}

/** Extra keys only — excludes primary/env server access. */
export function filterExtraAdminUsers(users) {
  return (users || []).filter((u) => !isPrimaryAdminUser(u));
}

/** Safe fingerprint: last 4 chars only, never the full secret. */
export function adminKeyFingerprint(apiKey) {
  const key = String(apiKey || "");
  if (key.length < 4) return null;
  return key.slice(-4);
}

export function formatAdminKeyCreatedAt(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function previewNames(list, limit = 4) {
  const names = (list || []).map((x) => (typeof x === "string" ? x : x?.name || x?.label || "")).filter(Boolean);
  return names.slice(0, limit);
}

/**
 * Explicit PATCH payload for SettingsPage «Ссылки» tab.
 *
 * The links tab owns a single control (`clientLinkTtlDays`). Never spread the
 * full GET /settings object — it carries legacy read-only and other-tab keys.
 */
export const LINKS_TAB_SETTINGS_KEYS = Object.freeze(["clientLinkTtlDays"]);

export function buildLinksSettingsPayload(form = {}) {
  const raw = form?.clientLinkTtlDays;
  const clientLinkTtlDays =
    raw === undefined || raw === null || String(raw).trim() === "" ? "0" : String(raw);
  return { clientLinkTtlDays };
}
