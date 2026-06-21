/** Автоматы и контакторы: номинал (А) + количество (шт) */

export function isBreakerName(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  if (!/\bавтомат/.test(n) && !n.startsWith("автомат")) return false;
  if (/автоматик|автоматизац/.test(n)) return false;
  return true;
}

export function isContactorName(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  return /\bконтактор/.test(n) || n.startsWith("контактор");
}

export function isRatedAmpsName(name) {
  return isBreakerName(name) || isContactorName(name);
}

export function ratedAmpsKind(name) {
  if (isContactorName(name)) return "contactor";
  if (isBreakerName(name)) return "breaker";
  return null;
}

export function blankBreakerSpec() {
  return { amps: "", qty: "" };
}

/** Строки редактора — пустые не отфильтровываем */
export function draftBreakerSpecs(raw) {
  if (!Array.isArray(raw) || !raw.length) return [blankBreakerSpec()];
  return raw.map((s) => ({
    amps: s?.amps === "" || s?.amps == null ? "" : s.amps,
    qty: s?.qty === "" || s?.qty == null ? "" : s.qty,
  }));
}

export function normalizeBreakerSpecs(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((s) => ({
      amps: s?.amps === "" || s?.amps == null ? "" : Number(s.amps) || 0,
      qty: s?.qty === "" || s?.qty == null ? "" : Number(s.qty) || 0,
    }))
    .filter((s) => s.amps > 0 || s.qty > 0);
}

/** «16 А — 5 шт, 25A - 3 шт» */
export function parseBreakerSpecsFromText(text) {
  if (!text) return [];
  const specs = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(?:а|a|амп)?\s*[-–—×x]\s*(\d+)\s*шт/gi;
  let m;
  while ((m = re.exec(text))) {
    specs.push({
      amps: Math.round(parseFloat(String(m[1]).replace(",", "."))),
      qty: Number(m[2]) || 0,
    });
  }
  if (!specs.length) {
    const single = String(text).match(/(\d+(?:[.,]\d+)?)\s*(?:а|a|амп)/i);
    if (single) {
      specs.push({ amps: Math.round(parseFloat(single[1].replace(",", "."))), qty: 0 });
    }
  }
  return normalizeBreakerSpecs(specs);
}

export function parseBreakerSpecsFromDb(json, fallbackText) {
  if (json) {
    try {
      const normalized = normalizeBreakerSpecs(JSON.parse(json));
      if (normalized.length) return normalized;
    } catch {
      /* ignore */
    }
  }
  return parseBreakerSpecsFromText(fallbackText);
}

export function resolveBreakerSpecs(obj) {
  const direct = normalizeBreakerSpecs(obj?.breakerSpecs);
  if (direct.length) return direct;
  const text =
    obj?.clientNote || obj?.techNote || obj?.comment || obj?.internalNote || obj?.name || "";
  return parseBreakerSpecsFromText(text);
}

export function formatBreakerSpecsLabel(specs) {
  const list = normalizeBreakerSpecs(specs);
  if (!list.length) return "";
  return list.map((s) => `${s.amps} А — ${s.qty} шт`).join(", ");
}

export function breakerSpecsClientNote(specs, name) {
  const label = formatBreakerSpecsLabel(specs);
  if (!label) return "";
  const prefix = isContactorName(name) ? "Контакторы" : "Автоматы";
  return `${prefix}: ${label}`;
}

export function breakerSpecsSubtitle(matOrLine) {
  const kind = ratedAmpsKind(matOrLine?.name);
  if (!kind) return "";
  const label = formatBreakerSpecsLabel(resolveBreakerSpecs(matOrLine));
  if (label) {
    const prefix = kind === "contactor" ? "Контакторы" : "Автоматы";
    return `${prefix}: ${label}`;
  }
  const qty = Number(matOrLine.qty ?? matOrLine.defaultQty);
  const unit = matOrLine.unit || "шт.";
  if (Number.isFinite(qty) && qty > 0) return `${qty} ${unit}`;
  return "";
}

export function patchWithBreakerSpecs(obj, specs) {
  const normalized = normalizeBreakerSpecs(specs);
  return {
    ...obj,
    breakerSpecs: normalized,
    clientNote: breakerSpecsClientNote(normalized, obj?.name) || obj?.clientNote || "",
  };
}
