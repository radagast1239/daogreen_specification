/** Несколько разделов фермы у одной позиции материала */

export function normalizeMaterialFarmSections(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x || "").trim()).filter(Boolean))];
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

export function resolveMaterialFarmSections(matOrRow) {
  if (matOrRow?.farm_sections_json) {
    try {
      const fromJson = normalizeMaterialFarmSections(JSON.parse(matOrRow.farm_sections_json));
      if (fromJson.length) return fromJson;
    } catch {
      /* ignore */
    }
  }
  const direct = normalizeMaterialFarmSections(matOrRow?.farmSections);
  if (direct.length) return direct;
  if (matOrRow?.farmSectionId) return [String(matOrRow.farmSectionId)];
  if (matOrRow?.farm_section_id) return [String(matOrRow.farm_section_id)];
  return [];
}

export function primaryMaterialFarmSection(matOrRow) {
  const sections = resolveMaterialFarmSections(matOrRow);
  return sections[0] || matOrRow?.farmSectionId || matOrRow?.farm_section_id || "";
}

export function materialInFarmSection(matOrRow, sectionId) {
  if (!sectionId) return true;
  return resolveMaterialFarmSections(matOrRow).includes(sectionId);
}

export function formatMaterialFarmSectionsLabel(matOrRow, labelById = {}, sep = ", ") {
  return resolveMaterialFarmSections(matOrRow)
    .map((id) => labelById[id] || id)
    .join(sep);
}

export function patchMaterialFarmSections(matOrRow, farmSections) {
  const normalized = normalizeMaterialFarmSections(farmSections);
  return {
    ...matOrRow,
    farmSections: normalized,
    farmSectionId: normalized[0] || "",
  };
}
