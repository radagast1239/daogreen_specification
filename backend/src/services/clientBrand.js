const DEFAULT_TRUST_LINES = [
  "Фото, цены и статусы закупки",
  "Отметки «куплено» сохраняются автоматически",
];

const DEFAULT_VISIBLE_TABS = ["overview", "purchase", "merged", "docs"];

const ALLOWED_TABS = new Set([
  ...DEFAULT_VISIBLE_TABS,
  "cooling",
  "categories",
  "modules",
  "merged",
  "install",
  "plumber",
  "electric",
  "installer",
  "consumables",
  "docs",
]);

const DEFAULT_PDF_COLUMNS = ["name", "qty", "unit", "price", "sum", "supplier"];

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function buildClientBrandFromSettings(obj = {}) {
  const visibleTabs = parseJson(obj.clientVisibleTabs, null);
  const pdfColumns = parseJson(obj.clientPdfColumns, null);
  const trustLines = parseJson(obj.clientTrustLines, null);

  return {
    companyName: obj.companyName || "Daogreen",
    contactPhone: obj.contactPhone || "",
    contactEmail: obj.contactEmail || "",
    contactTelegram: obj.contactTelegram || "",
    brandColor: obj.brandColor || "#116355",
    brandAccentColor: obj.brandAccentColor || "#7fc9a8",
    brandBgColor: obj.brandBgColor || "#f0f7f4",
    logoUrl: obj.logoUrl || "",
    clientHeroEyebrow: obj.clientHeroEyebrow || "",
    clientTrustLines:
      Array.isArray(trustLines) && trustLines.length
        ? trustLines.map((s) => String(s).trim()).filter(Boolean)
        : [...DEFAULT_TRUST_LINES],
    clientVisibleTabs:
      Array.isArray(visibleTabs) && visibleTabs.length
        ? visibleTabs.filter((id) => ALLOWED_TABS.has(id)).reduce((acc, id) => {
            const mapped =
              id === "categories" ||
              id === "modules" ||
              id === "plumber" ||
              id === "electric" ||
              id === "installer" ||
              id === "consumables" ||
              id === "install"
                ? "purchase"
                : id;
            if (!acc.includes(mapped) && DEFAULT_VISIBLE_TABS.includes(mapped)) acc.push(mapped);
            return acc;
          }, [])
        : [...DEFAULT_VISIBLE_TABS],
    pdfColumns:
      Array.isArray(pdfColumns) && pdfColumns.length
        ? pdfColumns.filter((id) => id !== "name").reduce((a, id) => [...a, id], ["name"])
        : [...DEFAULT_PDF_COLUMNS],
    pdfFooter: obj.clientPdfFooter || "",
    pdfShowQr: obj.clientPdfShowQr !== "false",
    clientSectionsJson: obj.clientSectionsJson || "",
  };
}

export function loadClientBrand(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return buildClientBrandFromSettings(obj);
}

export function brandSettingsResponse(obj = {}) {
  return {
    brandAccentColor: obj.brandAccentColor || "#7fc9a8",
    brandBgColor: obj.brandBgColor || "#f0f7f4",
    clientHeroEyebrow: obj.clientHeroEyebrow || "",
    clientTrustLines: obj.clientTrustLines || "",
    clientVisibleTabs: obj.clientVisibleTabs || "",
    clientPdfColumns: obj.clientPdfColumns || "",
    clientPdfFooter: obj.clientPdfFooter || "",
    clientPdfShowQr: obj.clientPdfShowQr || "true",
    clientSectionsJson: obj.clientSectionsJson || "",
  };
}
