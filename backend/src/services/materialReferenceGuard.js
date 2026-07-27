/**
 * Fail-closed guards for destructive material-catalog operations.
 * No migrations; reference discovery follows current schema only.
 */

export class MaterialCatalogError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, references?: Record<string, number> }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = "MaterialCatalogError";
    this.code = code;
    this.status = opts.status ?? 409;
    this.references = opts.references;
  }
}

const REPLACE_DISABLED_MESSAGE =
  "Полная замена базы материалов временно отключена. Используйте объединение с существующей базой.";

const IN_USE_MESSAGE = "Материал используется и не может быть удалён.";

export function assertReplaceAllowed(mode) {
  if (String(mode || "").toLowerCase() === "replace") {
    throw new MaterialCatalogError("MATERIAL_REPLACE_DISABLED", REPLACE_DISABLED_MESSAGE, {
      status: 409,
    });
  }
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function countMaterialIdInLines(lines, materialId) {
  if (!Array.isArray(lines)) return 0;
  let n = 0;
  for (const ln of lines) {
    if (ln && String(ln.materialId || "").trim() === materialId) n += 1;
  }
  return n;
}

function walkJsonForMaterialId(value, materialId, depth = 0) {
  if (depth > 8 || value == null) return 0;
  if (typeof value === "string") return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, v) => sum + walkJsonForMaterialId(v, materialId, depth + 1), 0);
  }
  if (typeof value === "object") {
    let n = 0;
    if (String(value.materialId || "").trim() === materialId) n += 1;
    for (const v of Object.values(value)) n += walkJsonForMaterialId(v, materialId, depth + 1);
    return n;
  }
  return 0;
}

/**
 * Collect live reference counts for a material id.
 * @returns {{ projects: number, projectItems: number, templates: number, frameBom: number, farmCatalogs: number, alternatives: number, files: number }}
 */
export function collectMaterialReferences(database, materialId) {
  const id = String(materialId || "").trim();
  if (!id) {
    return {
      projects: 0,
      projectItems: 0,
      templates: 0,
      frameBom: 0,
      farmCatalogs: 0,
      alternatives: 0,
      files: 0,
    };
  }

  const projectItems = Number(
    database.prepare("SELECT COUNT(*) AS c FROM project_items WHERE material_id = ?").get(id)?.c || 0
  );
  const projects = Number(
    database
      .prepare("SELECT COUNT(DISTINCT project_id) AS c FROM project_items WHERE material_id = ?")
      .get(id)?.c || 0
  );
  const frameBom = Number(
    database
      .prepare(
        `SELECT COUNT(*) AS c FROM project_items
         WHERE material_id = ?
           AND (
             source_type = 'frame_bom'
             OR source = 'frame_bom'
             OR source_key LIKE 'frame_bom:%'
           )`
      )
      .get(id)?.c || 0
  );

  let templates = 0;
  const presets = database.prepare("SELECT id, items_json, params_json FROM spec_presets").all();
  for (const row of presets) {
    const items = parseJson(row.items_json, []);
    const params = parseJson(row.params_json, {});
    const hit = countMaterialIdInLines(items, id) + walkJsonForMaterialId(params, id);
    if (hit > 0) templates += 1;
  }

  let farmCatalogs = 0;
  const farmRow = database.prepare("SELECT value FROM settings WHERE key = ?").get("farmSectionCatalogs");
  const catalogs = parseJson(farmRow?.value, {});
  if (catalogs && typeof catalogs === "object") {
    for (const lines of Object.values(catalogs)) {
      farmCatalogs += countMaterialIdInLines(lines, id);
    }
  }

  const alternatives = Number(
    database
      .prepare(
        "SELECT COUNT(*) AS c FROM materials WHERE alternative_material_id = ? AND id != ?"
      )
      .get(id, id)?.c || 0
  );

  const files = Number(
    database.prepare("SELECT COUNT(*) AS c FROM files WHERE material_id = ?").get(id)?.c || 0
  );

  return {
    projects,
    projectItems,
    templates,
    frameBom,
    farmCatalogs,
    alternatives,
    files,
  };
}

export function totalReferenceCount(references) {
  if (!references) return 0;
  return Object.values(references).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

export function assertMaterialNotInUse(database, materialId) {
  const references = collectMaterialReferences(database, materialId);
  if (totalReferenceCount(references) > 0) {
    throw new MaterialCatalogError("MATERIAL_IN_USE", IN_USE_MESSAGE, {
      status: 409,
      references,
    });
  }
  return references;
}
