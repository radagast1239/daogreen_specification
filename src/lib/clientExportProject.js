import { clientExportHeader } from "../../shared/publishedClientMeta.js";

export { clientExportHeader };

/** Ensure PDF/Excel helpers always receive snapshot-backed header fields from the client DTO. */
export function projectForClientPdfExport(project = {}) {
  const header = clientExportHeader(project);
  const counts = Array.isArray(project?.stellageCounts) && project.stellageCounts.length
    ? project.stellageCounts
    : Array.isArray(project?.stellageConfigs)
      ? project.stellageConfigs
      : [];
  return {
    ...project,
    ...header,
    stellageCounts: counts,
    // Alias for helpers that still read stellageConfigs (never invent live configs).
    stellageConfigs: counts,
  };
}

export function projectForClientExcelExport(project = {}) {
  return projectForClientPdfExport(project);
}
