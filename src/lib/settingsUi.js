/** Frontend helpers for Settings page (Phase 1E). */

export const SETTINGS_TABS = [
  { id: "overview", label: "Обзор" },
  { id: "links", label: "Ссылки" },
  { id: "security", label: "Безопасность" },
  { id: "system", label: "Система" },
];

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
