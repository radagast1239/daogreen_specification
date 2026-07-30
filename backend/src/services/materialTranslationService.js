import { createHash } from "crypto";
import { db, rowToMaterial } from "../db.js";
import {
  MATERIAL_TRANSLATION_STATUSES,
  materialSourcePayloadFromMaterial,
  normalizeMaterialTranslationLocale,
  normalizeMaterialTranslationStatus,
  translationDtoFromRow,
} from "../../../shared/materialTranslations.js";

export function sha256Utf8(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function materialSourceHash(material) {
  return sha256Utf8(materialSourcePayloadFromMaterial(material));
}

function ensureTranslationTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS material_translations (
      material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      locale TEXT NOT NULL CHECK (locale = 'en'),
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      translation_status TEXT NOT NULL DEFAULT 'fallback_original'
        CHECK (translation_status IN ('translated', 'needs_review', 'do_not_translate', 'fallback_original')),
      source_hash TEXT NOT NULL DEFAULT '',
      translator_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (material_id, locale)
    );
  `);
}

export function getMaterialTranslation(materialId, locale = "en") {
  ensureTranslationTable();
  const loc = normalizeMaterialTranslationLocale(locale);
  if (!loc || !materialId) return null;
  const row = db
    .prepare("SELECT * FROM material_translations WHERE material_id = ? AND locale = ?")
    .get(String(materialId), loc);
  return translationDtoFromRow(row);
}

export function listMaterialTranslations(locale = "en") {
  ensureTranslationTable();
  const loc = normalizeMaterialTranslationLocale(locale) || "en";
  return db
    .prepare("SELECT * FROM material_translations WHERE locale = ?")
    .all(loc)
    .map(translationDtoFromRow);
}

export function upsertMaterialTranslation(materialId, patch = {}, locale = "en") {
  ensureTranslationTable();
  const loc = normalizeMaterialTranslationLocale(locale);
  if (!loc) {
    const err = new Error("Invalid locale");
    err.code = "MATERIAL_TRANSLATION_LOCALE_INVALID";
    err.status = 400;
    throw err;
  }
  const mat = db.prepare("SELECT * FROM materials WHERE id = ?").get(String(materialId));
  if (!mat) {
    const err = new Error("Material not found");
    err.code = "MATERIAL_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  const status = normalizeMaterialTranslationStatus(
    patch.translationStatus ?? patch.status,
    "translated",
  );
  if (!MATERIAL_TRANSLATION_STATUSES.includes(status)) {
    const err = new Error("Invalid translation status");
    err.code = "MATERIAL_TRANSLATION_STATUS_INVALID";
    err.status = 400;
    throw err;
  }

  const materialDto = rowToMaterial(mat);
  const sourceHash =
    patch.sourceHash ||
    patch.source_hash ||
    materialSourceHash(materialDto);

  const name = String(patch.name ?? patch.nameEn ?? "").trim();
  const description = String(patch.description ?? patch.descriptionEn ?? "").trim();
  const unit = String(patch.unit ?? patch.unitEn ?? "").trim();
  const category = String(patch.category ?? patch.categoryEn ?? "").trim();
  const subcategory = String(patch.subcategory ?? patch.subcategoryEn ?? "").trim();
  const translatorNote = String(patch.translatorNote ?? patch.note ?? "").trim();

  db.prepare(`
    INSERT INTO material_translations (
      material_id, locale, name, description, unit, category, subcategory,
      translation_status, source_hash, translator_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(material_id, locale) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      unit = excluded.unit,
      category = excluded.category,
      subcategory = excluded.subcategory,
      translation_status = excluded.translation_status,
      source_hash = excluded.source_hash,
      translator_note = excluded.translator_note,
      updated_at = datetime('now')
  `).run(
    String(materialId),
    loc,
    name,
    description,
    unit,
    category,
    subcategory,
    status,
    sourceHash,
    translatorNote,
  );

  return getMaterialTranslation(materialId, loc);
}

export function attachTranslationToMaterial(material) {
  if (!material?.id) return material;
  const translation = getMaterialTranslation(material.id, "en");
  if (!translation) {
    return {
      ...material,
      translation: null,
      translationStatus: "",
      translationStale: false,
      nameEn: "",
      descriptionEn: "",
      unitEn: "",
      categoryEn: "",
    };
  }
  const expected = materialSourceHash(material);
  const stale = !!translation.sourceHash && translation.sourceHash !== expected;
  return {
    ...material,
    translation,
    translationStatus: translation.translationStatus,
    translationStale: stale,
    nameEn: translation.name,
    descriptionEn: translation.description,
    unitEn: translation.unit,
    categoryEn: translation.category,
  };
}

export function materialTranslationCoverage() {
  ensureTranslationTable();
  const total = db.prepare("SELECT COUNT(*) AS c FROM materials").get()?.c || 0;
  const rows = db.prepare(`
    SELECT translation_status AS status, COUNT(*) AS c
    FROM material_translations WHERE locale = 'en'
    GROUP BY translation_status
  `).all();
  const byStatus = {
    translated: 0,
    needs_review: 0,
    do_not_translate: 0,
    fallback_original: 0,
  };
  for (const row of rows) {
    if (byStatus[row.status] != null) byStatus[row.status] = row.c;
  }
  const withRow = rows.reduce((n, r) => n + r.c, 0);
  return {
    total,
    withTranslationRow: withRow,
    withoutTranslationRow: Math.max(0, total - withRow),
    ...byStatus,
    translatedOrReview: byStatus.translated + byStatus.needs_review,
  };
}

/**
 * Import translation file records. Dry-run by default.
 * @returns {{ applied, skipped, errors, coverage, dryRun }}
 */
export function importMaterialTranslations(records, {
  dryRun = true,
  glossary = {},
} = {}) {
  ensureTranslationTable();
  const errors = [];
  const skipped = [];
  const planned = [];

  for (const rec of records || []) {
    const materialId = String(rec.materialId || rec.material_id || "").trim();
    if (!materialId) {
      errors.push({ materialId: "", reason: "MISSING_MATERIAL_ID" });
      continue;
    }
    const mat = db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId);
    if (!mat) {
      errors.push({ materialId, reason: "UNKNOWN_MATERIAL_ID" });
      continue;
    }
    const materialDto = rowToMaterial(mat);
    const currentHash = materialSourceHash(materialDto);
    const fileHash = String(rec.sourceHash || "").trim();
    if (fileHash && fileHash !== currentHash) {
      skipped.push({
        materialId,
        reason: "SOURCE_HASH_MISMATCH",
        expected: currentHash,
        got: fileHash,
      });
    }
    const categoryEn =
      String(rec.categoryEn || "").trim() ||
      String(glossary[materialDto.category] || "").trim() ||
      "";
    planned.push({
      materialId,
      name: String(rec.nameEn || rec.name || "").trim(),
      description: String(rec.descriptionEn || rec.description || "").trim(),
      unit: String(rec.unitEn || rec.unit || "").trim(),
      category: categoryEn,
      subcategory: String(rec.subcategoryEn || "").trim(),
      translationStatus: normalizeMaterialTranslationStatus(rec.status, "translated"),
      sourceHash: currentHash,
      translatorNote: String(rec.note || rec.translatorNote || "").trim(),
      hashMismatch: !!(fileHash && fileHash !== currentHash),
    });
  }

  if (dryRun) {
    return {
      dryRun: true,
      applied: 0,
      planned: planned.length,
      skipped,
      errors,
      coverage: materialTranslationCoverage(),
    };
  }

  if (errors.some((e) => e.reason === "UNKNOWN_MATERIAL_ID")) {
    const err = new Error("Import blocked: unknown material IDs");
    err.code = "MATERIAL_TRANSLATION_IMPORT_UNKNOWN_ID";
    err.details = errors;
    throw err;
  }

  const run = db.transaction(() => {
    for (const row of planned) {
      upsertMaterialTranslation(row.materialId, row, "en");
    }
  });
  run();

  return {
    dryRun: false,
    applied: planned.length,
    planned: planned.length,
    skipped,
    errors,
    coverage: materialTranslationCoverage(),
  };
}

export function getTranslationsByMaterialIds(ids = [], locale = "en") {
  ensureTranslationTable();
  const loc = normalizeMaterialTranslationLocale(locale) || "en";
  const map = new Map();
  for (const id of ids) {
    const tid = String(id || "").trim();
    if (!tid) continue;
    const dto = getMaterialTranslation(tid, loc);
    if (dto) map.set(tid, dto);
  }
  return map;
}
