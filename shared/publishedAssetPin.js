/** Pure helpers for pinned published assets (no filesystem). */

export function normalizeUploadUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      return u.pathname.startsWith("/uploads/") ? u.pathname : raw;
    }
  } catch {
    /* ignore */
  }
  return raw.startsWith("/uploads/") ? raw.split("?")[0] : raw;
}

export function isLocalUploadUrl(url = "") {
  return String(url || "").trim().startsWith("/uploads/");
}

export function collectUrlsFromImageManifest(manifest = {}) {
  const urls = [];
  for (const img of manifest?.projectSchemes || []) {
    if (img?.url) urls.push(String(img.url));
  }
  for (const img of manifest?.rackImages || []) {
    if (img?.url) urls.push(String(img.url));
  }
  return urls;
}

export function collectUrlsFromPinnedDrawings(pins = []) {
  return (Array.isArray(pins) ? pins : []).map((p) => p?.url || p?.pdfUrl).filter(Boolean).map(String);
}

/** Collect all local upload URLs referenced by a parsed release snapshot. */
export function collectPinnedAssetUrlsFromSnapshot(snapshot) {
  if (!snapshot || Array.isArray(snapshot)) return [];
  const urls = [
    ...collectUrlsFromImageManifest(snapshot.imageManifest),
    ...collectUrlsFromPinnedDrawings(snapshot.pinnedFrameDrawings),
  ];
  const normalized = urls.map(normalizeUploadUrl).filter((u) => u.startsWith("/uploads/"));
  return [...new Set(normalized)];
}

export function pinnedFrameDrawingsFingerprint(pins = []) {
  return JSON.stringify(
    (Array.isArray(pins) ? pins : [])
      .map((p) => ({
        id: p.drawingId || p.id || "",
        version: Number(p.drawingVersion || p.version) || 0,
        url: p.url || p.pdfUrl || "",
        hash: p.contentHash || "",
        target: p.targetKey || p.moduleRackKey || p.stellageId || p.presetId || "",
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
}

export function normalizePinnedFrameDrawings(raw = []) {
  return (Array.isArray(raw) ? raw : []).map((p) => ({
    drawingId: String(p?.drawingId || p?.id || ""),
    drawingVersion: Number(p?.drawingVersion || p?.version) || 0,
    targetKey: String(p?.targetKey || p?.moduleRackKey || p?.stellageId || p?.presetId || p?.drawingId || ""),
    stellageId: String(p?.stellageId || ""),
    moduleId: String(p?.moduleId || ""),
    moduleRackKey: String(p?.moduleRackKey || ""),
    presetId: String(p?.presetId || ""),
    title: String(p?.title || p?.drawingTitle || ""),
    url: String(p?.url || p?.pdfUrl || ""),
    pdfFilename: String(p?.pdfFilename || p?.filename || ""),
    createdAt: String(p?.createdAt || p?.uploadedAt || ""),
    contentHash: String(p?.contentHash || ""),
    sizeBytes: Number(p?.sizeBytes) || 0,
    mimeType: String(p?.mimeType || "application/pdf"),
    fileId: String(p?.fileId || p?.id || ""),
    type: "frame_drawing",
  }));
}

/** Map pinned drawings to the client documents[] shape. */
export function documentsFromPinnedFrameDrawings(pins = []) {
  return normalizePinnedFrameDrawings(pins).map((p) => ({
    id: p.fileId || p.drawingId,
    type: "frame_drawing",
    filename: p.pdfFilename || `${p.drawingId}.pdf`,
    url: p.url,
    uploadedAt: p.createdAt,
    drawingTitle: p.title,
    drawingSourceType: "",
    stellageId: p.stellageId,
    moduleId: p.moduleId,
    moduleRackKey: p.moduleRackKey,
    presetId: p.presetId,
    drawingVersion: p.drawingVersion,
    rackType: "",
    contentHash: p.contentHash,
    pinned: true,
  }));
}
