/** Pure helpers for material EN translations (frontend + backend). No Node crypto. */

export const MATERIAL_TRANSLATION_LOCALES = Object.freeze(["en"]);
export const MATERIAL_TRANSLATION_STATUSES = Object.freeze([
  "translated",
  "needs_review",
  "do_not_translate",
  "fallback_original",
]);

export function normalizeMaterialTranslationLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  if (locale === "en") return "en";
  return "";
}

export function normalizeMaterialTranslationStatus(value, fallback = "fallback_original") {
  const status = String(value || "").trim();
  if (MATERIAL_TRANSLATION_STATUSES.includes(status)) return status;
  return fallback;
}

/** Canonical source payload for hashing (backend hashes this string). */
export function materialTranslationSourcePayload({
  name = "",
  description = "",
  unit = "",
  category = "",
  subcategory = "",
} = {}) {
  return [
    String(name || ""),
    String(description || ""),
    String(unit || ""),
    String(category || ""),
    String(subcategory || ""),
  ].join("\n");
}

export function materialSourcePayloadFromMaterial(material = {}) {
  return materialTranslationSourcePayload({
    name: material.name,
    description: material.clientNote || material.client_note || material.description || "",
    unit: material.unit,
    category: material.category,
    subcategory: material.subcategory,
  });
}

export function isMaterialTranslationStale(material, translation, computeHash) {
  if (!translation || typeof computeHash !== "function") return false;
  const expected = computeHash(materialSourcePayloadFromMaterial(material));
  const stored = String(translation.sourceHash || translation.source_hash || "");
  return !!stored && stored !== expected;
}

/**
 * Resolve frozen display fields for a published release item.
 * Does not look up live catalog — only uses already-frozen fields or RU originals.
 */
export function resolveItemDisplayFields(item = {}, { language = "ru" } = {}) {
  const lang = String(language || "ru").toLowerCase() === "en" ? "en" : "ru";
  if (lang === "ru") {
    return {
      displayName: String(item.name || ""),
      displayDescription: String(item.clientNote || item.client_note || ""),
      displayUnit: String(item.unit || ""),
      displayCategory: String(item.category || ""),
      translationStatus: "original_ru",
    };
  }
  if (item.displayName || item.translationStatus) {
    return {
      displayName: String(item.displayName || item.name || ""),
      displayDescription: String(
        item.displayDescription != null && item.displayDescription !== ""
          ? item.displayDescription
          : item.clientNote || item.client_note || "",
      ),
      displayUnit: String(item.displayUnit || item.unit || ""),
      displayCategory: String(item.displayCategory || item.category || ""),
      translationStatus: normalizeMaterialTranslationStatus(
        item.translationStatus,
        "fallback_original",
      ),
    };
  }
  return {
    displayName: String(item.name || ""),
    displayDescription: String(item.clientNote || item.client_note || ""),
    displayUnit: String(item.unit || ""),
    displayCategory: String(item.category || ""),
    translationStatus: "fallback_original",
  };
}

export function itemDisplayName(item, language = "ru") {
  return resolveItemDisplayFields(item, { language }).displayName;
}

export function itemDisplayUnit(item, language = "ru") {
  return resolveItemDisplayFields(item, { language }).displayUnit;
}

export function itemDisplayDescription(item, language = "ru") {
  return resolveItemDisplayFields(item, { language }).displayDescription;
}

export function itemDisplayCategory(item, language = "ru") {
  return resolveItemDisplayFields(item, { language }).displayCategory;
}

/**
 * Build frozen EN/RU display fields for one project item at publish time.
 * `translation` is the DB row DTO for materialId (or null).
 * Manual rows may carry nameEn / descriptionEn / unitEn.
 * `sourceHashFn` optional — when provided, stale EN translations fall back to original.
 */
export function freezeItemDisplayFields(item = {}, {
  language = "ru",
  translation = null,
  material = null,
  sourceHashFn = null,
} = {}) {
  const lang = String(language || "ru").toLowerCase() === "en" ? "en" : "ru";
  if (lang !== "en") {
    return {
      ...item,
      displayName: String(item.name || ""),
      displayDescription: String(item.clientNote || ""),
      displayUnit: String(item.unit || ""),
      displayCategory: String(item.category || ""),
      translationStatus: "original_ru",
      sourceMaterialId: item.materialId || item.material_id || "",
    };
  }

  const materialId = String(item.materialId || item.material_id || "").trim();
  const manualNameEn = String(item.nameEn || item.name_en || "").trim();
  const manualDescEn = String(item.descriptionEn || item.description_en || "").trim();
  const manualUnitEn = String(item.unitEn || item.unit_en || "").trim();

  if (!materialId) {
    return {
      ...item,
      displayName: manualNameEn || String(item.name || ""),
      displayDescription: manualDescEn || String(item.clientNote || ""),
      displayUnit: manualUnitEn || String(item.unit || ""),
      displayCategory: String(item.category || ""),
      translationStatus: manualNameEn ? "translated" : "fallback_original",
      sourceMaterialId: "",
    };
  }

  const status = normalizeMaterialTranslationStatus(
    translation?.translationStatus || translation?.translation_status,
    "fallback_original",
  );
  const nameEn = String(translation?.name || "").trim();
  const descEn = String(translation?.description || "").trim();
  const unitEn = String(translation?.unit || "").trim();
  const categoryEn = String(translation?.category || "").trim();

  const useTranslation =
    (status === "translated" || status === "needs_review") && !!nameEn;

  const stale =
    material && translation && typeof sourceHashFn === "function"
      ? isMaterialTranslationStale(material, translation, sourceHashFn)
      : false;

  return {
    ...item,
    displayName: useTranslation && !stale ? nameEn : String(item.name || ""),
    displayDescription:
      useTranslation && !stale
        ? descEn || String(item.clientNote || "")
        : String(item.clientNote || ""),
    displayUnit: useTranslation && !stale && unitEn ? unitEn : String(item.unit || ""),
    displayCategory:
      useTranslation && !stale && categoryEn ? categoryEn : String(item.category || ""),
    translationStatus:
      useTranslation && !stale
        ? status
        : "fallback_original",
    sourceMaterialId: materialId,
  };
}

export function translationDtoFromRow(row) {
  if (!row) return null;
  return {
    materialId: row.material_id,
    locale: row.locale,
    name: row.name || "",
    description: row.description || "",
    unit: row.unit || "",
    category: row.category || "",
    subcategory: row.subcategory || "",
    translationStatus: normalizeMaterialTranslationStatus(row.translation_status),
    sourceHash: row.source_hash || "",
    translatorNote: row.translator_note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}
