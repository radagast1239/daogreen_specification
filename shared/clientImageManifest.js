/** Whitelisted immutable client image manifest built from an admin project draft. */
function safeImageUrl(value) {
  const url = String(value || "").trim();
  if (!url || /^(?:data|file|javascript):/i.test(url) || /^[a-zA-Z]:[\\/]/.test(url)) return "";
  return url.startsWith("/uploads/") || /^https:\/\//i.test(url) ? url : "";
}

function clientImageDto(raw, index, extra = {}) {
  const url = safeImageUrl(raw?.url);
  if (!url || raw?.clientVisible !== true) return null;
  return {
    id: String(raw?.id || "").trim(),
    ...extra,
    title: String(raw?.title || `Изображение ${index + 1}`).trim(),
    url,
    mimeType: String(raw?.mimeType || "image/*").trim(),
    sortOrder: index,
  };
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

export function clientImageManifestFingerprint(manifest = {}) {
  return JSON.stringify(normalizeClientImageManifest(manifest));
}
