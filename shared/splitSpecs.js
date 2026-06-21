/** Сплит-системы: шт × кВт */

export function isSplitSystemName(name) {
  return /сплит/i.test(String(name || ""));
}

export function blankSplitSpec() {
  return { qty: "", coolingKw: "" };
}

export function draftSplitSpecs(raw) {
  if (!Array.isArray(raw) || !raw.length) return [blankSplitSpec()];
  return raw.map((s) => ({
    qty: s?.qty === "" || s?.qty == null ? "" : s.qty,
    coolingKw: s?.coolingKw === "" || s?.coolingKw == null ? "" : s.coolingKw,
  }));
}

export function normalizeSplitSpecs(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((s) => ({
      qty: s?.qty === "" || s?.qty == null ? "" : Number(s.qty) || 0,
      coolingKw: s?.coolingKw === "" || s?.coolingKw == null ? "" : Number(s.coolingKw) || 0,
    }))
    .filter((s) => s.qty > 0 || s.coolingKw > 0);
}

export function parseSplitSpecsFromText(text) {
  if (!text) return [];
  const specs = [];
  const re = /(\d+)\s*шт\s*[-–—×x]\s*(\d+(?:[.,]\d+)?)\s*к\s*вт/gi;
  let m;
  while ((m = re.exec(text))) {
    specs.push({ qty: Number(m[1]) || 0, coolingKw: parseFloat(String(m[2]).replace(",", ".")) });
  }
  if (!specs.length) {
    const kw = String(text).match(/(\d+(?:[.,]\d+)?)\s*к\s*вт/i);
    if (kw) specs.push({ qty: 1, coolingKw: parseFloat(kw[1].replace(",", ".")) });
  }
  return normalizeSplitSpecs(specs);
}

export function parseSplitSpecsFromDb(json, fallbackText) {
  if (json) {
    try {
      const normalized = normalizeSplitSpecs(JSON.parse(json));
      if (normalized.length) return normalized;
    } catch {
      /* ignore */
    }
  }
  return parseSplitSpecsFromText(fallbackText);
}

export function resolveSplitSpecs(obj) {
  const direct = normalizeSplitSpecs(obj?.splitSpecs);
  if (direct.length) return direct;
  const kw = Number(obj?.coolingKw) || 0;
  if (kw > 0) {
    return normalizeSplitSpecs([
      { qty: Number(obj?.qty ?? obj?.defaultQty) || 1, coolingKw: kw },
    ]);
  }
  const text =
    obj?.clientNote || obj?.techNote || obj?.comment || obj?.internalNote || obj?.name || "";
  return parseSplitSpecsFromText(text);
}

export function formatSplitSpecsLabel(specs) {
  const list = normalizeSplitSpecs(specs);
  if (!list.length) return "";
  return list
    .map((s) => {
      const q = s.qty > 0 ? s.qty : 1;
      return s.coolingKw > 0 ? `${q} шт × ${s.coolingKw} кВт` : `${q} шт`;
    })
    .join(", ");
}

export function splitSpecsClientNote(specs) {
  const label = formatSplitSpecsLabel(specs);
  return label ? `Сплит-системы: ${label}` : "";
}

export function splitSpecsSubtitle(matOrLine) {
  if (!isSplitSystemName(matOrLine?.name)) return "";
  const label = formatSplitSpecsLabel(resolveSplitSpecs(matOrLine));
  if (label) return `Сплит: ${label}`;
  return "";
}

export function aggregateSplitCoolingKw(specs) {
  return normalizeSplitSpecs(specs).reduce((sum, s) => {
    const q = s.qty > 0 ? s.qty : 1;
    return sum + q * (s.coolingKw || 0);
  }, 0);
}
