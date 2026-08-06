/** Закупочные статусы project_items — единые правила для UI / export / readiness. */

export const PURCHASE_STATUS = {
  NOT_BOUGHT: "not_bought",
  SEARCHING: "searching",
  ORDERED: "ordered",
  BOUGHT: "bought",
  DELIVERED: "delivered",
  HAVE: "have",
  NEED_HELP: "need_help",
  NOT_FIT: "not_fit",
  REPLACEMENT_CHECK: "replacement_check",
};

export const PURCHASE_STATUS_LABELS = {
  [PURCHASE_STATUS.NOT_BOUGHT]: "Не куплено",
  [PURCHASE_STATUS.SEARCHING]: "В поиске",
  [PURCHASE_STATUS.ORDERED]: "Заказано",
  [PURCHASE_STATUS.BOUGHT]: "Куплено",
  [PURCHASE_STATUS.DELIVERED]: "Доставлено",
  [PURCHASE_STATUS.HAVE]: "Уже есть",
  [PURCHASE_STATUS.NEED_HELP]: "Нужна помощь",
  [PURCHASE_STATUS.NOT_FIT]: "Не подходит",
  [PURCHASE_STATUS.REPLACEMENT_CHECK]: "Замена на проверке",
};

/** UI chips (совместимость с modules.js PURCHASE_STATUSES). */
export const PURCHASE_STATUS_CHIPS = Object.values(PURCHASE_STATUS).map((id) => ({
  id,
  label: PURCHASE_STATUS_LABELS[id],
  chip:
    id === PURCHASE_STATUS.NOT_FIT
      ? "danger"
      : id === PURCHASE_STATUS.NEED_HELP || id === PURCHASE_STATUS.REPLACEMENT_CHECK
        ? "amber"
        : id === PURCHASE_STATUS.SEARCHING || id === PURCHASE_STATUS.ORDERED
          ? "brand"
          : id === PURCHASE_STATUS.BOUGHT || id === PURCHASE_STATUS.DELIVERED || id === PURCHASE_STATUS.HAVE
            ? "ok"
            : "neutral",
}));

const ALIASES = {
  not_bought: PURCHASE_STATUS.NOT_BOUGHT,
  searching: PURCHASE_STATUS.SEARCHING,
  ordered: PURCHASE_STATUS.ORDERED,
  bought: PURCHASE_STATUS.BOUGHT,
  delivered: PURCHASE_STATUS.DELIVERED,
  have: PURCHASE_STATUS.HAVE,
  need_help: PURCHASE_STATUS.NEED_HELP,
  not_fit: PURCHASE_STATUS.NOT_FIT,
  replacement_check: PURCHASE_STATUS.REPLACEMENT_CHECK,
};

/**
 * Canonical purchase-accounting groups.
 * Do not invent statuses outside PURCHASE_STATUS.
 */

/** Progress completed: ordered / bought / delivered / have. */
export const PROGRESS_COMPLETED_STATUSES = Object.freeze([
  PURCHASE_STATUS.ORDERED,
  PURCHASE_STATUS.BOUGHT,
  PURCHASE_STATUS.DELIVERED,
  PURCHASE_STATUS.HAVE,
]);

/** Money spent/committed («Потрачено»): ordered + bought + delivered. have excluded. */
export const SPEND_COMMITTED_STATUSES = Object.freeze([
  PURCHASE_STATUS.ORDERED,
  PURCHASE_STATUS.BOUGHT,
  PURCHASE_STATUS.DELIVERED,
]);

/** Still open for purchase (remaining budget). */
export const OPEN_PURCHASE_STATUSES = Object.freeze([
  PURCHASE_STATUS.NOT_BOUGHT,
  PURCHASE_STATUS.SEARCHING,
  PURCHASE_STATUS.NEED_HELP,
  PURCHASE_STATUS.REPLACEMENT_CHECK,
]);

const PROGRESS_COMPLETED = new Set(PROGRESS_COMPLETED_STATUSES);
const SPEND_COMMITTED = new Set(SPEND_COMMITTED_STATUSES);
const OPEN_PURCHASE = new Set(OPEN_PURCHASE_STATUSES);

const ATTENTION = new Set([
  PURCHASE_STATUS.SEARCHING,
  PURCHASE_STATUS.NEED_HELP,
  PURCHASE_STATUS.NOT_FIT,
  PURCHASE_STATUS.REPLACEMENT_CHECK,
]);

const WARN_PUBLISH = new Set([
  PURCHASE_STATUS.SEARCHING,
  PURCHASE_STATUS.NEED_HELP,
  PURCHASE_STATUS.NOT_FIT,
  PURCHASE_STATUS.REPLACEMENT_CHECK,
]);

const BLOCK_PUBLISH = new Set([PURCHASE_STATUS.NOT_FIT]);

/** Closed UI list = progress-completed (includes ordered + have). */
const CLOSED_LIST = PROGRESS_COMPLETED;

/** Канонический id статуса из item (purchaseStatus или legacy status). */
export function normalizePurchaseStatus(itemOrStatus) {
  if (typeof itemOrStatus === "string") {
    const key = String(itemOrStatus || "").trim().toLowerCase();
    return ALIASES[key] || PURCHASE_STATUS.NOT_BOUGHT;
  }
  const purchaseRaw =
    itemOrStatus?.purchaseStatus ??
    itemOrStatus?.purchase_status ??
    itemOrStatus?.procurementStatus ??
    itemOrStatus?.clientStatus ??
    "";
  const statusRaw = itemOrStatus?.status ?? "";
  const fromPurchase = ALIASES[String(purchaseRaw || "").trim().toLowerCase()];
  const fromStatus = ALIASES[String(statusRaw || "").trim().toLowerCase()];
  // Prefer live status when it conflicts with a stale purchaseStatus copy.
  if (fromPurchase && fromStatus && fromPurchase !== fromStatus) return fromStatus;
  return fromPurchase || fromStatus || PURCHASE_STATUS.NOT_BOUGHT;
}

export function getPurchaseStatusLabel(status) {
  const id = normalizePurchaseStatus(status);
  return PURCHASE_STATUS_LABELS[id] || PURCHASE_STATUS_LABELS[PURCHASE_STATUS.NOT_BOUGHT];
}

export function getPurchaseStatusTone(status) {
  const id = normalizePurchaseStatus(status);
  if (id === PURCHASE_STATUS.NOT_FIT) return "danger";
  if (id === PURCHASE_STATUS.NEED_HELP || id === PURCHASE_STATUS.REPLACEMENT_CHECK) return "amber";
  if (id === PURCHASE_STATUS.SEARCHING) return "brand";
  if (PROGRESS_COMPLETED.has(id)) return "ok";
  return "neutral";
}

export function shouldShowInClientPurchase() {
  return true;
}

export function isOpenPurchaseStatus(status) {
  return OPEN_PURCHASE.has(normalizePurchaseStatus(status));
}

export function isPurchaseSpendCommitted(status) {
  return SPEND_COMMITTED.has(normalizePurchaseStatus(status));
}

export function isPurchaseProgressCompleted(status) {
  return PROGRESS_COMPLETED.has(normalizePurchaseStatus(status));
}

/** Remaining / open purchase budget — only OPEN_PURCHASE statuses. */
export function shouldCountInPurchaseBudget(item) {
  return isOpenPurchaseStatus(item);
}

export function shouldWarnBeforePublish(item) {
  return WARN_PUBLISH.has(normalizePurchaseStatus(item));
}

export function shouldBlockBeforePublish(item) {
  return BLOCK_PUBLISH.has(normalizePurchaseStatus(item));
}

/** Progress completed (ordered/bought/delivered/have). */
export function isPurchaseStatusCompleted(status) {
  return isPurchaseProgressCompleted(status);
}

export function isPurchaseStatusNeedsAttention(status) {
  return ATTENTION.has(normalizePurchaseStatus(status));
}

export function isClosedPurchaseStatusId(status) {
  return CLOSED_LIST.has(normalizePurchaseStatus(status));
}

/** Поле для записи в project_items (canonical + legacy sync). */
export function purchaseStatusPatch(status) {
  const id = normalizePurchaseStatus(status);
  return { purchaseStatus: id, status: id };
}

/** Человекочитаемый статус для merged row. */
export function buildPurchaseStatusSummary(sourceItems = []) {
  const items = sourceItems || [];
  if (!items.length) {
    return {
      status: PURCHASE_STATUS.NOT_BOUGHT,
      mixed: false,
      statusLabel: getPurchaseStatusLabel(PURCHASE_STATUS.NOT_BOUGHT),
      statusSummary: "",
    };
  }
  const unique = [...new Set(items.map((i) => normalizePurchaseStatus(i)))];
  if (unique.length === 1) {
    const status = unique[0];
    return {
      status,
      mixed: false,
      statusLabel: getPurchaseStatusLabel(status),
      statusSummary: "",
    };
  }
  const labels = unique.map((id) => getPurchaseStatusLabel(id));
  const open = items.find((i) => !isClosedPurchaseStatusId(i));
  const status = open ? normalizePurchaseStatus(open) : unique[0];
  return {
    status,
    mixed: true,
    statusLabel: getPurchaseStatusLabel(status),
    statusSummary: `Смешанный статус: ${labels.join(" / ")}`,
  };
}

/** Строка для PDF/клиента: «Статус: …» */
export function formatClientPurchaseStatusLine(itemOrRow) {
  const summary = itemOrRow?.statusSummary;
  if (summary?.statusSummary) return summary.statusSummary;
  if (itemOrRow?.statusSummary && typeof itemOrRow.statusSummary === "string") {
    return itemOrRow.statusSummary;
  }
  const rep = itemOrRow?.sourceItems?.[0] || itemOrRow;
  const built = buildPurchaseStatusSummary(itemOrRow?.sourceItems || [rep]);
  if (built.mixed) return built.statusSummary;
  const label = getPurchaseStatusLabel(built.status);
  return label ? `Статус: ${label}` : "";
}
