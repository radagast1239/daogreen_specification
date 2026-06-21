/** Несколько модулей / разделов у одной позиции материала */

export function normalizeMaterialModules(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x || "").trim()).filter(Boolean))];
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

export function resolveMaterialModules(matOrRow) {
  if (matOrRow?.modules_json) {
    try {
      const fromJson = normalizeMaterialModules(JSON.parse(matOrRow.modules_json));
      if (fromJson.length) return fromJson;
    } catch {
      /* ignore */
    }
  }
  const direct = normalizeMaterialModules(matOrRow?.modules);
  if (direct.length) return direct;
  if (matOrRow?.module) return [String(matOrRow.module)];
  return [];
}

export function primaryMaterialModule(matOrRow) {
  const mods = resolveMaterialModules(matOrRow);
  return mods[0] || matOrRow?.module || "";
}

export function materialInModule(matOrRow, moduleName) {
  if (!moduleName) return true;
  return resolveMaterialModules(matOrRow).includes(moduleName);
}

export function formatMaterialModulesLabel(matOrRow, sep = ", ") {
  return resolveMaterialModules(matOrRow).join(sep);
}

export function patchMaterialModules(matOrRow, modules) {
  const normalized = normalizeMaterialModules(modules);
  return {
    ...matOrRow,
    modules: normalized,
    module: normalized[0] || "",
  };
}

export function renameModuleInMaterials(materials, oldName, newName) {
  return materials.map((m) => {
    const mods = resolveMaterialModules(m);
    if (!mods.includes(oldName)) return m;
    return patchMaterialModules(
      m,
      mods.map((n) => (n === oldName ? newName : n))
    );
  });
}
