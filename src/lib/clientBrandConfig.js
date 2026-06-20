export const CLIENT_TAB_OPTIONS = [
  { id: "overview", label: "Обзор" },
  { id: "cooling", label: "Охлаждение" },
  { id: "categories", label: "По категориям" },
  { id: "modules", label: "По стеллажам" },
  { id: "merged", label: "Общий список" },
  { id: "install", label: "Монтаж" },
  { id: "plumber", label: "Сантехник" },
  { id: "electric", label: "Электрик" },
  { id: "installer", label: "Монтажник" },
  { id: "consumables", label: "Расходники" },
  { id: "docs", label: "Документы" },
];

export const DEFAULT_VISIBLE_TAB_IDS = CLIENT_TAB_OPTIONS.map((t) => t.id);

export const PDF_COLUMN_OPTIONS = [
  { id: "name", label: "Наименование", required: true },
  { id: "qty", label: "Кол-во" },
  { id: "unit", label: "Ед." },
  { id: "price", label: "Цена" },
  { id: "sum", label: "Сумма" },
  { id: "supplier", label: "Поставщик" },
  { id: "category", label: "Категория" },
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
  if (Array.isArray(list) && list.length) {
    const allowed = new Set(DEFAULT_VISIBLE_TAB_IDS);
    return list.filter((id) => allowed.has(id));
  }
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
    clientVisibleTabs: JSON.stringify(brand.clientVisibleTabs || DEFAULT_VISIBLE_TAB_IDS),
    clientPdfColumns: JSON.stringify(brand.pdfColumns || DEFAULT_PDF_COLUMN_IDS),
    clientPdfFooter: brand.pdfFooter || "",
    clientPdfShowQr: brand.pdfShowQr === false ? "false" : "true",
  };
}

export function clientTabDefs(brand) {
  const visible = new Set(brand?.clientVisibleTabs || DEFAULT_VISIBLE_TAB_IDS);
  return CLIENT_TAB_OPTIONS.filter((t) => visible.has(t.id)).map((t) => [t.id, t.label]);
}

export function heroEyebrow(brand) {
  const company = brand?.companyName || "Daogreen";
  const tpl = brand?.clientHeroEyebrow?.trim();
  if (tpl) return tpl.replace(/\{company\}/gi, company);
  return `${company} · вертикальные фермы`;
}
