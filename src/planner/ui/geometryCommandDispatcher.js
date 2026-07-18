/**
 * PHASE 1A-2A — UI orchestration boundary для executeGeometryCommand.
 *
 * Единственное место, где PlanPage должен вызывать executeGeometryCommand.
 * Чистый factory: принимает callbacks (getPlan/commitPlan/setSelection/
 * setRuntimeDiagnostic/showMessage), возвращает runGeometryCommand(command,
 * options). Не React-компонент — тестируется без рендера UI.
 *
 * Почему command вычисляется ДО commitPlan (а не внутри setPlan updater):
 * HistoryModel.mutate() создаёт checkpoint БЕЗУСЛОВНО при каждом вызове
 * setPlan, даже если updater возвращает тот же plan (см. PHASE 0F/0G/1A-1).
 * Если бы executeGeometryCommand вызывался внутри setPlan(p => ...), rejected
 * и no-op результаты создавали бы «пустой» undo-шаг (phantom checkpoint) —
 * именно этот баг был подтверждён у старых wall-align/wall-merge веток
 * PlanPage (PHASE 1A audit) и исправлен здесь структурно: commitPlan
 * вызывается РОВНО когда result.changed === true, и никогда иначе.
 */
import { executeGeometryCommand } from "../commands/geometryCommands.js";

export function createGeometryCommandDispatcher({
  getPlan,
  commitPlan,
  setSelection,
  setRuntimeDiagnostic,
  showMessage,
  makeId,
  roomSyncFn,
}) {
  return function runGeometryCommand(command, options = {}) {
    const context = { makeId, ...(roomSyncFn ? { roomSyncFn } : {}) };
    const plan = getPlan();
    const result = executeGeometryCommandSafe(plan, command, context, showMessage);
    if (!result) return null; // executeGeometryCommand само упало неожиданно — уже сообщено

    if (!result.ok) {
      // rejected: НЕ вызывать commitPlan, НЕ трогать selection, НЕ запускать
      // autosave (commitPlan вообще не вызван) — ровно требование PHASE 1A-1.
      safeCall(() => {
        if (setRuntimeDiagnostic && result.diagnostics?.length) setRuntimeDiagnostic(result.diagnostics[0]);
      });
      safeCall(() => {
        if (showMessage && result.error?.message) showMessage(result.error.message);
      });
      return result;
    }

    if (!result.changed) {
      // no-op: тот же контракт, что и rejected — ни commitPlan, ни checkpoint,
      // ни selection. Диагностика/уведомления по no-op намеренно не показываем —
      // «ничего не изменилось» не является ошибкой пользователя.
      return result;
    }

    // changed:true — ровно один commitPlan. Room sync уже выполнен внутри
    // executeGeometryCommand; здесь НЕ вызывать syncAutoZones/
    // refreshWallMountedItems повторно.
    try {
      commitPlan(result.plan);
    } catch (commitErr) {
      // Commit failure — plan НЕ закоммичен; side-effects, предполагающие
      // успешный commit (selection, diagnostic clear, warning), не должны
      // выполняться. Возвращаем structured failure, а не "успех без commit".
      console.error("[geometry-command-dispatcher] commitPlan failed", commitErr);
      const message = "Не удалось зафиксировать изменение плана.";
      if (showMessage) showMessage(message);
      return {
        ...result,
        ok: false,
        changed: false,
        error: { code: "GEOMETRY_COMMAND_COMMIT_FAILED", message },
      };
    }

    // Side-effects ПОСЛЕ commitPlan и НЕЗАВИСИМО друг от друга — исключение в
    // одном (напр. кастомный selectAfter) не должно откатывать или портить уже
    // закоммиченный plan и не должно блокировать остальные side-effects.
    safeCall(() => {
      if (setRuntimeDiagnostic) setRuntimeDiagnostic(result.diagnostics?.[0] || null);
    });
    safeCall(() => {
      if (options.selectAfter && setSelection) setSelection(options.selectAfter(result));
    });
    safeCall(() => {
      if (showMessage && result.warnings?.length && options.warningMessage) {
        // Одно объединённое сообщение на операцию, не alert на каждый warning.
        showMessage(options.warningMessage(result));
      }
    });

    return result;
  };
}

function executeGeometryCommandSafe(plan, command, context, showMessage) {
  try {
    return executeGeometryCommand(plan, command, context);
  } catch (err) {
    // executeGeometryCommand уже перехватывает свои внутренние исключения и
    // никогда не должна бросать — это защита от исключений в САМИХ callbacks
    // (getPlan/makeId), переданных в context/plan.
    console.error("[geometry-command-dispatcher] unexpected exception", err);
    if (showMessage) showMessage("Не удалось выполнить операцию с геометрией.");
    return null;
  }
}

function safeCall(fn) {
  try {
    fn();
  } catch (err) {
    console.error("[geometry-command-dispatcher] side-effect callback failed", err);
  }
}
