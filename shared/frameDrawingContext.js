/** Контекст привязки чертежа каркаса (query params / API metadata) */

import {
  normalizeFrameSourceType,
  FRAME_SOURCE_MODULE_RACK,
  FRAME_SOURCE_PRESET,
  FRAME_SOURCE_PROJECT,
  FRAME_SOURCE_PROJECT_STELLAGE,
  FRAME_SOURCE_STANDALONE,
} from './frameDrawingTargets.js';
import { buildModuleRackKey } from './moduleRackIds.js';
import { buildBuilderDraftPath } from './projectLifecycle.js';

export const FRAME_DRAWING_SOURCE_TYPES = [
  FRAME_SOURCE_PROJECT,
  FRAME_SOURCE_PROJECT_STELLAGE,
  FRAME_SOURCE_MODULE_RACK,
  FRAME_SOURCE_PRESET,
  FRAME_SOURCE_STANDALONE,
];

export function parseFrameDrawingSearchParams(searchParams) {
  const sp = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || '');

  const drawingId = sp.get('drawingId') || sp.get('drawing_id') || '';
  const projectId = sp.get('projectId') || sp.get('project_id') || '';
  const moduleId = sp.get('moduleId') || sp.get('module_id') || '';
  const rackId = sp.get('rackId') || sp.get('rack_id')
    || sp.get('stellageId') || sp.get('stellage_id') || '';
  const moduleRackKey = sp.get('moduleRackKey') || sp.get('module_rack_key') || '';
  const presetId = sp.get('presetId') || sp.get('preset_id') || '';
  const source = sp.get('source') || sp.get('sourceType') || '';
  const returnTo = sp.get('returnTo') || sp.get('return_to') || '';
  const rackLabel = sp.get('rackLabel') || sp.get('rack_label') || '';
  const projectName = sp.get('projectName') || sp.get('project_name') || '';
  const mode = sp.get('mode') || '';
  const constructorTab = sp.get('constructorTab') || sp.get('constructor_tab') || '';

  let sourceType = normalizeFrameSourceType(source);
  if (!source) {
    if (projectId && rackId) sourceType = FRAME_SOURCE_PROJECT_STELLAGE;
    else if (projectId && moduleId && (moduleRackKey || rackId)) sourceType = FRAME_SOURCE_MODULE_RACK;
    else if (projectId && !rackId && !moduleId) sourceType = FRAME_SOURCE_PROJECT;
    else if (presetId) sourceType = FRAME_SOURCE_PRESET;
    else if (moduleId) sourceType = FRAME_SOURCE_MODULE_RACK;
    else sourceType = FRAME_SOURCE_STANDALONE;
  }

  const resolvedModuleRackKey = moduleRackKey
    || (moduleId && rackId
      ? buildModuleRackKey({ moduleId, rackId })
      : '');

  return {
    drawingId,
    projectId,
    moduleId,
    rackId,
    stellageId: rackId,
    moduleRackKey: resolvedModuleRackKey,
    presetId,
    sourceType,
    returnTo,
    rackLabel,
    projectName,
    mode,
    constructorTab,
  };
}

export const DRAFT_PROJECT_FRAME_DRAWING_DISABLED_REASON =
  'Сначала сохраните проект. После сохранения схемы каркасов будут доступны в мастере настройки проекта.';

export const DRAFT_PROJECT_FRAME_DRAWING_SECTION_HINT =
  'Схемы каркасов и добавление BOM в закупку доступны после сохранения черновика. Используйте «Сохранить черновик и создать схему» — черновик сохранится, и откроется конструктор каркаса.';

export const BUILDER_SAVE_AND_CREATE_FRAME_HINT =
  'Черновик проекта будет сохранён, после этого откроется конструктор каркаса. Схема и BOM будут привязаны к этому проекту.';

export const STANDALONE_FRAME_SAVE_HINT =
  'Чтобы сохранить чертёж к проекту и добавить BOM, откройте конструктор из сохранённого проекта или через мастер настройки проекта.';

export function buildBuilderEditStellagesPath(projectId, { editRack, step = 'stellages' } = {}) {
  const id = String(projectId || '').trim();
  if (!id) return buildBuilderStellagesReturnPath();
  return buildBuilderDraftPath(id, { step, editRack });
}

export function isBuilderWizardReturnPath(returnTo = '') {
  const path = String(returnTo || '');
  return path.startsWith('/new') && path.includes('projectId=');
}

export function canCreateFrameDrawingFromBuilder(projectId) {
  return Boolean(String(projectId || '').trim());
}

export function hasFrameDrawingSaveTarget(ctx) {
  if (!ctx) return false;
  return Boolean(
    ctx.projectId
    || ctx.presetId
    || ctx.drawingId,
  );
}

export function resolveFramePdfExportUi(drawingContext, comboEval = {}) {
  const canSave = hasFrameDrawingSaveTarget(drawingContext);
  const isReplaceMode = drawingContext?.mode === 'replace' && drawingContext?.drawingId;
  const isNewVersionMode = drawingContext?.mode === 'new_version';
  const showComboButton = canSave
    && comboEval.canSavePdfAndBom
    && !isReplaceMode
    && !isNewVersionMode;

  return {
    canSave,
    showSavePdfButton: canSave,
    showComboButton,
    showDownloadOnly: !canSave,
    showStandaloneSaveHint: !drawingContext?.projectId,
    showReturnToProjectSetup: isBuilderWizardReturnPath(drawingContext?.returnTo),
    showReturnToStellages: Boolean(
      drawingContext?.projectId
      && !isBuilderWizardReturnPath(drawingContext?.returnTo)
      && String(drawingContext?.returnTo || '').includes('section=stellages'),
    ),
  };
}

export function buildBuilderFrameDrawingContext({ projectId, projectName, stellage, returnTo }) {
  const rackId = stellage.id;
  const moduleId = stellage.moduleId;
  const id = String(projectId || '').trim();
  const moduleRackKey = buildModuleRackKey({ moduleId, rackId });
  return {
    projectId: id,
    moduleId,
    rackId,
    stellageId: rackId,
    moduleRackKey,
    presetId: stellage.presetId || '',
    sourceType: FRAME_SOURCE_PROJECT_STELLAGE,
    rackLabel: stellage.name,
    projectName: projectName || '',
    returnTo: returnTo || buildBuilderEditStellagesPath(id, { editRack: moduleRackKey }),
  };
}

export function buildSavedProjectFrameDrawingContext(project, stellage) {
  const moduleRackKey = buildModuleRackKey({
    moduleId: stellage?.moduleId,
    rackId: stellage?.id,
  });
  return buildBuilderFrameDrawingContext({
    projectId: project.id,
    projectName: project.name,
    stellage,
    // Return into builder with the same rack — SpecEditor "Схемы каркасов"
    // must not drop the user into a blank new-stellage draft.
    returnTo: buildBuilderEditStellagesPath(project.id, { editRack: moduleRackKey }),
  });
}

export function buildBuilderStellagesReturnPath() {
  return '/new?step=stellages';
}

export function buildProjectStellagesReturnPath(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return '';
  return `/project/${id}?section=stellages`;
}

export function buildStellagesReturnLabel(returnTo = '') {
  const path = String(returnTo || '');
  if (isBuilderWizardReturnPath(path)) {
    return 'Вернуться к настройке проекта';
  }
  if (path.includes('/project/') && path.includes('section=stellages')) {
    return 'Вернуться к стеллажам проекта';
  }
  return 'Вернуться';
}

export function buildFrameDrawingLink(ctx) {
  const params = new URLSearchParams();
  if (ctx.projectId) params.set('projectId', ctx.projectId);
  if (ctx.moduleId) params.set('moduleId', ctx.moduleId);
  if (ctx.rackId) params.set('rackId', ctx.rackId);
  if (ctx.rackId || ctx.stellageId) params.set('stellageId', ctx.rackId || ctx.stellageId);
  if (ctx.moduleRackKey) params.set('moduleRackKey', ctx.moduleRackKey);
  if (ctx.presetId) params.set('presetId', ctx.presetId);
  if (ctx.sourceType) params.set('source', normalizeFrameSourceType(ctx.sourceType));
  if (ctx.returnTo) params.set('returnTo', ctx.returnTo);
  if (ctx.rackLabel) params.set('rackLabel', ctx.rackLabel);
  if (ctx.projectName) params.set('projectName', ctx.projectName);
  if (ctx.drawingId) params.set('drawingId', ctx.drawingId);
  if (ctx.mode) params.set('mode', ctx.mode);
  if (ctx.constructorTab) params.set('constructorTab', ctx.constructorTab);
  const qs = params.toString();
  return `/planner/frame${qs ? `?${qs}` : ''}`;
}

export function buildFrameDrawingTitle(config, ctx = {}) {
  const name = (config?.name || '').trim();
  if (name && name !== 'Новый каркас') return name;
  if (ctx.rackLabel) return `Чертёж: ${ctx.rackLabel}`;
  const rackType = config?.rackType || 'nft';
  const len = config?.lengthMm ?? '?';
  const depth = config?.depthMm ?? '?';
  const tiers = config?.tierCount ?? '?';
  return `Каркас ${rackType} ${len}×${depth}, ${tiers} яр.`;
}

export function frameDrawingBindingLabel(ctx) {
  if (!ctx) return '';
  switch (normalizeFrameSourceType(ctx.sourceType)) {
    case FRAME_SOURCE_PROJECT:
      return ctx.projectName ? `Проект: ${ctx.projectName}` : 'Проект';
    case FRAME_SOURCE_PROJECT_STELLAGE:
      return ctx.rackLabel
        ? `Стеллаж проекта: ${ctx.rackLabel}`
        : 'Стеллаж проекта';
    case FRAME_SOURCE_MODULE_RACK:
      if (!ctx.projectId) {
        return ctx.rackLabel
          ? `Модуль / стеллаж (без проекта): ${ctx.rackLabel}`
          : 'Модуль / стеллаж (без проекта)';
      }
      return ctx.rackLabel
        ? `Модуль / стеллаж: ${ctx.rackLabel}`
        : 'Стеллаж модуля';
    case FRAME_SOURCE_PRESET:
      return ctx.rackLabel
        ? `Пресет: ${ctx.rackLabel}`
        : 'Пресет стеллажа';
    default:
      return '';
  }
}

export function frameDrawingSaveHint(ctx) {
  if (!ctx) return '';
  const src = normalizeFrameSourceType(ctx.sourceType);
  if (src === FRAME_SOURCE_PRESET) return 'Схема сохранится к пресету.';
  if (src === FRAME_SOURCE_MODULE_RACK && !ctx.projectId) {
    return 'Схема сохранится к модулю, но не попадёт в документы клиента без проекта.';
  }
  if (ctx.projectId) return 'Схема будет сохранена в документы проекта.';
  return '';
}

export function buildFrameDrawingSavePayload(config, ctx, overrides = {}) {
  const moduleRackKey = ctx.moduleRackKey
    || (ctx.moduleId && normalizeFrameSourceType(ctx.sourceType) === FRAME_SOURCE_MODULE_RACK
      ? buildModuleRackKey({
        moduleId: ctx.moduleId,
        rackId: ctx.rackId || ctx.stellageId,
      })
      : null);

  return {
    projectId: ctx.projectId || null,
    moduleId: ctx.moduleId || null,
    stellageId: ctx.rackId || ctx.stellageId || null,
    moduleRackKey: moduleRackKey || null,
    presetId: ctx.presetId || null,
    sourceType: normalizeFrameSourceType(ctx.sourceType || FRAME_SOURCE_STANDALONE),
    title: overrides.title || buildFrameDrawingTitle(config, ctx),
    rackType: config?.rackType || '',
    frameConfigJson: config,
    isClientVisible: overrides.isClientVisible !== false,
    replace: Boolean(overrides.replace),
    drawingId: ctx.drawingId || overrides.drawingId || null,
  };
}

export {
  buildModuleRackKey,
  moduleCatalogRackId,
  moduleMetaFrameRackId,
  ensureModuleMetaFrameRackIds,
  MODULE_CATALOG_RACK_SLOT,
  moduleRackKeyUsesIndexFallback,
} from './moduleRackIds.js';
export {
  normalizeFrameSourceType,
  FRAME_SOURCE_PROJECT,
  FRAME_SOURCE_PROJECT_STELLAGE,
  FRAME_SOURCE_MODULE_RACK,
  FRAME_SOURCE_PRESET,
  FRAME_SOURCE_STANDALONE,
} from './frameDrawingTargets.js';
