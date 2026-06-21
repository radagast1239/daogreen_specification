/** Краб → болт М6 / гайка М6 / гроверная шайба (как в таблице Excel) */

export const CRAB_FASTENER_PER_UNIT = {
  g: 1, // Г-образный
  e: 2, // Е-образный / Т-образный
  x: 4, // X-образный
};

export function crabKind(name) {
  const n = String(name || "").toLowerCase().replace(/ё/g, "е");
  if (!n.includes("краб")) return null;
  if (/x[\s-]?образ|х[\s-]?образ/.test(n)) return "x";
  if (/[ге][\s-]?образ|г обр/.test(n)) return "g";
  if (/[ет][\s-]?образ/.test(n)) return "e";
  return null;
}

export function isCrabName(name) {
  return crabKind(name) != null;
}

function normFastenerName(name) {
  return String(name || "").toLowerCase().replace(/ё/g, "е");
}

export function isBoltM6(name) {
  const n = normFastenerName(name);
  return n.includes("болт") && n.includes("м6");
}

export function isNutM6(name) {
  const n = normFastenerName(name);
  return n.includes("гайка") && n.includes("м6");
}

export function isWasherM6(name) {
  const n = normFastenerName(name);
  return (n.includes("гровер") || n.includes("шайб")) && n.includes("м6") && !n.includes("прес");
}

export function fastenerQtyFromCrabLines(lines) {
  let total = 0;
  for (const ln of lines || []) {
    if (!ln?.included) continue;
    const kind = crabKind(ln.name);
    if (!kind) continue;
    const qty = Number(ln.qty) || 0;
    if (qty <= 0) continue;
    total += qty * (CRAB_FASTENER_PER_UNIT[kind] || 0);
  }
  return total;
}

/** Пересчитать болты/гайки/шайбы по количеству крабов в том же списке строк */
export function syncFastenersFromCrabs(lines) {
  const total = fastenerQtyFromCrabLines(lines);
  if (total <= 0) return lines;

  return lines.map((ln) => {
    const n = ln.name || "";
    const isFastener = isBoltM6(n) || isNutM6(n) || isWasherM6(n);
    if (!isFastener) return ln;
    return {
      ...ln,
      included: true,
      qty: total,
    };
  });
}

export function isProfilePipeName(name) {
  return normFastenerName(name).includes("труба профиль");
}

/** Текст отрезков из comment / techNote / clientNote */
export function profilePipeCutInfo(matOrLine) {
  if (!isProfilePipeName(matOrLine?.name)) return "";
  const text =
    matOrLine.clientNote ||
    matOrLine.techNote ||
    matOrLine.comment ||
    matOrLine.internalNote ||
    "";
  const m = text.match(/сегмент[ыа]?\s*:?\s*(.+)/i);
  if (m) return m[1].trim();
  const trimmed = text.trim();
  if (trimmed && /\d+\s*мм/i.test(trimmed)) return trimmed;
  return "";
}

export function profilePipeSubtitle(matOrLine) {
  if (!isProfilePipeName(matOrLine?.name)) return "";
  const cuts = profilePipeCutInfo(matOrLine);
  const qty = Number(matOrLine.qty ?? matOrLine.defaultQty);
  const unit = matOrLine.unit || "шт.";
  if (cuts) return `Отрезки: ${cuts}`;
  if (Number.isFinite(qty) && qty > 0) return `${qty} ${unit}`;
  return "";
}
