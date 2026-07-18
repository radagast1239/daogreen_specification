/** Allowlisted client-facing project metadata for published releases. */

export const CLIENT_PROJECT_META_FIELDS = [
  "name",
  "client",
  "city",
  "address",
  "description",
  "comment",
  "currency",
  "vat",
  "type",
  "area",
  "height",
  "sowingArea",
  "status",
];

/**
 * Build immutable projectMeta stored in release snapshot.
 * Omits auth, tokens, internal-only and server paths.
 */
export function buildPublishedProjectMeta(project = {}) {
  return {
    id: String(project?.id || ""),
    name: String(project?.name || ""),
    client: String(project?.client || ""),
    city: String(project?.city || ""),
    address: String(project?.address || ""),
    description: String(project?.description || ""),
    comment: String(project?.comment || ""),
    currency: String(project?.currency || "₽"),
    vat: !!project?.vat,
    type: String(project?.type || ""),
    area: project?.area ?? "",
    height: project?.height ?? "",
    sowingArea: project?.sowingArea ?? "",
    status: String(project?.status || ""),
    versionNumber: Number(project?.version) || 0,
  };
}

function metaIsUsable(projectMeta) {
  if (!projectMeta || typeof projectMeta !== "object") return false;
  return (
    projectMeta.name != null ||
    projectMeta.client != null ||
    projectMeta.currency != null ||
    projectMeta.city != null
  );
}

/**
 * Apply published meta onto a client DTO shell.
 * Legacy compatibility: only when projectMeta is truly absent, fall back to live allowlist fields.
 */
export function applyPublishedProjectMeta(projectMeta, liveProject = {}, { allowLiveFallback = false } = {}) {
  const useSnapshot = metaIsUsable(projectMeta);
  const use = useSnapshot ? projectMeta : allowLiveFallback ? liveProject : {};

  const out = {};
  for (const key of CLIENT_PROJECT_META_FIELDS) {
    if (key === "vat") {
      out.vat = !!use[key];
      continue;
    }
    if (use[key] !== undefined && use[key] !== null) {
      out[key] = use[key];
      continue;
    }
    if (key === "currency") out.currency = "₽";
    else out[key] = "";
  }
  return out;
}

/** Header fields used by PDF/Excel — always from client DTO (already snapshot-backed). */
export function clientExportHeader(project = {}) {
  return {
    id: project?.id || "",
    name: String(project?.name || ""),
    client: String(project?.client || ""),
    city: String(project?.city || ""),
    address: String(project?.address || ""),
    comment: String(project?.comment || ""),
    currency: String(project?.currency || "₽"),
    vat: !!project?.vat,
    status: String(project?.status || ""),
  };
}
