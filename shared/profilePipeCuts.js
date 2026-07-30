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

/** Строки редактора — пустые не отфильтровываем */
export function draftPipeCuts(raw) {
  if (!Array.isArray(raw) || !raw.length) return [blankPipeCut()];
  return raw.map((c) => ({
    lengthMm: c?.lengthMm === "" || c?.lengthMm == null ? "" : c.lengthMm,
    qty: c?.qty === "" || c?.qty == null ? "" : c.qty,
  }));
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

/** Сумма отрезков в погонных метрах (lengthMm × qty / 1000). */
export function totalPipeCutMeters(pipeCuts) {
  const totalMm = normalizePipeCuts(pipeCuts).reduce(
    (sum, c) => sum + (Number(c.lengthMm) || 0) * (Number(c.qty) || 0),
    0,
  );
  return Math.round((totalMm / 1000) * 100) / 100;
}

/** Единицы, для которых qty должен считаться из сегментов. */
export function isLinearMeterPipeUnit(unit) {
  const u = String(unit || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, "");
  return u === "м" || u === "м." || u === "мп" || u === "м.п" || u === "м.п." || u.includes("м.п");
}

/** Склеивает отрезки из нескольких строк (стеллажей): одинаковые длины суммируются */
export function mergePipeCutsFromItems(items, options = {}) {
  const scaleOf = typeof options.scaleOf === "function" ? options.scaleOf : () => 1;
  const byLen = new Map();
  for (const it of items || []) {
    const scale = Math.max(1, Number(scaleOf(it)) || 1);
    for (const c of resolvePipeCuts(it)) {
      const len = Number(c.lengthMm) || 0;
      const qty = (Number(c.qty) || 0) * scale;
      if (!len || !qty) continue;
      byLen.set(len, (byLen.get(len) || 0) + qty);
    }
  }
  return [...byLen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lengthMm, qty]) => ({ lengthMm, qty: Math.round(qty * 100) / 100 }));
}

/** Умножить/разделить qty сегментов (для count стеллажей). */
export function scalePipeCuts(cuts, factor) {
  const f = Number(factor);
  if (!Number.isFinite(f) || f === 1) return normalizePipeCuts(cuts);
  return normalizePipeCuts(cuts).map((c) => ({
    lengthMm: c.lengthMm,
    qty: Math.round((Number(c.qty) || 0) * f * 100) / 100,
  }));
}

/** Lean counts for client DTO (no photos / internal fields). */
export function leanStellageCounts(stellageConfigs = []) {
  return (Array.isArray(stellageConfigs) ? stellageConfigs : [])
    .map((c) => ({
      id: String(c?.id || "").trim(),
      name: String(c?.name || "").trim(),
      moduleName: String(c?.moduleName || "").trim(),
      count: Math.max(1, Number(c?.count) || 1),
    }))
    .filter((c) => c.id || c.name);
}

/**
 * Количество одинаковых стеллажей для позиции спецификации.
 * Frame BOM уже сохранён с учётом count — вызывающий код не должен умножать повторно.
 */
export function resolveStellageCountForProjectItem(item, stellageConfigs = []) {
  const embedded = Number(item?.stellageCount ?? item?.rackCount);
  if (Number.isFinite(embedded) && embedded >= 1) return Math.max(1, embedded);

  const configs = Array.isArray(stellageConfigs) ? stellageConfigs : [];
  if (!configs.length) return 1;
  const id = String(item?.id || "");
  for (const cfg of configs) {
    const cfgId = String(cfg?.id || "").trim();
    if (cfgId && id.startsWith(`${cfgId}__`)) {
      return Math.max(1, Number(cfg.count) || 1);
    }
  }
  const section = String(item?.section || item?.module || "").trim();
  if (!section) return 1;
  const cfg = configs.find(
    (c) => String(c?.name || "").trim() === section || String(c?.moduleName || "").trim() === section,
  );
  return Math.max(1, Number(cfg?.count) || 1);
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

