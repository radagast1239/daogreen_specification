/**
 * Resolve admin project-scoped image assets by stable id (not raw upload path).
 * Looks only inside the given project payload — never across projects.
 */

function invalidAssetId(assetId) {
  const id = String(assetId || "").trim();
  if (!id) return true;
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) return true;
  return false;
}

/**
 * @param {object} project — loaded project with manualParams + stellageConfigs
 * @param {string} assetId
 * @returns {{ ok: true, assetId: string, url: string, kind: string, title?: string } | { ok: false, code: string }}
 */
export function findProjectScopedImageAsset(project, assetId) {
  if (invalidAssetId(assetId)) {
    return { ok: false, code: "INVALID_ASSET_ID" };
  }
  const id = String(assetId).trim();
  if (!project?.id) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const schemes = Array.isArray(project?.manualParams?.projectSchemes)
    ? project.manualParams.projectSchemes
    : [];
  for (const scheme of schemes) {
    if (String(scheme?.id || "").trim() === id) {
      const url = String(scheme?.url || "").trim();
      if (!url) return { ok: false, code: "NOT_FOUND" };
      return {
        ok: true,
        assetId: id,
        url,
        kind: "projectScheme",
        title: scheme.title || scheme.label || "",
      };
    }
  }

  for (const rack of project?.stellageConfigs || []) {
    const extras = Array.isArray(rack?.extraImages) ? rack.extraImages : [];
    for (const image of extras) {
      if (String(image?.id || "").trim() === id) {
        const url = String(image?.url || "").trim();
        if (!url) return { ok: false, code: "NOT_FOUND" };
        return {
          ok: true,
          assetId: id,
          url,
          kind: "rackExtraImage",
          rackId: String(rack?.id || ""),
          title: image.title || "",
        };
      }
    }

    const rackPhotoId = `rack-photo:${String(rack?.id || "").trim()}`;
    if (rack?.id && id === rackPhotoId) {
      const url = String(rack.photoUrl || rack.imageUrl || "").trim();
      if (!url) return { ok: false, code: "NOT_FOUND" };
      return {
        ok: true,
        assetId: id,
        url,
        kind: "rackPhoto",
        rackId: String(rack.id),
        title: rack.name || "",
      };
    }
  }

  return { ok: false, code: "NOT_FOUND" };
}

export function flattenImageManifest(manifest = {}) {
  return [
    ...(Array.isArray(manifest?.projectSchemes) ? manifest.projectSchemes : []),
    ...(Array.isArray(manifest?.rackImages) ? manifest.rackImages : []),
  ];
}

export function findManifestImageById(manifest, imageId) {
  if (invalidAssetId(imageId)) return null;
  const id = String(imageId).trim();
  return flattenImageManifest(manifest).find((img) => String(img?.id || "").trim() === id) || null;
}
