import {
  mergeFrameBomIntoProjectItems,
  buildFrameBomRepairPlan,
  buildLegacyFrameBomDedupePlan,
  buildResidualFrameBomTwinRepairPlan,
  frameBomItemsForModuleRack,
  findMissingFrameBomMaterials,
  formatFrameBomMissingMaterialsMessage,
} from "../../shared/frameBomProjectItems.js";
import {
  visiblePurchaseDraftItems,
  buildFramePurchaseDraftFromFrameConfig,
} from "./frameBomPurchasePreviewData.js";
import {
  FRAME_BOM_REFRESH_BUTTON_LABEL,
  FRAME_DRAWING_EDIT_SCHEME_LABEL,
  FRAME_DRAWING_OPEN_SCHEME_LABEL,
} from "../../shared/frameDrawingActionsModel.js";

export {
  FRAME_BOM_REFRESH_BUTTON_LABEL,
  FRAME_DRAWING_EDIT_SCHEME_LABEL,
  FRAME_DRAWING_OPEN_SCHEME_LABEL,
};

export const FRAME_BOM_ADD_BUTTON_LABEL =
  "Добавить / обновить BOM этого стеллажа в закупке проекта";
export const FRAME_BOM_ADD_CONFIRM_TITLE =
  "Добавить / обновить BOM этого стеллажа в закупочном листе проекта?";
export const FRAME_BOM_ADD_BUTTON_HINT =
  "Повторное нажатие заменит BOM только этого стеллажа, ручные позиции проекта не трогаются.";
export const FRAME_BOM_UPDATE_BOM_HINT =
  "Обновить BOM — пересоберёт только позиции каркаса этого стеллажа. Обычные материалы стеллажа не трогаются.";
export const FRAME_BOM_REFRESH_CONFIRM_TITLE = "Обновить BOM этого стеллажа в спецификации?";
export const FRAME_BOM_REFRESH_SUCCESS_TITLE = "BOM каркаса обновлён.";
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
  return findMissingFrameBomMaterials(purchaseDraft, materials);
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

  if (!materials?.length) {
    return {
      canAddToProject: false,
      addDisabledReason: "Загрузка каталога материалов…",
      warnings,
      missingMaterialIds: [],
      moduleRackKey,
    };
  }

  const missingMaterialIds = findDraftMaterialsMissingInCatalog(purchaseDraft, materials);

  if (missingMaterialIds.length > 0) {
    return {
      canAddToProject: false,
      addDisabledReason: formatFrameBomMissingMaterialsMessage(missingMaterialIds),
      warnings,
      missingMaterialIds,
      moduleRackKey,
    };
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
export function buildFrameBomProjectMerge(project, purchaseDraft, drawingContext = {}, materials = null) {
  const existingItems = project?.items || [];
  const mergeResult = mergeFrameBomIntoProjectItems(existingItems, purchaseDraft, {
    projectId: drawingContext.projectId || "",
    drawingId: drawingContext.drawingId || "",
    moduleRackKey: resolveFrameBomModuleRackKey(drawingContext),
    stellageId: drawingContext.rackId || drawingContext.stellageId || "",
    rackLabel: drawingContext.rackLabel || "",
    visibleToClient: true,
    included: true,
    materials: materials || undefined,
  });
  if (mergeResult.blocked) {
    const err = new Error(mergeResult.blockedReason || "BOM не добавлен: материалы не найдены в базе.");
    err.missingMaterialIds = mergeResult.missingMaterialIds || [];
    throw err;
  }
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

export function buildFrameBomMergeOptions(drawingContext = {}, materials = null) {
  return {
    projectId: drawingContext.projectId || "",
    drawingId: drawingContext.drawingId || "",
    moduleRackKey: resolveFrameBomModuleRackKey(drawingContext),
    stellageId: drawingContext.rackId || drawingContext.stellageId || "",
    rackLabel: drawingContext.rackLabel || "",
    visibleToClient: true,
    included: true,
    materials: materials || undefined,
  };
}

export function buildFrameBomRefreshConfirmMessage({
  frameBomCount = 0,
  safeDuplicateCount = 0,
  preservedOtherCount = 0,
  // legacy aliases (ignored for wording)
  removeCount,
  upsertCount,
} = {}) {
  const frameCount = Number(frameBomCount) || 0;
  const safeDupes = Number(safeDuplicateCount) || 0;
  const preserved = Number(preservedOtherCount) || 0;
  return [
    "Будет пересобран BOM каркаса по сохранённой схеме.",
    "",
    `Позиций каркаса сейчас: ${frameCount}`,
    `Безопасных дублей BOM: ${safeDupes}`,
    `Остальные позиции стеллажа: ${preserved} — не будут изменены.`,
    "",
    "Продолжить?",
  ].join("\n");
}

/**
 * @param {string} projectId
 * @param {string[]} itemIds
 * @param {(projectId: string, itemId: string) => Promise<void>} deleteItem
 */
export async function deleteProjectItemsByIds(projectId, itemIds, deleteItem) {
  const deleted = [];
  const errors = [];
  for (const itemId of itemIds || []) {
    const id = String(itemId || "").trim();
    if (!id) continue;
    try {
      await deleteItem(projectId, id);
      deleted.push(id);
    } catch (e) {
      if (e?.status === 404) continue;
      errors.push({ itemId: id, message: e?.message || String(e) });
    }
  }
  return { deleted, errors };
}

/**
 * @param {{
 *   project: { items?: object[], id?: string },
 *   drawingContext: object,
 *   deleteItem: (projectId: string, itemId: string) => Promise<void>,
 *   updateProject: (projectId: string, patch: object) => Promise<object>,
 *   loadProject?: (projectId: string) => Promise<object>,
 * }} params
 */
export async function applyFrameBomLegacyDedupeRepair({
  project,
  drawingContext,
  deleteItem,
  updateProject,
  loadProject = null,
}) {
  const projectId = drawingContext?.projectId || project?.id;
  if (!projectId || !project?.items) {
    return { skipped: true };
  }

  const plan = buildLegacyFrameBomDedupePlan(
    project.items,
    buildFrameBomMergeOptions(drawingContext, null),
  );

  if (plan.blocked) {
    const err = new Error(plan.blockedReason || "BOM не обновлён.");
    err.plan = plan;
    throw err;
  }

  const deleteResult = await deleteProjectItemsByIds(projectId, plan.removeItemIds, deleteItem);
  if (deleteResult.errors.length) {
    const err = new Error(
      `Не удалось удалить ${deleteResult.errors.length} legacy-позиций BOM.`,
    );
    err.deleteErrors = deleteResult.errors;
    throw err;
  }

  const updated = await updateProject(projectId, { items: plan.cleanedItems });
  const reloaded = loadProject ? await loadProject(projectId) : updated;

  return {
    plan,
    updated: reloaded,
    deleteResult,
    summary: {
      title: FRAME_BOM_REFRESH_SUCCESS_TITLE,
      removedCount: plan.removeItemIds.length,
      addedCount: 0,
      upsertCount: 0,
      deletedIds: deleteResult.deleted,
      mode: "legacy_dedupe",
    },
  };
}

/**
 * Project-wide residual twin cleanup (st__it_fbom / st__ln vs canonical it_fbom).
 * Does not require drawingContext / purchaseDraft.
 */
export async function applyResidualFrameBomTwinRepair({
  project,
  deleteItem,
  updateProject,
  loadProject = null,
}) {
  const projectId = project?.id;
  if (!projectId || !project?.items) {
    return { skipped: true };
  }

  const plan = buildResidualFrameBomTwinRepairPlan(project.items);
  if (plan.blocked) {
    const err = new Error(plan.blockedReason || "Дубли BOM не найдены.");
    err.plan = plan;
    throw err;
  }

  const deleteResult = await deleteProjectItemsByIds(projectId, plan.removeItemIds, deleteItem);
  if (deleteResult.errors.length) {
    const err = new Error(
      `Не удалось удалить ${deleteResult.errors.length} дублей BOM.`,
    );
    err.deleteErrors = deleteResult.errors;
    throw err;
  }

  const updated = await updateProject(projectId, { items: plan.cleanedItems });
  const reloaded = loadProject ? await loadProject(projectId) : updated;

  return {
    plan,
    updated: reloaded,
    deleteResult,
    summary: {
      title: "Удалены дубли BOM каркаса.",
      removedCount: plan.removeItemIds.length,
      addedCount: 0,
      upsertCount: 0,
      deletedIds: deleteResult.deleted,
      mode: "residual_twins",
    },
  };
}

/**
 * @param {{
 *   project: { items?: object[], id?: string },
 *   purchaseDraft: object[],
 *   drawingContext: object,
 *   materials?: object[]|null,
 *   deleteItem: (projectId: string, itemId: string) => Promise<void>,
 *   updateProject: (projectId: string, patch: object) => Promise<object>,
 *   loadProject?: (projectId: string) => Promise<object>,
 * }} params
 */
export async function applyFrameBomRefreshRepair({
  project,
  purchaseDraft,
  drawingContext,
  materials = null,
  deleteItem,
  updateProject,
  loadProject = null,
}) {
  const projectId = drawingContext?.projectId || project?.id;
  if (!projectId || !project?.items) {
    return { skipped: true };
  }

  const plan = buildFrameBomRepairPlan(
    project.items,
    purchaseDraft,
    buildFrameBomMergeOptions({ ...drawingContext, projectId }, materials),
  );

  if (plan.blocked) {
    const err = new Error(plan.blockedReason || "BOM не обновлён.");
    err.missingMaterialIds = plan.missingMaterialIds || [];
    throw err;
  }

  const deleteResult = await deleteProjectItemsByIds(projectId, plan.removeItemIds, deleteItem);
  if (deleteResult.errors.length) {
    const err = new Error(
      `Не удалось удалить ${deleteResult.errors.length} legacy-позиций BOM.`,
    );
    err.deleteErrors = deleteResult.errors;
    throw err;
  }

  const updated = await updateProject(projectId, { items: plan.cleanedItems });
  const reloaded = loadProject ? await loadProject(projectId) : updated;

  return {
    plan,
    updated: reloaded,
    deleteResult,
    summary: {
      title: FRAME_BOM_REFRESH_SUCCESS_TITLE,
      removedCount: plan.removeItemIds.length,
      addedCount: plan.debug?.addedCount ?? 0,
      upsertCount: plan.upsertItems.length,
      deletedIds: deleteResult.deleted,
    },
  };
}

/**
 * @param {{
 *   project: { items?: object[], id?: string },
 *   drawing: { id?: string, frameConfig?: object }|null,
 *   drawingContext: object,
 *   materials?: object[]|null,
 *   confirm?: (opts: object) => Promise<boolean>,
 *   deleteItem: (projectId: string, itemId: string) => Promise<void>,
 *   updateProject: (projectId: string, patch: object) => Promise<object>,
 *   loadProject?: (projectId: string) => Promise<object>,
 * }} params
 */
export async function executeFrameBomRefreshFromDrawing({
  project,
  drawing,
  drawingContext,
  materials = null,
  confirm = null,
  deleteItem,
  updateProject,
  loadProject = null,
}) {
  const projectId = drawingContext?.projectId || project?.id;
  if (!projectId || !project?.items) {
    return { cancelled: false, skipped: true };
  }

  const ctx = {
    ...drawingContext,
    projectId,
    drawingId: drawing?.id || drawingContext.drawingId || "",
  };

  if (!drawing?.frameConfig) {
    const dedupePreview = buildLegacyFrameBomDedupePlan(
      project.items,
      buildFrameBomMergeOptions(ctx, null),
    );
    if (dedupePreview.blocked) {
      throw new Error(dedupePreview.blockedReason || "Не найдена схема для пересборки BOM.");
    }
    if (confirm) {
      const ok = await confirm({
        title: FRAME_BOM_REFRESH_CONFIRM_TITLE,
        message: buildFrameBomRefreshConfirmMessage({
          frameBomCount: dedupePreview.frameBomCount
            ?? dedupePreview.debug?.inScopeCount
            ?? 0,
          safeDuplicateCount: dedupePreview.safeDuplicateCount
            ?? dedupePreview.removeItemIds.length,
          preservedOtherCount: dedupePreview.preservedOtherCount
            ?? dedupePreview.preservedItems?.length
            ?? 0,
        }),
        confirmLabel: "Обновить BOM",
        cancelLabel: "Отмена",
      });
      if (!ok) return { cancelled: true };
    }
    const outcome = await applyFrameBomLegacyDedupeRepair({
      project,
      drawingContext: ctx,
      deleteItem,
      updateProject,
      loadProject,
    });
    return { cancelled: false, ...outcome };
  }

  const purchaseDraft = buildFramePurchaseDraftFromFrameConfig(drawing.frameConfig);
  const visible = visiblePurchaseDraftItems(purchaseDraft);
  if (!visible.length) {
    throw new Error("По сохранённой схеме не удалось рассчитать BOM.");
  }

  const evalResult = evaluateFrameBomAddToProject({
    projectId,
    project,
    purchaseDraft,
    drawingContext: ctx,
    materials,
  });
  if (!evalResult.canAddToProject) {
    throw new Error(evalResult.addDisabledReason || "BOM нельзя обновить.");
  }

  const previewPlan = buildFrameBomRepairPlan(
    project.items,
    purchaseDraft,
    buildFrameBomMergeOptions(ctx, materials),
  );
  if (previewPlan.blocked) {
    throw new Error(previewPlan.blockedReason || "BOM не обновлён.");
  }

  if (confirm) {
    const ok = await confirm({
      title: FRAME_BOM_REFRESH_CONFIRM_TITLE,
      message: buildFrameBomRefreshConfirmMessage({
        frameBomCount: previewPlan.frameBomCount ?? 0,
        safeDuplicateCount: previewPlan.safeDuplicateCount ?? 0,
        preservedOtherCount: previewPlan.preservedOtherCount
          ?? previewPlan.preservedItems?.length
          ?? 0,
      }),
      confirmLabel: "Обновить BOM",
      cancelLabel: "Отмена",
    });
    if (!ok) return { cancelled: true };
  }

  const outcome = await applyFrameBomRefreshRepair({
    project,
    purchaseDraft,
    drawingContext: ctx,
    materials,
    deleteItem,
    updateProject,
    loadProject,
  });

  return { cancelled: false, ...outcome };
}

export function countExistingFrameBomForRack(projectItems, drawingContext = {}) {
  const moduleRackKey = resolveFrameBomModuleRackKey(drawingContext);
  if (!moduleRackKey) return 0;
  return frameBomItemsForModuleRack(projectItems, moduleRackKey).length;
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
  materials = null,
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
    materials,
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
  materials = null,
}) {
  const projectId = drawingContext?.projectId;
  if (!projectId || !project?.items) {
    return { skipped: true };
  }
  const ctx = { ...drawingContext, projectId };
  const { mergeResult, patch } = buildFrameBomProjectMerge(project, purchaseDraft, ctx, materials);
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
  materials = null,
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
    materials,
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
  materials = null,
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
    materials,
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
