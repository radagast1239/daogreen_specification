/**
 * Стабильные идентификаторы стеллажей внутри модуля (для frame_drawings.module_rack_key).
 * Не использовать display name / rackLabel.
 */

/** Слот «шаблон состава» — один стеллаж на тип модуля в «Состав стеллажей». */
export const MODULE_CATALOG_RACK_SLOT = 'catalog';

/** Стабильный rack.id для чертежа шаблона модуля (не зависит от mod.name). */
export function moduleCatalogRackId(moduleId) {
  void moduleId;
  return MODULE_CATALOG_RACK_SLOT;
}

/**
 * @param {{ moduleId: string, rackId?: string, rackIndex?: number }} params
 * @returns {string}
 */
export function buildModuleRackKey({ moduleId, rackId, rackIndex }) {
  if (!moduleId) return '';
  const id = rackId != null && String(rackId).trim() !== '' ? String(rackId).trim() : '';
  if (id) return `${moduleId}:${id}`;
  if (rackIndex !== undefined && rackIndex !== null && !Number.isNaN(Number(rackIndex))) {
    return `${moduleId}:idx:${rackIndex}`;
  }
  return '';
}

/** @returns {boolean} true если ключ использует рискованный fallback по индексу */
export function moduleRackKeyUsesIndexFallback(key) {
  return typeof key === 'string' && key.includes(':idx:');
}

/**
 * Нормализует meta стеллажей: назначает frameRackId там, где его нет.
 * frameRackId сохраняется в settings.stellageModuleMeta и не меняется при переименовании модуля.
 */
export function ensureModuleMetaFrameRackIds(meta = {}) {
  const next = { ...(meta || {}) };
  for (const moduleId of Object.keys(next)) {
    const entry = next[moduleId];
    if (!entry || typeof entry !== 'object') {
      next[moduleId] = { frameRackId: moduleCatalogRackId(moduleId) };
      continue;
    }
    if (!entry.frameRackId) {
      next[moduleId] = { ...entry, frameRackId: moduleCatalogRackId(moduleId) };
    }
  }
  return next;
}

export function moduleMetaFrameRackId(meta, moduleId) {
  const fromMeta = meta?.[moduleId]?.frameRackId;
  if (fromMeta) return fromMeta;
  return moduleCatalogRackId(moduleId);
}
