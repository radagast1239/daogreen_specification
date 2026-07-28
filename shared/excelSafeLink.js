/**
 * Excel hyperlink whitelist + formula-injection guard for cell text.
 */

/**
 * Allow only http: / https: hyperlinks.
 * Rejects javascript:, file:, data:, UNC (\\), mailto, unknown schemes, malformed URLs.
 * @param {*} url
 * @returns {boolean}
 */
export function isSafeExcelHyperlink(url) {
  if (url == null) return false;
  const raw = String(url).trim();
  if (!raw) return false;
  // UNC / local paths
  if (raw.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(raw)) return false;
  // Scheme-relative or protocol-relative without http
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const protocol = String(parsed.protocol || "").toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") return false;
  // Extra guard: no embedded credentials tricks required; URL parser is enough
  return true;
}

/**
 * Prevent Excel formula injection when writing cell values.
 * Strings starting with = + - @ get a leading apostrophe (or tab).
 * @param {*} value
 * @returns {*}
 */
export function excelCellText(value) {
  if (value == null) return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  const s = String(value);
  if (!s) return s;
  const first = s[0];
  if (first === "=" || first === "+" || first === "-" || first === "@") {
    return `'${s}`;
  }
  return s;
}

/**
 * Safe hyperlink target or null (caller should write plain text only).
 * @param {*} url
 * @returns {string|null}
 */
export function safeExcelHyperlinkTarget(url) {
  if (!isSafeExcelHyperlink(url)) return null;
  return String(url).trim();
}
