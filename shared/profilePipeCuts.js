/** Отрезки профильной трубы: длина (мм) + количество (шт) */

export function isProfilePipeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .includes("труба профиль");
}

export function blankPipeCut() {
  return { lengthMm: "", qty: "" };
}

export function normalizePipeCuts(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((c) => ({
      lengthMm: c?.lengthMm === "" || c?.lengthMm == null ? "" : Number(c.lengthMm) || 0,
      qty: c?.qty === "" || c?.qty == null ? "" : Number(c.qty) || 0,
    }))
    .filter((c) => c.lengthMm > 0 || c.qty > 0);
}

/** Парсинг из текста: «1300 мм - 12 шт, 660 мм - 18 шт» */
export function parsePipeCutsFromText(text) {
  if (!text) return [];
  const cuts = [];
  const re = /(\d+(?:[.,]\d+)?)\s*мм\s*[-–—]\s*(\d+)\s*шт/gi;
  let m;
  while ((m = re.exec(text))) {
    cuts.push({
      lengthMm: Math.round(parseFloat(String(m[1]).replace(",", "."))),
      qty: Number(m[2]) || 0,
    });
  }
  return normalizePipeCuts(cuts);
}

/** Чтение из колонки БД + fallback на текст в client_note */
export function parsePipeCutsFromDb(json, fallbackText) {
  if (json) {
    try {
      const normalized = normalizePipeCuts(JSON.parse(json));
      if (normalized.length) return normalized;
    } catch {
      /* ignore */
    }
  }
  return parsePipeCutsFromText(fallbackText);
}

export function resolvePipeCuts(obj) {
  const direct = normalizePipeCuts(obj?.pipeCuts);
  if (direct.length) return direct;
  return parsePipeCutsFromText(
    obj?.clientNote || obj?.techNote || obj?.comment || obj?.internalNote || ""
  );
}

export function formatPipeCutsLabel(cuts) {
  const list = normalizePipeCuts(cuts);
  if (!list.length) return "";
  return list.map((c) => `${c.lengthMm} мм — ${c.qty} шт`).join(", ");
}

export function pipeCutsClientNote(cuts) {
  const label = formatPipeCutsLabel(cuts);
  return label ? `Сегменты: ${label}` : "";
}

export function profilePipeSubtitle(matOrLine) {
  if (!isProfilePipeName(matOrLine?.name)) return "";
  const label = formatPipeCutsLabel(resolvePipeCuts(matOrLine));
  if (label) return `Отрезки: ${label}`;
  const qty = Number(matOrLine.qty ?? matOrLine.defaultQty);
  const unit = matOrLine.unit || "шт.";
  if (Number.isFinite(qty) && qty > 0) return `${qty} ${unit}`;
  return "";
}

export function patchWithPipeCuts(obj, cuts) {
  const normalized = normalizePipeCuts(cuts);
  return {
    ...obj,
    pipeCuts: normalized,
    clientNote: pipeCutsClientNote(normalized) || obj?.clientNote || "",
  };
}
