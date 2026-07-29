/**
 * Project currency presets + custom currency helpers.
 * No FX conversion — amounts stay numeric; only display symbol/code changes.
 */

export const PROJECT_CURRENCY_PRESETS = [
  { code: "RUB", symbol: "₽", name: "Российский рубль" },
  { code: "USD", symbol: "$", name: "Доллар США" },
  { code: "EUR", symbol: "€", name: "Евро" },
  { code: "AED", symbol: "AED", name: "Дирхам ОАЭ" },
  { code: "KZT", symbol: "₸", name: "Казахстанский тенге" },
  { code: "INR", symbol: "₹", name: "Индийская рупия" },
];

export const DEFAULT_PROJECT_CURRENCY = PROJECT_CURRENCY_PRESETS[0];

const PRESET_BY_CODE = new Map(PROJECT_CURRENCY_PRESETS.map((p) => [p.code, p]));
const PRESET_BY_SYMBOL = new Map(PROJECT_CURRENCY_PRESETS.map((p) => [p.symbol, p]));

/** Glyphs we treat as PDF-safe with typical Roboto + common currency coverage. */
const PDF_SAFE_EXTRA = new Set(["₽", "€", "$", "£", "¥", "₸", "₹"]);

const CTRL_OR_HTML_RE = /[\u0000-\u001F\u007F-\u009F<>&"'`]/;

function currencyInvalid(message) {
  const err = new Error(message || "Invalid project currency");
  err.code = "PROJECT_CURRENCY_INVALID";
  return err;
}

function trimStr(v) {
  return String(v ?? "").trim();
}

function hasCtrlOrHtml(s) {
  return CTRL_OR_HTML_RE.test(s);
}

function isVisibleSymbolChar(ch) {
  const cp = ch.codePointAt(0);
  if (cp == null) return false;
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return false;
  if (cp === 0x2028 || cp === 0x2029) return false;
  return true;
}

function descriptorFromPreset(preset, custom = false) {
  return {
    currencyCode: preset.code,
    currencySymbol: preset.symbol,
    currencyName: preset.name,
    currencyCustom: !!custom,
  };
}

function readCurrencyMeta(manualParams) {
  const meta = manualParams?.currencyMeta;
  if (!meta || typeof meta !== "object") return null;
  return meta;
}

/**
 * Normalize project / release meta / raw fields → currency descriptor.
 * Missing/legacy (only currency:"₽" or empty) → RUB. Does not write DB.
 * @param {object|null|undefined} projectOrMeta
 */
export function normalizeProjectCurrency(projectOrMeta) {
  const src = projectOrMeta && typeof projectOrMeta === "object" ? projectOrMeta : {};
  const manualParams = src.manualParams && typeof src.manualParams === "object" ? src.manualParams : {};
  const meta = readCurrencyMeta(manualParams)
    || (src.currencyMeta && typeof src.currencyMeta === "object" ? src.currencyMeta : null);

  const codeRaw = trimStr(src.currencyCode || meta?.code || "");
  const symbolRaw = trimStr(
    src.currencySymbol != null && src.currencySymbol !== ""
      ? src.currencySymbol
      : meta?.symbol != null && meta.symbol !== ""
        ? meta.symbol
        : src.currency != null
          ? src.currency
          : "",
  );
  const nameRaw = trimStr(src.currencyName || meta?.name || "");
  const customFlag = !!(src.currencyCustom ?? meta?.custom);

  if (codeRaw) {
    const upper = codeRaw.toUpperCase();
    const preset = PRESET_BY_CODE.get(upper);
    if (preset && !customFlag) {
      return descriptorFromPreset(preset, false);
    }
    return {
      currencyCode: upper || DEFAULT_PROJECT_CURRENCY.code,
      currencySymbol: symbolRaw || upper || DEFAULT_PROJECT_CURRENCY.symbol,
      currencyName: nameRaw || upper || DEFAULT_PROJECT_CURRENCY.name,
      currencyCustom: true,
    };
  }

  if (symbolRaw) {
    const bySym = PRESET_BY_SYMBOL.get(symbolRaw);
    if (bySym) return descriptorFromPreset(bySym, false);
    return {
      currencyCode: "CUSTOM",
      currencySymbol: symbolRaw,
      currencyName: nameRaw || symbolRaw,
      currencyCustom: true,
    };
  }

  return descriptorFromPreset(DEFAULT_PROJECT_CURRENCY, false);
}

/**
 * @param {{ currencyCode: string, currencySymbol: string, currencyName: string, currencyCustom: boolean }} currencyDesc
 */
export function applyCurrencyToProjectFields(currencyDesc) {
  const desc = currencyDesc && typeof currencyDesc === "object"
    ? currencyDesc
    : descriptorFromPreset(DEFAULT_PROJECT_CURRENCY, false);
  const code = trimStr(desc.currencyCode) || DEFAULT_PROJECT_CURRENCY.code;
  const symbol = trimStr(desc.currencySymbol) || DEFAULT_PROJECT_CURRENCY.symbol;
  const name = trimStr(desc.currencyName) || DEFAULT_PROJECT_CURRENCY.name;
  const custom = !!desc.currencyCustom;
  return {
    currency: symbol,
    manualParamsPatch: {
      currencyMeta: {
        code,
        symbol,
        name,
        custom,
      },
    },
  };
}

function pickInput(input) {
  if (!input || typeof input !== "object") return {};
  if (input.currencyInfo && typeof input.currencyInfo === "object") {
    return { ...input, ...input.currencyInfo };
  }
  return input;
}

/**
 * Validate create/update currency payload. Throws Error with code PROJECT_CURRENCY_INVALID.
 * @param {object} input
 */
export function validateProjectCurrencyInput(input) {
  const raw = pickInput(input);
  const custom = !!raw.currencyCustom;
  const code = trimStr(raw.currencyCode || raw.code || "").toUpperCase();
  const symbol = trimStr(raw.currencySymbol || raw.symbol || raw.currency || "");
  const name = trimStr(raw.currencyName || raw.name || "");

  if (!code && symbol && !custom) {
    const bySym = PRESET_BY_SYMBOL.get(symbol);
    if (bySym) return descriptorFromPreset(bySym, false);
  }

  if (!custom) {
    if (!code && !symbol) {
      return descriptorFromPreset(DEFAULT_PROJECT_CURRENCY, false);
    }
    const preset = PRESET_BY_CODE.get(code) || PRESET_BY_SYMBOL.get(symbol);
    if (!preset) {
      throw currencyInvalid("Currency code is not in the preset whitelist");
    }
    return descriptorFromPreset(preset, false);
  }

  if (!code) throw currencyInvalid("Custom currency code is required");
  if (!/^[A-Z0-9-]{1,10}$/.test(code)) {
    throw currencyInvalid("Custom currency code must be 1–10 chars [A-Za-z0-9-]");
  }
  if (!/[A-Z]/.test(code)) {
    throw currencyInvalid("Custom currency code must include a latin letter");
  }

  if (!symbol || symbol.length < 1 || symbol.length > 8) {
    throw currencyInvalid("Custom currency symbol must be 1–8 characters");
  }
  for (const ch of symbol) {
    if (!isVisibleSymbolChar(ch)) {
      throw currencyInvalid("Custom currency symbol has control or invisible characters");
    }
  }
  if (hasCtrlOrHtml(symbol) || /[\r\n]/.test(symbol)) {
    throw currencyInvalid("Custom currency symbol must not contain HTML or controls");
  }

  if (!name || name.length < 1 || name.length > 60) {
    throw currencyInvalid("Custom currency name must be 1–60 characters");
  }
  if (hasCtrlOrHtml(name) || /[\r\n]/.test(name)) {
    throw currencyInvalid("Custom currency name must not contain HTML or controls");
  }

  return {
    currencyCode: code,
    currencySymbol: symbol,
    currencyName: name,
    currencyCustom: true,
  };
}

export function resolveMoneyDisplaySymbol(desc) {
  if (desc && typeof desc === "object" && desc.currencySymbol != null && desc.currencySymbol !== "") {
    return String(desc.currencySymbol);
  }
  if (typeof desc === "string" && desc) return desc;
  return DEFAULT_PROJECT_CURRENCY.symbol;
}

/**
 * True when every character is Basic Latin printable or a known currency glyph.
 */
export function isPdfSymbolGlyphSafe(symbol) {
  const s = String(symbol ?? "");
  if (!s) return false;
  for (const ch of s) {
    if (PDF_SAFE_EXTRA.has(ch)) continue;
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) continue;
    return false;
  }
  return true;
}

/**
 * PDF suffix: prefer symbol; fall back to code for AED Arabic / unknown custom glyphs.
 * @param {object} desc
 * @param {{ glyphSafe?: boolean }} [opts]
 */
export function pdfCurrencySuffix(desc, opts = {}) {
  const d = desc && typeof desc === "object" && (desc.currencyCode || desc.currencySymbol)
    ? desc
    : normalizeProjectCurrency(desc);
  const symbol = resolveMoneyDisplaySymbol(d);
  const code = trimStr(d.currencyCode) || DEFAULT_PROJECT_CURRENCY.code;
  const forceSafe = opts.glyphSafe === true;
  if (forceSafe || !isPdfSymbolGlyphSafe(symbol)) return code;
  return symbol;
}

/**
 * @param {*} amount
 * @param {object} desc
 * @param {{ glyphSafe?: boolean }} [opts]
 */
export function formatMoneyForPdf(amount, desc, opts = {}) {
  const n = Math.round(Number(amount) || 0);
  const suffix = pdfCurrencySuffix(desc, opts);
  return `${n.toLocaleString("ru-RU")} ${suffix}`;
}

/**
 * Reject symbols that break Excel numFmt or invite formula injection.
 */
export function isExcelNumFmtSafeSymbol(symbol) {
  const s = String(symbol ?? "");
  if (!s) return false;
  if (/["\u0000-\u001F\u007F]/.test(s)) return false;
  if (s.includes(";")) return false;
  const first = s[0];
  if (first === "=" || first === "+" || first === "-" || first === "@") return false;
  return true;
}

/**
 * Fields to send on create/update API.
 */
export function currencyFieldsForApi(desc) {
  const d = desc && typeof desc === "object" ? desc : normalizeProjectCurrency({});
  return {
    currency: d.currencySymbol,
    currencyCode: d.currencyCode,
    currencySymbol: d.currencySymbol,
    currencyName: d.currencyName,
    currencyCustom: !!d.currencyCustom,
  };
}

/**
 * Whether body carries currency-related keys that need validation.
 */
export function bodyHasCurrencyInput(body) {
  if (!body || typeof body !== "object") return false;
  if (body.currencyInfo != null) return true;
  if (body.currencyCode != null) return true;
  if (body.currencySymbol != null) return true;
  if (body.currencyName != null) return true;
  if (body.currencyCustom != null) return true;
  if (body.currency != null) return true;
  const mp = body.manualParams;
  if (mp && typeof mp === "object" && mp.currencyMeta != null) return true;
  return false;
}

/**
 * Resolve validated persist fields when body carries currency input.
 * Returns null when no currency fields provided (caller keeps existing / applies default on create).
 */
export function resolveCurrencyPersistFromBody(body) {
  if (!bodyHasCurrencyInput(body)) return null;
  const mp = body?.manualParams && typeof body.manualParams === "object" ? body.manualParams : {};
  const meta = mp.currencyMeta && typeof mp.currencyMeta === "object" ? mp.currencyMeta : null;
  const info = body.currencyInfo && typeof body.currencyInfo === "object" ? body.currencyInfo : null;
  const input = {
    ...(meta
      ? {
          currencyCode: meta.code,
          currencySymbol: meta.symbol,
          currencyName: meta.name,
          currencyCustom: meta.custom,
        }
      : {}),
    currency: body.currency,
    currencyCode: body.currencyCode,
    currencySymbol: body.currencySymbol,
    currencyName: body.currencyName,
    currencyCustom: body.currencyCustom,
    ...(info || {}),
  };
  const desc = validateProjectCurrencyInput(input);
  return applyCurrencyToProjectFields(desc);
}

/** Default persist patch for new projects with no currency input. */
export function defaultCurrencyPersist() {
  return applyCurrencyToProjectFields(descriptorFromPreset(DEFAULT_PROJECT_CURRENCY, false));
}
