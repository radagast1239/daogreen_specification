import {
  addProjectScheme,
  listProjectSchemes,
} from "./clientSchemes.js";

/** Display title derived from a pasted screenshot filename. */
export function schemeTitleFromPasteFile(file) {
  return (String(file?.name || "Скриншот").replace(/\.[^.]+$/, "") || "Скриншот");
}

/**
 * Capture an immutable paste attempt bound to a project/generation.
 * Write callback is frozen at begin(); live manualParams are read only if still current.
 */
export function beginSchemePasteAttempt({
  projectId,
  generation,
  getGeneration,
  getProjectId,
  isMounted,
  getManualParams,
  onChange,
}) {
  const captured = {
    projectId: String(projectId || ""),
    generation: Number(generation),
    onChange,
    getManualParams,
  };
  return {
    ...captured,
    isCurrent() {
      if (typeof isMounted === "function" && !isMounted()) return false;
      if (Number(getGeneration()) !== captured.generation) return false;
      if (String(getProjectId() || "") !== captured.projectId) return false;
      return typeof captured.onChange === "function";
    },
  };
}

/**
 * Upload clipboard image first, then append a filled scheme card — only if attempt is still current.
 * Stale context after project switch/unmount: no onChange; uploaded file remains an orphan for retention.
 */
export async function pasteClipboardSchemeImage({ file, uploadFile, attempt }) {
  if (!file || typeof uploadFile !== "function" || !attempt) {
    return { ok: false, id: null, reason: "invalid" };
  }

  const result = await uploadFile(file);

  if (!attempt.isCurrent()) {
    return {
      ok: false,
      stale: true,
      orphanUploadUrl: result?.url || null,
      id: null,
    };
  }

  const latest =
    typeof attempt.getManualParams === "function" ? attempt.getManualParams() : {};
  const withNew = addProjectScheme(latest, {
    title: schemeTitleFromPasteFile(file),
    mimeType: result.mimeType || file.type || "image/png",
    url: result.url,
  });
  const newId = listProjectSchemes(withNew).at(-1)?.id;
  if (!newId) return { ok: false, id: null, reason: "missing-id" };

  if (!attempt.isCurrent()) {
    return {
      ok: false,
      stale: true,
      orphanUploadUrl: result?.url || null,
      id: null,
    };
  }

  attempt.onChange(withNew);
  return {
    ok: true,
    id: newId,
    url: result.url,
    mimeType: result.mimeType || file.type || "image/png",
  };
}
