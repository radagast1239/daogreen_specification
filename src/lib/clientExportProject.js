import { clientExportHeader } from "../../shared/publishedClientMeta.js";

export { clientExportHeader };

/** Ensure PDF/Excel helpers always receive snapshot-backed header fields from the client DTO. */
export function projectForClientPdfExport(project = {}) {
  const header = clientExportHeader(project);
  return { ...project, ...header };
}

export function projectForClientExcelExport(project = {}) {
  return projectForClientPdfExport(project);
}
