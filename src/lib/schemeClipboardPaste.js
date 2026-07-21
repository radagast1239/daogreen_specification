import {
  addProjectScheme,
  listProjectSchemes,
  removeProjectScheme,
} from "./clientSchemes.js";

/** Display title derived from a pasted screenshot filename. */
export function schemeTitleFromPasteFile(file) {
  return (String(file?.name || "Скриншот").replace(/\.[^.]+$/, "") || "Скриншот");
}

/**
 * Remove a paste-created placeholder only when it still exists and has no url.
 * Kept for defensive cleanup if a caller still adds a card before upload.
 */
export function rollbackEmptySchemeCard(manualParams, id) {
  const list = listProjectSchemes(manualParams);
  const scheme = list.find((s) => s.id === id || s.key === id);
  if (!scheme) return { manualParams, removed: false };
  if (String(scheme.url || "").trim()) return { manualParams, removed: false };
  return { manualParams: removeProjectScheme(manualParams, id), removed: true };
}

/**
 * Upload clipboard image first, then append a filled scheme card.
 * On upload failure no card is created — avoids empty «Нет файла» leftovers
 * from racing projectUpdate PATCH revisions.
 */
export async function pasteClipboardSchemeImage({
  manualParams,
  file,
  uploadFile,
  onChange,
  getManualParams,
}) {
  if (!file || typeof uploadFile !== "function" || typeof onChange !== "function") {
    return { ok: false, id: null };
  }
  const readMp = typeof getManualParams === "function" ? getManualParams : () => manualParams;

  const result = await uploadFile(file);
  const base = readMp();
  const withNew = addProjectScheme(base, {
    title: schemeTitleFromPasteFile(file),
    mimeType: result.mimeType || file.type || "image/png",
    url: result.url,
  });
  const newId = listProjectSchemes(withNew).at(-1)?.id;
  if (!newId) return { ok: false, id: null };
  onChange(withNew);
  return { ok: true, id: newId, url: result.url, mimeType: result.mimeType || file.type || "image/png" };
}
