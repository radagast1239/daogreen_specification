/** Whitelisted immutable client image manifest built from an admin project draft. */

export function safeImageUrl(value) {
  const url = String(value || "").trim();
  if (!url || /^(?:data|file|javascript):/i.test(url) || /^[a-zA-Z]:[\\/]/.test(url)) return "";
  return url.startsWith("/uploads/") || /^https:\/\//i.test(url) ? url : "";
}

function clientImageDto(raw, index, extra = {}) {
  const url = safeImageUrl(raw?.url);
  if (!url || raw?.clientVisible !== true) return null;
  const dto = {
    id: String(raw?.id || "").trim(),
    ...extra,
    title: String(raw?.title || `Изображение ${index + 1}`).trim(),
    url,
    mimeType: String(raw?.mimeType || "image/*").trim(),
    sortOrder: index,
  };
  if (raw?.contentHash) dto.contentHash = String(raw.contentHash);
  if (raw?.sizeBytes != null && raw.sizeBytes !== "") dto.sizeBytes = Number(raw.sizeBytes) || 0;
  if (raw?.assetPath) dto.assetPath = String(raw.assetPath);
  return dto;
}

export function buildClientImageManifest(project = {}) {
  const projectSchemes = (Array.isArray(project?.manualParams?.projectSchemes) ? project.manualParams.projectSchemes : [])
    .slice().sort((a, b) => (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0))
    .map((image, index) => clientImageDto(image, index)).filter(Boolean)
    .map((image, sortOrder) => ({ ...image, sortOrder }));
  const rackImages = [];
  for (const rack of project?.stellageConfigs || []) {
    const rackId = String(rack?.id || "").trim();
    if (!rackId) continue;
    const sorted = (Array.isArray(rack.extraImages) ? rack.extraImages : [])
      .slice().sort((a, b) => (Number(a?.sortOrder) || 0) - (Number(b?.sortOrder) || 0));
    sorted.forEach((image, index) => {
      const dto = clientImageDto(image, index, { rackId, rackTitle: String(rack.name || rack.moduleName || "Стеллаж").trim() });
      if (dto) rackImages.push(dto);
    });
  }
  return { projectSchemes, rackImages };
}

export function normalizeClientImageManifest(raw = {}) {
  return {
    projectSchemes: Array.isArray(raw?.projectSchemes) ? raw.projectSchemes.map((x) => ({ ...x })) : [],
    rackImages: Array.isArray(raw?.rackImages) ? raw.rackImages.map((x) => ({ ...x })) : [],
  };
}

/** Attach contentHash / sizeBytes / assetPath onto manifest entries (mutates copies). */
export function applyImageAssetMeta(manifest = {}, metaByUrl = new Map()) {
  const apply = (img) => {
    const meta = metaByUrl.get(String(img?.url || "")) || metaByUrl.get(String(img?.assetPath || ""));
    if (!meta) return { ...img };
    return {
      ...img,
      contentHash: meta.contentHash || img.contentHash || "",
      sizeBytes: meta.sizeBytes ?? img.sizeBytes ?? 0,
      mimeType: meta.mimeType || img.mimeType || "image/*",
      assetPath: meta.assetPath || img.assetPath || img.url || "",
    };
  };
  const normalized = normalizeClientImageManifest(manifest);
  return {
    projectSchemes: normalized.projectSchemes.map(apply),
    rackImages: normalized.rackImages.map(apply),
  };
}

export function clientImageManifestFingerprint(manifest = {}) {
  const n = normalizeClientImageManifest(manifest);
  // Include hashes when present so republish detects binary replacement at same URL.
  const compact = {
    projectSchemes: n.projectSchemes.map((x) => ({
      id: x.id, title: x.title, url: x.url, sortOrder: x.sortOrder, contentHash: x.contentHash || "",
    })),
    rackImages: n.rackImages.map((x) => ({
      id: x.id, title: x.title, url: x.url, rackId: x.rackId, sortOrder: x.sortOrder, contentHash: x.contentHash || "",
    })),
  };
  return JSON.stringify(compact);
}
