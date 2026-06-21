/** Вытяжка и насосы: шт × м³/ч + ссылка */

export function isExhaustFanName(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  if (!/вытяж/.test(n)) return false;
  if (/гофр|скотч|решётк|клапан/.test(n)) return false;
  return true;
}

export function isPumpName(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  if (!/\bнасос/.test(n) && !n.startsWith("насос")) return false;
  if (/обвязк|магистрал|от насоса|к насос/.test(n)) return false;
  return true;
}

export function isFlowSpecName(name) {
  return isExhaustFanName(name) || isPumpName(name);
}

export function blankFlowSpec() {
  return { qty: "", m3h: "", link: "" };
}

export function draftFlowSpecs(raw) {
  if (!Array.isArray(raw) || !raw.length) return [blankFlowSpec()];
  return raw.map((s) => ({
    qty: s?.qty === "" || s?.qty == null ? "" : s.qty,
    m3h: s?.m3h === "" || s?.m3h == null ? "" : s.m3h,
    link: s?.link ?? "",
  }));
}

export function normalizeFlowSpecs(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((s) => ({
      qty: s?.qty === "" || s?.qty == null ? "" : Number(s.qty) || 0,
      m3h: s?.m3h === "" || s?.m3h == null ? "" : Number(s.m3h) || 0,
      link: String(s?.link || "").trim(),
    }))
    .filter((s) => s.qty > 0 || s.m3h > 0 || s.link);
}

export function parseFlowSpecsFromText(text) {
  if (!text) return [];
  const specs = [];
  const re = /(\d+)\s*шт\s*[-–—×x]\s*(\d+(?:[.,]\d+)?)\s*(?:м3|м³)\/?\s*ч/gi;
  let m;
  while ((m = re.exec(text))) {
    specs.push({ qty: Number(m[1]) || 0, m3h: parseFloat(String(m[2]).replace(",", ".")), link: "" });
  }
  if (!specs.length) {
    const m3 = String(text).match(/(\d+(?:[.,]\d+)?)\s*(?:м3|м³)\/?\s*ч/i);
    if (m3) specs.push({ qty: 0, m3h: parseFloat(m3[1].replace(",", ".")), link: "" });
  }
  return normalizeFlowSpecs(specs);
}

export function parseFlowSpecsFromDb(json, fallbackText, fallbackLink = "") {
  if (json) {
    try {
      const normalized = normalizeFlowSpecs(JSON.parse(json));
      if (normalized.length) return normalized;
    } catch {
      /* ignore */
    }
  }
  const fromText = parseFlowSpecsFromText(fallbackText);
  if (fromText.length) return fromText;
  return [];
}

export function resolveFlowSpecs(obj) {
  const direct = normalizeFlowSpecs(obj?.flowSpecs);
  if (direct.length) return direct;
  const m3h = Number(obj?.exhaustM3) || 0;
  const link = obj?.link || "";
  if (m3h > 0 || link) {
    return normalizeFlowSpecs([{ qty: Number(obj?.qty ?? obj?.defaultQty) || 1, m3h, link }]);
  }
  const text =
    obj?.clientNote || obj?.techNote || obj?.comment || obj?.internalNote || obj?.name || "";
  const parsed = parseFlowSpecsFromText(text);
  if (parsed.length) return parsed;
  const fromName = String(obj?.name || "").match(/(\d+(?:[.,]\d+)?)\s*(?:л\/\\?ч|л\\ч|м3|м³)/i);
  if (fromName) {
    return [{ qty: 1, m3h: parseFloat(fromName[1].replace(",", ".")), link }];
  }
  return [];
}

export function formatFlowSpecsLabel(specs, name) {
  const list = normalizeFlowSpecs(specs);
  if (!list.length) return "";
  return list
    .map((s) => {
      const parts = [];
      if (s.qty > 0) parts.push(`${s.qty} шт`);
      if (s.m3h > 0) parts.push(`${s.m3h} м³/ч`);
      return parts.join(" × ") || s.link;
    })
    .join(", ");
}

export function flowSpecsClientNote(specs, name) {
  const label = formatFlowSpecsLabel(specs, name);
  if (!label) return "";
  const prefix = isPumpName(name) ? "Насосы" : "Вытяжка";
  return `${prefix}: ${label}`;
}

export function flowSpecsSubtitle(matOrLine) {
  if (!isFlowSpecName(matOrLine?.name)) return "";
  const specs = resolveFlowSpecs(matOrLine);
  const label = formatFlowSpecsLabel(specs, matOrLine.name);
  if (label) {
    const prefix = isPumpName(matOrLine.name) ? "Насосы" : "Вытяжка";
    return `${prefix}: ${label}`;
  }
  return "";
}

export function aggregateFlowM3(specs) {
  return normalizeFlowSpecs(specs).reduce((sum, s) => {
    const q = s.qty > 0 ? s.qty : 1;
    return sum + q * (s.m3h || 0);
  }, 0);
}

export function primaryFlowLink(specs, fallback = "") {
  const list = normalizeFlowSpecs(specs);
  return list.find((s) => s.link)?.link || fallback;
}
