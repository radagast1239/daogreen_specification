/**
 * Atomic Frame BOM refresh for one rack.
 *
 * PDF binary upload/swap stays outside this transaction (separate upload flow).
 * Residual risk: if a future flow swaps PDF bytes and then fails BOM refresh,
 * the PDF file on disk may diverge from DB metadata until a retry — this phase
 * only updates optional drawing metadata (title/visibility) inside the txn.
 */
import { db, loadProject } from "../db.js";
import { listMaterials } from "../routes/materials.js";
import { logProjectEvent } from "./activityLog.js";
import {
  buildFrameBomRepairPlan,
  buildLegacyFrameBomDedupePlan,
  isExplicitManualProjectItem,
  isFrameBomLine,
  isProvenLegacyFrameBomTwin,
  isCanonicalFrameBomLine,
  itemBelongsToRackMergeScope,
  shouldRemoveFrameBomOnMerge,
} from "../../../shared/frameBomProjectItems.js";

export class FrameBomRefreshError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "FrameBomRefreshError";
    this.code = code;
    this.status = status;
  }
}

function resolveModuleRackKey(body = {}) {
  const explicit = String(body.moduleRackKey || "").trim();
  if (explicit) return explicit;
  const stellageId = String(body.stellageId || "").trim();
  if (stellageId) return `stellage:${stellageId}`;
  return "";
}

function loadDrawingRow(drawingId) {
  if (!drawingId) return null;
  return db.prepare("SELECT * FROM frame_drawings WHERE id = ?").get(drawingId) || null;
}

function parseExpectedRevision(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function assertSafeRemoveItemIds(removeItemIds, existingItems, moduleRackKey, options) {
  const byId = new Map((existingItems || []).map((it) => [String(it.id || ""), it]));
  const canons = (existingItems || []).filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  const mergeOpts = { ...options, allItems: existingItems, existingItems };

  for (const rawId of removeItemIds || []) {
    const id = String(rawId || "").trim();
    if (!id) continue;
    const item = byId.get(id);
    if (!item) {
      throw new FrameBomRefreshError(
        "FRAME_BOM_REFRESH_UNSAFE_DELETE",
        `Нельзя удалить неизвестную позицию: ${id}`,
        409,
      );
    }
    if (isExplicitManualProjectItem(item)) {
      throw new FrameBomRefreshError(
        "FRAME_BOM_REFRESH_UNSAFE_DELETE",
        "Нельзя удалить ручную позицию при обновлении BOM.",
        409,
      );
    }
    if (!itemBelongsToRackMergeScope(item, moduleRackKey, options)) {
      throw new FrameBomRefreshError(
        "FRAME_BOM_REFRESH_UNSAFE_DELETE",
        "Нельзя удалить позицию другого стеллажа при обновлении BOM.",
        409,
      );
    }
    const allowed =
      shouldRemoveFrameBomOnMerge(item, moduleRackKey, mergeOpts)
      || isFrameBomLine(item)
      || isProvenLegacyFrameBomTwin(item, canons);
    if (!allowed) {
      throw new FrameBomRefreshError(
        "FRAME_BOM_REFRESH_UNSAFE_DELETE",
        "Обновление BOM отменено: в удаление попала позиция вне BOM каркаса.",
        409,
      );
    }
  }
}

function applyDrawingMetaWithin(drawingId, projectId, drawingMeta) {
  if (!drawingMeta || typeof drawingMeta !== "object") return false;
  const row = db
    .prepare("SELECT id, project_id FROM frame_drawings WHERE id = ?")
    .get(drawingId);
  if (!row) {
    throw new FrameBomRefreshError(
      "FRAME_BOM_REFRESH_INVALID",
      "Чертёж для обновления метаданных не найден.",
      400,
    );
  }
  if (row.project_id && String(row.project_id) !== String(projectId)) {
    throw new FrameBomRefreshError(
      "FRAME_BOM_REFRESH_INVALID",
      "Чертёж принадлежит другому проекту.",
      400,
    );
  }

  const sets = [];
  const params = [];
  if (drawingMeta.title != null) {
    sets.push("title = ?");
    params.push(String(drawingMeta.title));
  }
  if (drawingMeta.isClientVisible != null || drawingMeta.is_client_visible != null) {
    const vis = drawingMeta.isClientVisible ?? drawingMeta.is_client_visible;
    sets.push("is_client_visible = ?");
    params.push(vis ? 1 : 0);
  }
  if (!sets.length) return false;
  sets.push("updated_at = datetime('now')");
  params.push(drawingId);
  db.prepare(`UPDATE frame_drawings SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return true;
}

function bumpProjectRevisionOptimistic(projectId, expectedRevision) {
  const result = db
    .prepare(
      `UPDATE projects
       SET revision = COALESCE(revision, 0) + 1, updated_at = datetime('now')
       WHERE id = ? AND COALESCE(revision, 0) = ?`,
    )
    .run(projectId, expectedRevision);
  if (result.changes !== 1) {
    const current = db.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId);
    throw new FrameBomRefreshError(
      "PROJECT_REVISION_CONFLICT",
      "Проект изменился. Обновите страницу и повторите обновление BOM.",
      409,
    );
  }
  const row = db.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId);
  return Number(row?.revision) || expectedRevision + 1;
}

/**
 * @param {string} projectId
 * @param {object} body
 * @param {{ saveItemsWithin: Function }} deps
 */
export function refreshFrameBomProject(projectId, body = {}, deps) {
  if (!deps?.saveItemsWithin) {
    throw new Error("saveItemsWithin is required");
  }

  const project = loadProject(projectId);
  if (!project) {
    throw new FrameBomRefreshError("FRAME_BOM_REFRESH_INVALID", "Проект не найден.", 404);
  }

  const expectedRevision = parseExpectedRevision(body.expectedRevision);
  if (expectedRevision == null) {
    throw new FrameBomRefreshError(
      "FRAME_BOM_REFRESH_INVALID",
      "expectedRevision обязателен для атомарного обновления BOM.",
      400,
    );
  }

  const moduleRackKey = resolveModuleRackKey(body);
  const stellageId = String(body.stellageId || "").trim();
  if (!moduleRackKey && !stellageId) {
    throw new FrameBomRefreshError(
      "FRAME_BOM_REFRESH_INVALID",
      "Нет привязки к стеллажу (moduleRackKey или stellageId).",
      400,
    );
  }

  const rackKey = moduleRackKey || `stellage:${stellageId}`;
  const drawingId = String(body.drawingId || "").trim();
  const mode = String(body.mode || "full").trim() || "full";
  const rackLabel = String(body.rackLabel || "").trim();
  const materials = listMaterials();

  const options = {
    projectId,
    drawingId,
    moduleRackKey: rackKey,
    stellageId,
    rackLabel,
    visibleToClient: true,
    included: true,
    materials,
  };

  let plan;
  if (mode === "legacy_dedupe") {
    plan = buildLegacyFrameBomDedupePlan(project.items || [], options);
  } else {
    if (!Array.isArray(body.purchaseDraft)) {
      throw new FrameBomRefreshError(
        "FRAME_BOM_REFRESH_INVALID",
        "Для полного обновления BOM нужен purchaseDraft (или режим legacy_dedupe).",
        400,
      );
    }
    plan = buildFrameBomRepairPlan(project.items || [], body.purchaseDraft, options);
  }

  if (plan.blocked) {
    const code = plan.invariantViolation || /обычные позиции стеллажа/i.test(plan.blockedReason || "")
      ? "FRAME_BOM_REFRESH_UNSAFE_DELETE"
      : "FRAME_BOM_REFRESH_INVALID";
    throw new FrameBomRefreshError(
      code,
      plan.blockedReason || "Обновление BOM отменено.",
      code === "FRAME_BOM_REFRESH_UNSAFE_DELETE" ? 409 : 400,
    );
  }

  assertSafeRemoveItemIds(plan.removeItemIds, project.items || [], rackKey, options);

  const run = db.transaction(() => {
    // Re-check revision inside IMMEDIATE txn so concurrent refresh conflicts safely.
    const row = db.prepare("SELECT COALESCE(revision, 0) AS revision FROM projects WHERE id = ?").get(projectId);
    if (!row) {
      throw new FrameBomRefreshError("FRAME_BOM_REFRESH_INVALID", "Проект не найден.", 404);
    }
    if (Number(row.revision) !== expectedRevision) {
      throw new FrameBomRefreshError(
        "PROJECT_REVISION_CONFLICT",
        "Проект изменился. Обновите страницу и повторите обновление BOM.",
        409,
      );
    }

    deps.saveItemsWithin(projectId, plan.cleanedItems);

    if (process.env.NODE_ENV === "test" && body.__testThrowAfterItems) {
      throw new Error("artificial mid-transaction failure");
    }

    let drawingMetaUpdated = false;
    if (drawingId && body.drawingMeta) {
      drawingMetaUpdated = applyDrawingMetaWithin(drawingId, projectId, body.drawingMeta);
    }

    if (process.env.NODE_ENV === "test" && body.__testThrowAfterDrawingMeta) {
      throw new Error("artificial drawing-meta failure");
    }

    const revision = bumpProjectRevisionOptimistic(projectId, expectedRevision);

    logProjectEvent({
      projectId,
      actor: "admin",
      summary: `Обновлён BOM каркаса (${rackLabel || rackKey}): −${plan.removeItemIds.length}, +${plan.debug?.addedCount ?? plan.upsertItems?.length ?? 0}`,
      clientVisible: false,
    });

    return { revision, drawingMetaUpdated };
  });

  const txnResult = run();
  const updated = loadProject(projectId);
  return {
    project: updated,
    revision: txnResult.revision,
    summary: {
      title: "BOM каркаса обновлён.",
      mode,
      removedCount: plan.removeItemIds.length,
      addedCount: plan.debug?.addedCount ?? 0,
      upsertCount: plan.upsertItems?.length ?? 0,
      safeDuplicateCount: plan.safeDuplicateCount ?? 0,
      preservedOtherCount: plan.preservedOtherCount ?? 0,
      frameBomCount: plan.frameBomCount ?? 0,
      removeItemIds: plan.removeItemIds,
      drawingMetaUpdated: txnResult.drawingMetaUpdated,
      pdfLifecycleNote:
        "PDF binary upload remains outside this transaction; only optional drawing metadata is updated atomically with BOM.",
    },
    plan: {
      blocked: false,
      removeItemIds: plan.removeItemIds,
      frameBomCount: plan.frameBomCount,
      safeDuplicateCount: plan.safeDuplicateCount,
      preservedOtherCount: plan.preservedOtherCount,
      warnings: plan.warnings || [],
    },
  };
}
