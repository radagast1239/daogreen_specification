import { mergeFrameBomIntoProjectItems, buildFrameBomSourceRackPrefix, isFrameBomItemForRack } from "../../shared/frameBomProjectItems.js";
import { visiblePurchaseDraftItems } from "./frameBomPurchasePreviewData.js";

export const FRAME_BOM_ADD_BUTTON_LABEL =
  "Добавить / обновить BOM этого стеллажа в закупке проекта";
export const FRAME_BOM_ADD_CONFIRM_TITLE =
  "Добавить / обновить BOM этого стеллажа в закупочном листе проекта?";
export const FRAME_BOM_ADD_BUTTON_HINT =
  "Повторное нажатие заменит BOM только этого стеллажа, ручные позиции проекта не трогаются.";
export const FRAME_BOM_NO_PROJECT_REASON =
  "Добавление в закупку доступно только внутри проекта.";
export const FRAME_BOM_UNSAVED_DRAWING_WARNING =
  "Чертёж ещё не сохранён. BOM будет привязан только к rackKey. Лучше сначала сохранить PDF/чертёж в проект.";
export const FRAME_SAVE_PDF_AND_BOM_BUTTON_LABEL =
  "Сохранить чертёж и добавить BOM в закупку";
export const FRAME_SAVE_PDF_ONLY_BUTTON_LABEL = "Сохранить только PDF";
export const FRAME_SAVE_PDF_AND_BOM_CONFIRM_TITLE =
  "Сохранить чертёж и добавить BOM этого стеллажа в закупочный лист проекта?";
export const FRAME_SAVE_PDF_AND_BOM_SUCCESS_TITLE =
  "Чертёж сохранён. BOM каркаса добавлен в закупочный лист проекта.";
export const FRAME_BOM_FROM_PROJECT_HINT =
  "Откройте конструктор из проекта, чтобы добавить BOM в закупку.";

/**
 * @param {{ moduleRackKey?: string, rackId?: string, stellageId?: string }} drawingContext
 */
export function resolveFrameBomModuleRackKey(drawingContext = {}) {
  const explicit = String(drawingContext.moduleRackKey || "").trim();
  if (explicit) return explicit;
  const stellageId = String(drawingContext.rackId || drawingContext.stellageId || "").trim();
  if (stellageId) return `stellage:${stellageId}`;
  return "";
}

export function findDraftMaterialsMissingInCatalog(purchaseDraft, materials) {
  if (!Array.isArray(materials) || materials.length === 0) return [];
  const ids = new Set(
    materials.map((m) => m.id || m.materialId).filter(Boolean),
  );
  return [
    ...new Set(
      visiblePurchaseDraftItems(purchaseDraft)
        .map((item) => item.materialId)
        .filter((id) => id && !ids.has(id)),
    ),
  ];
}

/**
 * @param {{
 *   projectId?: string,
 *   project?: { items?: object[] }|null,
 *   purchaseDraft?: object[],
 *   drawingContext?: object,
 *   materials?: object[]|null,
 * }} ctx
 */
export function evaluateFrameBomAddToProject({
  projectId,
  project,
  purchaseDraft,
  drawingContext = {},
  materials = null,
}) {
  const warnings = [];
  const visible = visiblePurchaseDraftItems(purchaseDraft || []);

  if (!projectId) {
    return {
      canAddToProject: false,
      addDisabledReason: FRAME_BOM_NO_PROJECT_REASON,
      warnings,
      missingMaterialIds: [],
      moduleRackKey: "",
    };
  }

  if (!project?.items) {
    return {
      canAddToProject: false,
      addDisabledReason: "Загрузка данных проекта…",
      warnings,
      missingMaterialIds: [],
      moduleRackKey: "",
    };
  }

  const moduleRackKey = resolveFrameBomModuleRackKey(drawingContext);
  const stellageId = String(drawingContext.rackId || drawingContext.stellageId || "").trim();
  if (!moduleRackKey && !stellageId) {
    return {
      canAddToProject: false,
      addDisabledReason: "Нет привязки к стеллажу (moduleRackKey или stellageId).",
      warnings,
      missingMaterialIds: [],
      moduleRackKey: "",
    };
  }

  if (!visible.length) {
    return {
      canAddToProject: false,
      addDisabledReason: "Нет рассчитанных позиций BOM для закупки.",
      warnings,
      missingMaterialIds: [],
      moduleRackKey,
    };
  }

  if (!drawingContext.drawingId) {
    warnings.push(FRAME_BOM_UNSAVED_DRAWING_WARNING);
  }

  const missingMaterialIds = materials
    ? findDraftMaterialsMissingInCatalog(purchaseDraft, materials)
    : [];

  if (materials && missingMaterialIds.length > 0) {
    return {
      canAddToProject: false,
      addDisabledReason: `Не найдены материалы: ${missingMaterialIds.join(", ")}`,
      warnings,
      missingMaterialIds,
      moduleRackKey,
    };
  }

  if (!materials?.length) {
    warnings.push("Проверьте, что материалы BOM есть в базе.");
  }

  return {
    canAddToProject: true,
    addDisabledReason: "",
    warnings,
    missingMaterialIds,
    moduleRackKey,
  };
}

/**
 * @param {{ items?: object[] }} project
 * @param {object[]} purchaseDraft
 * @param {object} drawingContext
 */
export function buildFrameBomProjectMerge(project, purchaseDraft, drawingContext = {}) {
  const existingItems = project?.items || [];
  const mergeResult = mergeFrameBomIntoProjectItems(existingItems, purchaseDraft, {
    projectId: drawingContext.projectId || "",
    drawingId: drawingContext.drawingId || "",
    moduleRackKey: resolveFrameBomModuleRackKey(drawingContext),
    stellageId: drawingContext.rackId || drawingContext.stellageId || "",
    rackLabel: drawingContext.rackLabel || "",
    visibleToClient: true,
    included: true,
  });
  return {
    mergeResult,
    patch: { items: mergeResult.items },
  };
}

export function formatFrameBomAddSuccessSummary(mergeResult) {
  return {
    title: "BOM каркаса добавлен в закупочный лист проекта.",
    addedCount: mergeResult.addedCount,
    removedCount: mergeResult.removedCount,
    keptCount: mergeResult.keptCount,
    sourceRackPrefix: mergeResult.sourceRackPrefix,
    warnings: mergeResult.warnings || [],
  };
}

export function countExistingFrameBomForRack(projectItems, drawingContext = {}) {
  const moduleRackKey = resolveFrameBomModuleRackKey(drawingContext);
  const { prefix } = buildFrameBomSourceRackPrefix({
    drawingId: drawingContext.drawingId,
    moduleRackKey,
  });
  if (!prefix) return 0;
  return (projectItems || []).filter((item) => isFrameBomItemForRack(item, prefix)).length;
}

/**
 * @param {{ addedPreviewCount: number, hasExistingBom?: boolean }} params
 */
export function buildFrameBomAddConfirmMessage({ addedPreviewCount, hasExistingBom = false }) {
  const actionLine = hasExistingBom
    ? "Старые BOM-позиции этого стеллажа будут заменены."
    : "Позиции BOM будут добавлены в закупочный лист.";
  return [
    `Будет добавлено: ${addedPreviewCount} позиций.`,
    actionLine,
    "Ручные позиции проекта не будут затронуты.",
    "",
    "Продолжить?",
  ].join("\n");
}

/**
 * @param {{
 *   project: { items?: object[] },
 *   purchaseDraft: object[],
 *   drawingContext: object,
 *   confirm: (opts: object) => Promise<boolean>,
 * }} params
 */
export async function requestFrameBomAddConfirmation({
  project,
  purchaseDraft,
  drawingContext,
  confirm,
}) {
  const addedPreviewCount = visiblePurchaseDraftItems(purchaseDraft).length;
  const hasExistingBom = countExistingFrameBomForRack(project?.items, drawingContext) > 0;
  const ok = await confirm({
    title: FRAME_BOM_ADD_CONFIRM_TITLE,
    message: buildFrameBomAddConfirmMessage({ addedPreviewCount, hasExistingBom }),
    confirmLabel: "Продолжить",
    cancelLabel: "Отмена",
  });
  return { ok: !!ok, addedPreviewCount, hasExistingBom };
}

/**
 * @param {{
 *   project: { items?: object[] },
 *   purchaseDraft: object[],
 *   drawingContext: object,
 *   confirm: (opts: object) => Promise<boolean>,
 *   updateProject: (projectId: string, patch: object) => Promise<object>,
 * }} params
 */
export async function executeFrameBomProjectAdd({
  project,
  purchaseDraft,
  drawingContext,
  confirm,
  updateProject,
}) {
  const projectId = drawingContext?.projectId;
  if (!projectId || !project?.items) {
    return { cancelled: false, skipped: true };
  }

  const confirmation = await requestFrameBomAddConfirmation({
    project,
    purchaseDraft,
    drawingContext,
    confirm,
  });
  if (!confirmation.ok) {
    return { cancelled: true };
  }

  return applyFrameBomProjectAdd({
    project,
    purchaseDraft,
    drawingContext,
    updateProject,
  }).then((result) => ({ cancelled: false, ...result }));
}

/**
 * @param {{
 *   project: { items?: object[] },
 *   purchaseDraft: object[],
 *   drawingContext: object,
 *   updateProject: (projectId: string, patch: object) => Promise<object>,
 * }} params
 */
export async function applyFrameBomProjectAdd({
  project,
  purchaseDraft,
  drawingContext,
  updateProject,
}) {
  const projectId = drawingContext?.projectId;
  if (!projectId || !project?.items) {
    return { skipped: true };
  }
  const ctx = { ...drawingContext, projectId };
  const { mergeResult, patch } = buildFrameBomProjectMerge(project, purchaseDraft, ctx);
  const updated = await updateProject(projectId, patch);
  return {
    updated,
    mergeResult,
    summary: formatFrameBomAddSuccessSummary(mergeResult),
  };
}

export function buildFrameSavePdfAndBomConfirmMessage() {
  return [
    "Старые BOM-позиции этого стеллажа будут заменены.",
    "Ручные позиции проекта не будут затронуты.",
    "",
    "Продолжить?",
  ].join("\n");
}

/**
 * @param {{ confirm: (opts: object) => Promise<boolean> }} params
 */
export async function requestFrameSavePdfAndBomConfirmation({ confirm }) {
  const ok = await confirm({
    title: FRAME_SAVE_PDF_AND_BOM_CONFIRM_TITLE,
    message: buildFrameSavePdfAndBomConfirmMessage(),
    confirmLabel: "Продолжить",
    cancelLabel: "Отмена",
  });
  return { ok: !!ok };
}

/**
 * @param {{
 *   projectId?: string,
 *   project?: { items?: object[] }|null,
 *   purchaseDraft?: object[],
 *   drawingContext?: object,
 *   materials?: object[]|null,
 * }} ctx
 */
export function evaluateFrameSavePdfAndBom(ctx) {
  const bomEval = evaluateFrameBomAddToProject(ctx);
  return {
    canSavePdfAndBom: bomEval.canAddToProject,
    addDisabledReason: bomEval.addDisabledReason,
    warnings: bomEval.warnings,
    bomEval,
  };
}

/**
 * @param {{ bomSummary: ReturnType<typeof formatFrameBomAddSuccessSummary> }} params
 */
export function formatFrameSavePdfAndBomSuccess({ bomSummary }) {
  return {
    title: FRAME_SAVE_PDF_AND_BOM_SUCCESS_TITLE,
    detail: `добавлено: ${bomSummary.addedCount}, заменено старых: ${bomSummary.removedCount}, оставлено прочих позиций: ${bomSummary.keptCount}`,
    bomSummary,
  };
}

/**
 * @param {{
 *   project: { items?: object[] },
 *   purchaseDraft: object[],
 *   drawingContext: object,
 *   updateProject: (projectId: string, patch: object) => Promise<object>,
 *   savedDrawing?: { id?: string }|null,
 * }} params
 */
export async function applyFrameBomProjectAddAfterPdfSave({
  project,
  purchaseDraft,
  drawingContext,
  updateProject,
  savedDrawing = null,
}) {
  const ctx = {
    ...drawingContext,
    projectId: drawingContext.projectId,
    drawingId: savedDrawing?.id || drawingContext.drawingId || "",
  };
  return applyFrameBomProjectAdd({
    project,
    purchaseDraft,
    drawingContext: ctx,
    updateProject,
  });
}

/**
 * @param {{
 *   confirm: (opts: object) => Promise<boolean>,
 *   savePdf: () => Promise<{ id?: string }|null>,
 *   project: { items?: object[] },
 *   purchaseDraft: object[],
 *   drawingContext: object,
 *   updateProject: (projectId: string, patch: object) => Promise<object>,
 * }} params
 */
export async function executeFrameSavePdfAndBom({
  confirm,
  savePdf,
  project,
  purchaseDraft,
  drawingContext,
  updateProject,
}) {
  const confirmation = await requestFrameSavePdfAndBomConfirmation({ confirm });
  if (!confirmation.ok) {
    return { cancelled: true };
  }

  const savedDrawing = await savePdf();
  const outcome = await applyFrameBomProjectAddAfterPdfSave({
    project,
    purchaseDraft,
    drawingContext,
    updateProject,
    savedDrawing,
  });
  if (outcome.skipped) {
    return { cancelled: false, savedDrawing, skipped: true };
  }

  return {
    cancelled: false,
    savedDrawing,
    ...outcome,
    combinedSummary: formatFrameSavePdfAndBomSuccess({ bomSummary: outcome.summary }),
  };
}
