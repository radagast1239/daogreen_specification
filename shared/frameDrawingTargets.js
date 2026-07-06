/** Привязка чертежей к стеллажам / модулям / пресетам */

export {
  buildModuleRackKey,
  moduleRackKeyUsesIndexFallback,
  moduleCatalogRackId,
  MODULE_CATALOG_RACK_SLOT,
  ensureModuleMetaFrameRackIds,
  moduleMetaFrameRackId,
} from './moduleRackIds.js';

export const FRAME_SOURCE_PROJECT = 'project';
export const FRAME_SOURCE_PROJECT_STELLAGE = 'project_stellage';
export const FRAME_SOURCE_MODULE_RACK = 'module_rack';
export const FRAME_SOURCE_PRESET = 'preset';
export const FRAME_SOURCE_STANDALONE = 'standalone';

/** @deprecated alias */
export const FRAME_SOURCE_PROJECT_RACK = 'project_stellage';

export function normalizeFrameSourceType(source) {
  if (!source || source === 'project_rack') return FRAME_SOURCE_PROJECT_STELLAGE;
  return source;
}

function byNewest(a, b) {
  const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
  const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
  return tb - ta;
}

export function sortDrawingsNewestFirst(drawings = []) {
  return [...drawings].sort(byNewest);
}

export function drawingsForProjectStellage(drawings, stellageId) {
  if (!stellageId) return [];
  return sortDrawingsNewestFirst(
    drawings.filter((d) => d.stellageId === stellageId),
  );
}

export function drawingsForModuleRack(drawings, moduleId, moduleRackKey) {
  if (!moduleId || !moduleRackKey) return [];
  return sortDrawingsNewestFirst(
    drawings.filter((d) => d.moduleId === moduleId && d.moduleRackKey === moduleRackKey),
  );
}

export function drawingsForPreset(drawings, presetId) {
  if (!presetId) return [];
  return sortDrawingsNewestFirst(drawings.filter((d) => d.presetId === presetId));
}

export function drawingStatusLabel(drawings) {
  const list = sortDrawingsNewestFirst(drawings);
  if (!list.length) return 'Схема не создана';
  if (list.length === 1) return 'Схема прикреплена';
  return `Есть ${list.length} версий`;
}

export function clientDocumentBindingLabel(doc) {
  const src = normalizeFrameSourceType(doc.drawingSourceType || doc.sourceType);
  const title = doc.drawingTitle || doc.filename || 'Чертёж';
  switch (src) {
    case FRAME_SOURCE_PROJECT:
      return 'Проект';
    case FRAME_SOURCE_PROJECT_STELLAGE:
      return doc.stellageId ? `Стеллаж: ${title}` : `Стеллаж: ${title}`;
    case FRAME_SOURCE_MODULE_RACK:
      return `Модуль / стеллаж: ${title}`;
    case FRAME_SOURCE_PRESET:
      return `Пресет: ${title}`;
    default:
      return title;
  }
}

export function groupClientFrameDocuments(docs = []) {
  const frames = docs.filter((d) => d.type === 'frame_drawing');
  const groups = new Map();
  for (const d of frames) {
    const label = clientDocumentBindingLabel(d);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(d);
  }
  return [...groups.entries()].map(([label, items]) => ({
    label,
    items: sortDrawingsNewestFirst(items.map((d) => ({
      ...d,
      sortDate: d.uploadedAt,
    }))),
  }));
}
