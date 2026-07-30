import { db, rowToProject, loadProjectItems } from "../db.js";
import { listMaterials } from "../routes/materials.js";
import { getProjectReleaseInfo } from "./publishedReleaseService.js";

/** Compact read-only payload for Reports R1. */
export function getReportsR1Projects() {
  const rows = db
    .prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY updated_at DESC, created_at DESC")
    .all();
  return rows.map((r) => {
    const items = loadProjectItems(r.id);
    const project = rowToProject(r, items);
    const releaseInfo = getProjectReleaseInfo(project);
    return {
      ...project,
      ...releaseInfo,
    };
  });
}

export function getReportsR1Payload() {
  return {
    projects: getReportsR1Projects(),
    materials: listMaterials(),
    generatedAt: new Date().toISOString(),
  };
}
