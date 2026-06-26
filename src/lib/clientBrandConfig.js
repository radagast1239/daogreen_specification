export const CLIENT_TAB_OPTIONS = [
  { id: "purchase", label: "Список закупки" },
  { id: "docs", label: "Документы" },
  { id: "overview", label: "Обзор" },
  // legacy — скрыты от клиента по умолчанию
  { id: "merged", label: "Всё к покупке", legacy: true },
  // legacy — для настроек бренда и миграции старых ссылок
  { id: "cooling", label: "Охлаждение", legacy: true },
  { id: "categories", label: "По категориям", legacy: true },
  { id: "modules", label: "По стеллажам", legacy: true },
  { id: "install", label: "Монтаж", legacy: true },
  { id: "plumber", label: "Сантехник", legacy: true },
  { id: "electric", label: "Электрик", legacy: true },
  { id: "installer", label: "Монтажник", legacy: true },
  { id: "consumables", label: "Расходники", legacy: true },
];

export const DEFAULT_VISIBLE_TAB_IDS = ["purchase", "docs"];

/** Режимы закупки для клиента */
export const CLIENT_SIMPLE_PURCHASE_MODES = [
  { id: "categories", label: "По разделам" },
  { id: "list", label: "Списком" },
  { id: "suppliers", label: "По поставщикам" },
  { id: "plumber", label: "Сантехник" },
  { id: "with_link", label: "С ссылкой" },
  { id: "without_link", label: "Без ссылки" },
  { id: "ordered", label: "Заказано" },
];

/** Основные режимы вкладки «Закупка» */
export const PRIMARY_PURCHASE_MODES = [
  { id: "all", label: "Все к закупке" },
  { id: "categories", label: "По категориям" },
  { id: "suppliers", label: "По поставщикам" },
  { id: "modules", label: "По стеллажам" },
];

/** Специалисты — вторая строка кнопок */
export const SPECIALIST_PURCHASE_MODES = [
  { id: "plumber", label: "Сантехник" },
  { id: "electric", label: "Электрик" },
  { id: "installer", label: "Монтажник" },
  { id: "consumables", label: "Расходники" },
  { id: "install", label: "Монтаж" },
];

/** @deprecated используйте PRIMARY + SPECIALIST */
export const PURCHASE_MODES = [...PRIMARY_PURCHASE_MODES, ...SPECIALIST_PURCHASE_MODES];

const SIMPLE_PURCHASE_MODE_IDS = new Set(CLIENT_SIMPLE_PURCHASE_MODES.map((m) => m.id));

export function isSpecialistPurchaseMode(mode) {
  return SPECIALIST_PURCHASE_MODES.some((m) => m.id === mode);
}

export function isSimplePurchaseMode(mode) {
  return SIMPLE_PURCHASE_MODE_IDS.has(mode);
}

const LEGACY_PURCHASE_TABS = new Set([
  "categories",
  "modules",
  "plumber",
  "electric",
  "installer",
  "consumables",
  "install",
  "cooling",
]);

const ALL_TAB_IDS = new Set(CLIENT_TAB_OPTIONS.map((t) => t.id));

/** Нормализация вкладок: одна закупка, без дублирующего «Всё к покупке» */
export function normalizeVisibleTabIds(raw) {
  const incoming = Array.isArray(raw) && raw.length ? raw : [...DEFAULT_VISIBLE_TAB_IDS];
  const wantsPurchase = incoming.some(
    (id) => id === "purchase" || id === "merged" || LEGACY_PURCHASE_TABS.has(id)
  );
  const out = [];
  if (wantsPurchase) out.push("purchase");
  if (incoming.includes("docs")) out.push("docs");
  if (incoming.includes("overview")) out.push("overview");
  if (!out.length) return [...DEFAULT_VISIBLE_TAB_IDS];
  return out;
}

/** Старую вкладку → режим закупки */
export function legacyTabToPurchaseMode(tabId) {
  if (tabId === "modules") return "modules";
  if (LEGACY_PURCHASE_TABS.has(tabId) && tabId !== "cooling") return tabId;
  return "all";
}

export const PDF_COLUMN_OPTIONS = [
  { id: "name", label: "Наименование", required: true },
  { id: "qty", label: "Кол-во" },
  { id: "unit", label: "Ед." },
  { id: "price", label: "Цена" },
  { id: "sum", label: "Сумма" },
  { id: "supplier", label: "Поставщик" },
  { id: "category", label: "Категория" },
  { id: "clientSection", label: "Раздел закупки" },
  { id: "module", label: "Модуль" },
  { id: "link", label: "Ссылка" },
  { id: "status", label: "Статус" },
  { id: "vat", label: "НДС %" },
];

export const DEFAULT_PDF_COLUMN_IDS = ["name", "qty", "unit", "price", "sum", "supplier"];

export const DEFAULT_TRUST_LINES = [
  "Фото, цены и статусы закупки",
  "Отметки «куплено» сохраняются автоматически",
];

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function resolveVisibleTabs(settings = {}) {
  const list = parseJson(settings.clientVisibleTabs, null);
  if (Array.isArray(list) && list.length) return normalizeVisibleTabIds(list);
  return [...DEFAULT_VISIBLE_TAB_IDS];
}

export function resolvePdfColumns(settings = {}) {
  const list = parseJson(settings.clientPdfColumns, null);
  if (Array.isArray(list) && list.length) {
    const allowed = new Set(PDF_COLUMN_OPTIONS.map((c) => c.id));
    const cols = list.filter((id) => allowed.has(id));
    if (!cols.includes("name")) cols.unshift("name");
    return cols;
  }
  return [...DEFAULT_PDF_COLUMN_IDS];
}

export function resolveTrustLines(settings = {}) {
  const list = parseJson(settings.clientTrustLines, null);
  if (Array.isArray(list) && list.length) {
    return list.map((s) => String(s).trim()).filter(Boolean);
  }
  return [...DEFAULT_TRUST_LINES];
}

export function buildClientBrand(settings = {}) {
  return {
    companyName: settings.companyName || "Daogreen",
    contactPhone: settings.contactPhone || "",
    contactEmail: settings.contactEmail || "",
    contactTelegram: settings.contactTelegram || "",
    brandColor: settings.brandColor || "#116355",
    brandAccentColor: settings.brandAccentColor || "#7fc9a8",
    brandBgColor: settings.brandBgColor || "#f0f7f4",
    logoUrl: settings.logoUrl || "",
    clientHeroEyebrow: settings.clientHeroEyebrow || "",
    clientTrustLines: resolveTrustLines(settings),
    clientVisibleTabs: resolveVisibleTabs(settings),
    pdfColumns: resolvePdfColumns(settings),
    pdfFooter: settings.clientPdfFooter || "",
    pdfShowQr: settings.clientPdfShowQr !== "false" && settings.clientPdfShowQr !== false,
  };
}

export function clientBrandToSettings(brand) {
  return {
    companyName: brand.companyName || "Daogreen",
    contactPhone: brand.contactPhone || "",
    contactEmail: brand.contactEmail || "",
    contactTelegram: brand.contactTelegram || "",
    brandColor: brand.brandColor || "#116355",
    brandAccentColor: brand.brandAccentColor || "#7fc9a8",
    brandBgColor: brand.brandBgColor || "#f0f7f4",
    logoUrl: brand.logoUrl || "",
    clientHeroEyebrow: brand.clientHeroEyebrow || "",
    clientTrustLines: JSON.stringify(
      (brand.clientTrustLines || DEFAULT_TRUST_LINES).map((s) => String(s).trim()).filter(Boolean)
    ),
    clientVisibleTabs: JSON.stringify(
      normalizeVisibleTabIds(brand.clientVisibleTabs || DEFAULT_VISIBLE_TAB_IDS)
    ),
    clientPdfColumns: JSON.stringify(brand.pdfColumns || DEFAULT_PDF_COLUMN_IDS),
    clientPdfFooter: brand.pdfFooter || "",
    clientPdfShowQr: brand.pdfShowQr === false ? "false" : "true",
  };
}

export function clientTabDefs(brand) {
  const visible = new Set(normalizeVisibleTabIds(brand?.clientVisibleTabs || DEFAULT_VISIBLE_TAB_IDS));
  const tabs = CLIENT_TAB_OPTIONS.filter((t) => !t.legacy && visible.has(t.id)).map((t) => [t.id, t.label]);
  if (tabs.length) return tabs;
  return [
    ["purchase", "Список закупки"],
    ["docs", "Документы"],
  ];
}

export function heroEyebrow(brand) {
  const company = brand?.companyName || "Daogreen";
  const tpl = brand?.clientHeroEyebrow?.trim();
  if (tpl) return tpl.replace(/\{company\}/gi, company);
  return `${company} · закупочный список`;
}
