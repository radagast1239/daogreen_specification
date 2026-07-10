/** UI-модель компактного экрана спецификации проекта (pure helpers). */

import { PROJECT_DASHBOARD_FILTERS } from "./projectDashboardSummary.js";
import {
  canRefreshFrameBom,
  drawingHasUsableRefreshContext,
  frameBomRackOptionsFromContext,
} from "./frameDrawingActionsModel.js";
import {
  hasFrameBomRowsForRack,
  hasLegacyFrameBomRowsForRack,
} from "./frameBomProjectItems.js";

/** Основные фильтры — всегда на экране. */
export const SPEC_PRIMARY_FILTERS = [
  { id: "", label: "Все" },
  { id: "client_visible", label: "Клиенту" },
  { id: "problems", label: "Проблемные" },
  { id: "frame_bom", label: "Из схемы каркаса" },
  { id: "no_price", label: "Без цены" },
];

const PRIMARY_IDS = new Set(SPEC_PRIMARY_FILTERS.map((f) => f.id));

/** Продвинутые фильтры — в «Ещё фильтры». */
export const SPEC_ADVANCED_FILTERS = [
  { id: "client_hidden", label: "Скрытые" },
  { id: "no_photo", label: "Без фото" },
  { id: "no_link", label: "Без ссылки" },
  { id: "no_supplier", label: "Без поставщика" },
  { id: "need_help", label: "Нужна помощь" },
  { id: "replacement_check", label: "Замена на проверке" },
  { id: "not_fit", label: "Не подходит" },
  { id: "not_bought", label: "Не куплено" },
  { id: "ordered", label: "Заказано" },
  { id: "purchase_closed", label: "Куплено/доставлено" },
  { id: "no_client_section", label: "Без раздела" },
  { id: "no_client_subsection", label: "Без клиентского подраздела" },
];

/** Все фильтры остаются доступны (primary + advanced + любые dashboard). */
export function listAllSpecWorkspaceFilters() {
  const seen = new Set();
  const out = [];
  for (const row of [...SPEC_PRIMARY_FILTERS, ...SPEC_ADVANCED_FILTERS, ...PROJECT_DASHBOARD_FILTERS]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function isPrimarySpecFilter(filterId) {
  return PRIMARY_IDS.has(filterId || "");
}

export function isAdvancedSpecFilter(filterId) {
  return SPEC_ADVANCED_FILTERS.some((f) => f.id === filterId);
}

/** Пункты меню «Массовый выбор». */
export const MASS_SELECT_ACTIONS = [
  { key: "no_price", label: "Выбрать без цены" },
  { key: "no_supplier", label: "Выбрать без поставщика" },
  { key: "hidden_from_client", label: "Выбрать скрытые" },
  { key: "frame_bom", label: "Выбрать BOM" },
  { key: "all_problems", label: "Выбрать всё проблемное" },
  { key: "no_link", label: "Выбрать без ссылки" },
];

/** Кнопки action bar при selectedCount > 0. */
export const SELECTED_ACTION_BAR_ACTIONS = [
  { key: "show_client", label: "Показать клиенту" },
  { key: "hide_client", label: "Скрыть" },
  { key: "refresh_prices", label: "Обновить цены" },
  { key: "clear_selection", label: "Снять выбор" },
];

export function shouldShowSelectedActionBar(selectedCount) {
  return Number(selectedCount) > 0;
}

/** Вкладки блока «Перед отправкой клиенту». */
export const CLIENT_READINESS_TABS = [
  { id: "overview", label: "Обзор" },
  { id: "problems", label: "Проблемы" },
  { id: "mass", label: "Массовые действия" },
  { id: "preview", label: "Что увидит клиент" },
];

export const CLIENT_READINESS_DEFAULT_TAB = "overview";

/**
 * Summary-метрики объединённого блока (без no_link в проблемных).
 * no_link отдаётся отдельно как info.
 */
export function buildClientReadinessSummaryMetrics(checklist, clientSummary) {
  const group = (key) => checklist?.groups?.find((g) => g.key === key);
  const noLink = group("no_link");
  return {
    metrics: [
      { key: "client_total", label: "Клиенту всего", value: checklist?.clientTotalCount ?? 0, filter: "client_visible", tone: "ok" },
      { key: "hidden", label: "Скрыто", value: group("hidden_from_client")?.count ?? clientSummary?.hiddenItems ?? 0, filter: "client_hidden", tone: "warn" },
      { key: "no_price", label: "Без цены", value: group("no_price")?.count ?? 0, filter: "no_price", tone: "bad" },
      { key: "no_supplier", label: "Без поставщика", value: group("no_supplier")?.count ?? 0, filter: "no_supplier", tone: "bad" },
      { key: "frame_bom", label: "Из схемы каркаса", value: group("frame_bom")?.count ?? clientSummary?.frameBomItems ?? 0, filter: "frame_bom", tone: "neutral" },
      {
        key: "purchase_total",
        label: "Итог закупки",
        value: clientSummary?.purchaseTotal ?? 0,
        filter: "",
        tone: "neutral",
        kind: "money",
      },
      {
        key: "purchase_closed",
        label: "Закрыто по закупке",
        value: clientSummary?.purchaseClosed ?? 0,
        filter: "purchase_closed",
        tone: "neutral",
        sub: `из ${clientSummary?.purchaseTotalItems ?? 0}`,
      },
      {
        key: "send_status",
        label: "Статус отправки",
        value: checklist?.statusTitle || "—",
        filter: "",
        tone: checklist?.tone || "neutral",
        kind: "text",
      },
    ],
    noLinkInfo: {
      count: checklist?.noLinkCount ?? noLink?.count ?? 0,
      text: `Без ссылок: ${checklist?.noLinkCount ?? noLink?.count ?? 0} — не мешает отправке`,
      severity: "info",
      filter: "no_link",
    },
  };
}

export const FRAME_BOM_STATUS = {
  IN_PURCHASE: "in_purchase",
  NOT_ADDED: "not_added",
  NEEDS_UPDATE: "needs_update",
  LEGACY_DUPES: "legacy_dupes",
};

export const FRAME_BOM_STATUS_LABELS = {
  [FRAME_BOM_STATUS.IN_PURCHASE]: "BOM в закупке",
  [FRAME_BOM_STATUS.NOT_ADDED]: "BOM не добавлен",
  [FRAME_BOM_STATUS.NEEDS_UPDATE]: "BOM требует обновления",
  [FRAME_BOM_STATUS.LEGACY_DUPES]: "Есть старые дубли",
};

/**
 * Компактный статус BOM для карточки схемы каркаса.
 */
export function resolveFrameBomUiStatus({
  drawing = null,
  drawings = [],
  projectItems = [],
  context = {},
} = {}) {
  const rackOpts = frameBomRackOptionsFromContext(context);
  const latest = drawing || drawings?.[0] || null;
  const hasDrawing = drawingHasUsableRefreshContext(latest) || Boolean(rackOpts.drawingId);
  const hasBom = hasFrameBomRowsForRack(projectItems, rackOpts);
  const hasLegacy = hasLegacyFrameBomRowsForRack(projectItems, rackOpts);
  const refresh = canRefreshFrameBom({
    drawing: latest,
    drawings,
    projectItems,
    context,
    hasRefreshHandler: true,
  });

  if (hasLegacy) {
    return {
      id: FRAME_BOM_STATUS.LEGACY_DUPES,
      label: FRAME_BOM_STATUS_LABELS[FRAME_BOM_STATUS.LEGACY_DUPES],
      tone: "warn",
      refresh,
    };
  }
  if (hasBom && hasDrawing) {
    return {
      id: FRAME_BOM_STATUS.IN_PURCHASE,
      label: FRAME_BOM_STATUS_LABELS[FRAME_BOM_STATUS.IN_PURCHASE],
      tone: "ok",
      refresh,
    };
  }
  if (hasBom && !hasDrawing) {
    return {
      id: FRAME_BOM_STATUS.NEEDS_UPDATE,
      label: FRAME_BOM_STATUS_LABELS[FRAME_BOM_STATUS.NEEDS_UPDATE],
      tone: "warn",
      refresh,
    };
  }
  if (hasDrawing && !hasBom) {
    return {
      id: FRAME_BOM_STATUS.NOT_ADDED,
      label: FRAME_BOM_STATUS_LABELS[FRAME_BOM_STATUS.NOT_ADDED],
      tone: "warn",
      refresh,
    };
  }
  return {
    id: FRAME_BOM_STATUS.NOT_ADDED,
    label: FRAME_BOM_STATUS_LABELS[FRAME_BOM_STATUS.NOT_ADDED],
    tone: "neutral",
    refresh,
  };
}

/** Основные действия шапки проекта. */
export const PROJECT_HEADER_PRIMARY_ACTIONS = [
  { key: "client_link", label: "Клиентская ссылка" },
  { key: "copy_link", label: "Скопировать ссылку" },
  { key: "pdf", label: "PDF" },
  { key: "excel", label: "Excel" },
];

/** Второстепенные действия в «Ещё». */
export const PROJECT_HEADER_MORE_ACTIONS = [
  { key: "plan", label: "План" },
  { key: "import", label: "Из прошлого" },
  { key: "compare", label: "Сравнить" },
  { key: "readiness", label: "Проверить готовность" },
  { key: "problems", label: "Проблемные позиции" },
  { key: "duplicate", label: "На основе прошлого" },
  { key: "approve_all", label: "Показать всё клиенту" },
  { key: "qr_link", label: "QR / Шаблон ссылки" },
  { key: "reset_link", label: "Сбросить ссылку" },
  { key: "internal_excel", label: "Внутренний Excel" },
];
