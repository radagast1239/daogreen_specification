/** Photo page statistics — frontend-only display helpers. */

export function materialPhotoCounts(materials = []) {
  const list = materials || [];
  const total = list.length;
  const withPhoto = list.filter((m) => m.imageUrl || m.photoUrl).length;
  const withoutPhoto = Math.max(0, total - withPhoto);
  return { total, withPhoto, withoutPhoto };
}

/**
 * Unlinked file count from last upload/scan result.
 * null = not scanned yet (unknown); number = known (including 0).
 */
export function resolveUnlinkedPhotoCount(result) {
  if (result == null) return null;
  return Array.isArray(result.unmatched) ? result.unmatched.length : 0;
}

export function formatPhotoPageSubtitle({ withPhoto, withoutPhoto, unlinkedCount }) {
  const w = Number(withPhoto) || 0;
  const wo = Number(withoutPhoto) || 0;
  if (unlinkedCount == null) {
    return `${w} с фото · ${wo} без фото · непривязанные файлы не проверены`;
  }
  const n = Number(unlinkedCount);
  const safe = Number.isFinite(n) ? n : 0;
  return `${w} с фото · ${wo} без фото · ${safe} не привязано`;
}

export function formatUnlinkedCardValue(unlinkedCount) {
  if (unlinkedCount == null) return "Не проверено";
  const n = Number(unlinkedCount);
  return String(Number.isFinite(n) ? n : 0);
}
