import { buildFrameDrawingLink } from "./frameDrawingContext.js";
import {
  hasFrameBomRowsForRack,
  hasLegacyFrameBomRowsForRack,
  hasRepairableFrameBomForRack,
} from "./frameBomProjectItems.js";

export const FRAME_BOM_REFRESH_BUTTON_LABEL = "Обновить BOM";
export const FRAME_DRAWING_EDIT_SCHEME_LABEL = "Редактировать схему";
export const FRAME_DRAWING_OPEN_SCHEME_LABEL = "Открыть схему";

/**
 * @param {object} [context]
 */
export function frameBomRackOptionsFromContext(context = {}) {
  const stellageId = String(context.rackId || context.stellageId || "").trim();
  const moduleRackKey =
    String(context.moduleRackKey || "").trim()
    || (stellageId ? `stellage:${stellageId}` : "");
  return {
    projectId: String(context.projectId || "").trim(),
    drawingId: String(context.drawingId || "").trim(),
    moduleRackKey,
    stellageId,
    rackLabel: String(context.rackLabel || context.rackName || "").trim(),
  };
}

/**
 * @param {object} drawing
 */
export function drawingHasUsableRefreshContext(drawing) {
  if (!drawing) return false;
  if (String(drawing.id || drawing.drawingId || "").trim()) return true;
  if (drawing.frameConfig && typeof drawing.frameConfig === "object") return true;
  if (String(drawing.pdfUrl || "").trim()) return true;
  return false;
}

/**
 * Whether "Обновить BOM" should be enabled for a rack in saved specification.
 *
 * @param {{
 *   drawing?: object|null,
 *   drawings?: object[],
 *   projectItems?: object[],
 *   context?: object,
 *   hasRefreshHandler?: boolean,
 * }} params
 */
export function canRefreshFrameBom({
  drawing = null,
  drawings = [],
  projectItems = [],
  context = {},
  hasRefreshHandler = true,
} = {}) {
  if (!hasRefreshHandler) {
    return { enabled: false, reason: "Обновление BOM недоступно.", mode: null };
  }

  const rackOpts = frameBomRackOptionsFromContext(context);
  if (!rackOpts.projectId || !rackOpts.moduleRackKey) {
    return { enabled: false, reason: "Нет привязки к проекту или стеллажу.", mode: null };
  }

  const latest = drawing || drawings?.[0] || null;
  const hasDrawing = drawingHasUsableRefreshContext(latest)
    || Boolean(rackOpts.drawingId);
  const hasBom = hasFrameBomRowsForRack(projectItems, rackOpts);
  const hasLegacy = hasLegacyFrameBomRowsForRack(projectItems, rackOpts);
  const repairable = hasRepairableFrameBomForRack(projectItems, rackOpts);

  if (hasDrawing || hasBom || hasLegacy || repairable) {
    return {
      enabled: true,
      reason: "",
      mode: hasDrawing ? "full" : "dedupe",
      hasDrawing,
      hasBom,
      hasLegacy,
    };
  }

  return {
    enabled: false,
    reason: "Нет схемы и BOM-позиций для обновления.",
    mode: null,
    hasDrawing: false,
    hasBom: false,
    hasLegacy: false,
  };
}

/**
 * @param {string} label
 * @param {object} context
 */
export function resolveFrameDrawingActionBehavior(label, context = {}) {
  if (label === FRAME_BOM_REFRESH_BUTTON_LABEL) {
    return {
      action: "refresh_bom",
      navigates: false,
      opensConstructor: false,
      constructorTab: null,
      href: null,
    };
  }

  if (label === FRAME_DRAWING_OPEN_SCHEME_LABEL) {
    return {
      action: "open_scheme",
      navigates: true,
      opensConstructor: true,
      constructorTab: null,
      href: buildFrameDrawingLink(context),
    };
  }

  if (label === FRAME_DRAWING_EDIT_SCHEME_LABEL) {
    return {
      action: "edit_scheme",
      navigates: true,
      opensConstructor: true,
      constructorTab: null,
      href: buildFrameDrawingLink(context),
    };
  }

  return {
    action: "navigate",
    navigates: true,
    opensConstructor: true,
    constructorTab: context.constructorTab || null,
    href: buildFrameDrawingLink(context),
  };
}
