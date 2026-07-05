/** Контекст привязки чертежа каркаса (query params / API metadata) */

export const FRAME_DRAWING_SOURCE_TYPES = [
  'project_rack',
  'module_rack',
  'preset',
  'standalone',
];

export function parseFrameDrawingSearchParams(searchParams) {
  const sp = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || '');

  const drawingId = sp.get('drawingId') || sp.get('drawing_id') || '';
  const projectId = sp.get('projectId') || sp.get('project_id') || '';
  const moduleId = sp.get('moduleId') || sp.get('module_id') || '';
  const rackId = sp.get('rackId') || sp.get('rack_id') || sp.get('stellageId') || '';
  const presetId = sp.get('presetId') || sp.get('preset_id') || '';
  const source = sp.get('source') || sp.get('sourceType') || '';
  const returnTo = sp.get('returnTo') || sp.get('return_to') || '';
  const rackLabel = sp.get('rackLabel') || sp.get('rack_label') || '';
  const projectName = sp.get('projectName') || sp.get('project_name') || '';

  let sourceType = source;
  if (!sourceType) {
    if (projectId && rackId) sourceType = 'project_rack';
    else if (projectId && moduleId) sourceType = 'module_rack';
    else if (presetId) sourceType = 'preset';
    else sourceType = 'standalone';
  }

  return {
    drawingId,
    projectId,
    moduleId,
    rackId,
    presetId,
    sourceType,
    returnTo,
    rackLabel,
    projectName,
  };
}

export function hasFrameDrawingSaveTarget(ctx) {
  if (!ctx) return false;
  return Boolean(
    ctx.projectId
    || ctx.presetId
    || (ctx.moduleId && ctx.sourceType === 'module_rack')
    || ctx.drawingId,
  );
}

export function buildFrameDrawingLink(ctx) {
  const params = new URLSearchParams();
  if (ctx.projectId) params.set('projectId', ctx.projectId);
  if (ctx.moduleId) params.set('moduleId', ctx.moduleId);
  if (ctx.rackId) params.set('rackId', ctx.rackId);
  if (ctx.presetId) params.set('presetId', ctx.presetId);
  if (ctx.sourceType) params.set('source', ctx.sourceType);
  if (ctx.returnTo) params.set('returnTo', ctx.returnTo);
  if (ctx.rackLabel) params.set('rackLabel', ctx.rackLabel);
  if (ctx.projectName) params.set('projectName', ctx.projectName);
  if (ctx.drawingId) params.set('drawingId', ctx.drawingId);
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
  switch (ctx.sourceType) {
    case 'project_rack':
      return ctx.rackLabel
        ? `Стеллаж проекта: ${ctx.rackLabel}`
        : 'Стеллаж проекта';
    case 'module_rack':
      return ctx.rackLabel
        ? `Модуль / стеллаж: ${ctx.rackLabel}`
        : 'Стеллаж модуля';
    case 'preset':
      return ctx.rackLabel
        ? `Пресет: ${ctx.rackLabel}`
        : 'Пресет стеллажа';
    default:
      return '';
  }
}

export function buildFrameDrawingSavePayload(config, ctx, overrides = {}) {
  return {
    projectId: ctx.projectId || null,
    moduleId: ctx.moduleId || null,
    stellageId: ctx.rackId || null,
    presetId: ctx.presetId || null,
    sourceType: ctx.sourceType || 'standalone',
    title: overrides.title || buildFrameDrawingTitle(config, ctx),
    rackType: config?.rackType || '',
    frameConfigJson: config,
    isClientVisible: overrides.isClientVisible !== false,
    replace: Boolean(overrides.replace),
    drawingId: ctx.drawingId || overrides.drawingId || null,
  };
}
