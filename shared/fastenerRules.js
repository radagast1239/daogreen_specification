/** Краб → болт М6 / гайка М6 / гроверная шайба (на один стеллаж — половина от «на стык») */
export const CRAB_FASTENER_PER_UNIT = {
  g: 0.5, // Г-образный (было 1)
  e: 1, // Е-образный / Т-образный (было 2)
  x: 2, // X-образный (было 4)
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
      defaultQty: total,
    };
  });
}

