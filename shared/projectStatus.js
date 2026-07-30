/** Ручной workflow-статус проекта + автоготовность к отправке (pure helpers). */

export const PROJECT_STATUS = {
  DRAFT: "draft", // lifecycle: мастер настройки — не из HQ dropdown
  ACTIVE: "active", // HQ «Черновик» (legacy default)
  IN_PROGRESS: "in_progress",
  ON_REVIEW: "on_review",
  READY_TO_SEND: "ready_to_send",
  SENT_TO_CLIENT: "sent_to_client",
  CLIENT_BUYING: "client_buying",
  PURCHASE_COMPLETE: "purchase_complete",
  CLOSED: "closed",
  ARCHIVED: "archived",
};

/** Статусы, доступные в HQ dropdown (не draft/archived). */
export const PROJECT_WORKFLOW_STATUSES = [
  { id: PROJECT_STATUS.ACTIVE, label: "Черновик" },
  { id: PROJECT_STATUS.IN_PROGRESS, label: "В работе" },
  { id: PROJECT_STATUS.ON_REVIEW, label: "На проверке" },
  { id: PROJECT_STATUS.READY_TO_SEND, label: "Готов к отправке" },
  { id: PROJECT_STATUS.SENT_TO_CLIENT, label: "Отправлен клиенту" },
  { id: PROJECT_STATUS.CLIENT_BUYING, label: "Клиент закупает" },
  { id: PROJECT_STATUS.PURCHASE_COMPLETE, label: "Закупка завершена" },
  { id: PROJECT_STATUS.CLOSED, label: "Закрыт" },
];

const WORKFLOW_IDS = new Set(PROJECT_WORKFLOW_STATUSES.map((s) => s.id));

/** Фильтры списка проектов. */
export const PROJECT_STATUS_LIST_FILTERS = [
  { id: "all", label: "Все", statusIds: null },
  {
    id: "drafts",
    label: "Черновики",
    statusIds: [PROJECT_STATUS.ACTIVE],
  },
  {
    id: "in_progress",
    label: "В работе",
    statusIds: [PROJECT_STATUS.IN_PROGRESS],
  },
  {
    id: "on_review",
    label: "На проверке",
    statusIds: [PROJECT_STATUS.ON_REVIEW],
  },
  {
    id: "ready",
    label: "Готовы",
    statusIds: [PROJECT_STATUS.READY_TO_SEND],
  },
  {
    id: "sent",
    label: "Отправлены",
    statusIds: [PROJECT_STATUS.SENT_TO_CLIENT],
  },
  {
    id: "buying",
    label: "Закупка",
    statusIds: [PROJECT_STATUS.CLIENT_BUYING, PROJECT_STATUS.PURCHASE_COMPLETE],
  },
  {
    id: "closed",
    label: "Закрытые",
    statusIds: [PROJECT_STATUS.CLOSED],
  },
];

/** Критично для «готовности выдачи» / подтверждения «Готов к отправке». */
export const PROJECT_SEND_CRITICAL_KEYS = [
  "no_price",
  "no_supplier",
  "needs_review",
  "not_fit",
  "replacement_check",
];

/**
 * Нормализация для lifecycle/HQ.
 * Unknown/empty → active (Черновик) только для отображения/сравнения — не мутирует project.
 */
export function normalizeProjectStatus(raw) {
  const s = String(raw || "").trim();
  if (!s) return PROJECT_STATUS.ACTIVE;
  if (s === PROJECT_STATUS.DRAFT) return PROJECT_STATUS.DRAFT;
  if (s === PROJECT_STATUS.ARCHIVED) return PROJECT_STATUS.ARCHIVED;
  if (WORKFLOW_IDS.has(s)) return s;
  return PROJECT_STATUS.ACTIVE;
}

export function getProjectStatusLabel(raw) {
  const id = normalizeProjectStatus(raw);
  if (id === PROJECT_STATUS.DRAFT) return "В настройке";
  if (id === PROJECT_STATUS.ARCHIVED) return "Архив";
  const row = PROJECT_WORKFLOW_STATUSES.find((s) => s.id === id);
  return row?.label || "Черновик";
}

/** Значение для записи в DB при выборе в HQ (Черновик → active, не draft). */
export function resolveProjectStatusForSave(selectedId) {
  const id = String(selectedId || "").trim();
  if (id === PROJECT_STATUS.DRAFT) return PROJECT_STATUS.ACTIVE;
  if (id === PROJECT_STATUS.ARCHIVED) return PROJECT_STATUS.ARCHIVED;
  if (WORKFLOW_IDS.has(id)) return id;
  return PROJECT_STATUS.ACTIVE;
}

export function isProjectStatusActiveLifecycle(status) {
  const id = normalizeProjectStatus(status);
  return id !== PROJECT_STATUS.DRAFT && id !== PROJECT_STATUS.ARCHIVED;
}

export function projectMatchesStatusFilter(project, filterId) {
  if (!filterId || filterId === "all") return true;
  const filter = PROJECT_STATUS_LIST_FILTERS.find((f) => f.id === filterId);
  if (!filter || !filter.statusIds) return true;
  const id = normalizeProjectStatus(project?.status);
  // unknown/empty already normalized to active → Черновики
  return filter.statusIds.includes(id);
}

export function projectStatusNeedsConfirm(statusId) {
  const id = resolveProjectStatusForSave(statusId);
  return id === PROJECT_STATUS.PURCHASE_COMPLETE || id === PROJECT_STATUS.CLOSED;
}

/**
 * @param {object} checklist — результат buildProjectPreSendChecklist
 * @param {object} [options]
 * @param {object[]} [options.items] — для EMPTY, если checklist без clientTotalCount
 */
export function buildProjectSendReadiness(checklist, options = {}) {
  const clientTotalCount = Number(
    checklist?.clientTotalCount ?? checklist?.clientVisibleCount ?? 0
  );

  // Empty / not started: no client-facing positions to send.
  if (clientTotalCount === 0) {
    return {
      status: "empty",
      tone: "neutral",
      title: "Проект ещё не заполнен",
      shortTitle: "Не заполнен",
      criticalCount: 0,
      countsByKey: Object.fromEntries(PROJECT_SEND_CRITICAL_KEYS.map((k) => [k, 0])),
      detailLines: [],
      noLinkCount: Number(checklist?.noLinkCount) || 0,
      isEmpty: true,
      isReady: false,
      isBlocker: false,
    };
  }

  const groups = Array.isArray(checklist?.groups) ? checklist.groups : [];
  const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
  const countsByKey = {};
  const detailLines = [];
  let criticalCount = 0;

  for (const key of PROJECT_SEND_CRITICAL_KEYS) {
    const g = byKey[key];
    const count = Number(g?.count) || 0;
    countsByKey[key] = count;
    if (count > 0) {
      criticalCount += count;
      detailLines.push({
        key,
        label: g?.label || key,
        count,
        filterKey: g?.filterKey || key,
      });
    }
  }

  // no_link must never affect readiness
  const noLinkCount = Number(byKey.no_link?.count) || Number(checklist?.noLinkCount) || 0;

  const ok = criticalCount === 0;
  return {
    status: ok ? "ok" : "problems",
    tone: ok ? "ok" : "bad",
    title: ok ? "Готово к отправке" : `Не готово: ${criticalCount} ${pluralProblems(criticalCount)}`,
    shortTitle: ok ? "Готово" : `Не готово: ${criticalCount}`,
    criticalCount,
    countsByKey,
    detailLines,
    noLinkCount,
    isEmpty: false,
    isReady: ok,
    isBlocker: !ok,
  };
}

function pluralProblems(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "проблема";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "проблемы";
  return "проблем";
}

export function shouldConfirmReadyToSend(statusId, readiness) {
  return (
    resolveProjectStatusForSave(statusId) === PROJECT_STATUS.READY_TO_SEND &&
    Number(readiness?.criticalCount) > 0
  );
}

export function buildReadyToSendConfirmText(readiness) {
  const n = Number(readiness?.criticalCount) || 0;
  const lines = (readiness?.detailLines || [])
    .map((d) => `— ${d.label.toLowerCase()}: ${d.count}`)
    .join("\n");
  return `В проекте осталось ${n} критические проблемы:\n${lines}\n\nВсё равно отметить проект готовым?`;
}

export function buildReadyToSendConfirmMessage(readiness) {
  return buildReadyToSendConfirmText(readiness);
}
