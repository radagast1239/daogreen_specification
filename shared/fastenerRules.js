/** Краб → болт М6 / гайка М6 / саморез с прессшайбой (на 1 краб в строке состава) */
export const CRAB_FASTENER_PER_UNIT = {
  g: 0.5, // Г-образный
  t: 1, // Т-образный
  x: 2, // X / Х-образный
};

/** Саморез с прессшайбой — 1 шт на каждый краб */
export const CRAB_SCREW_PER_UNIT = 1;

export function crabKind(name) {
  const n = String(name || "").toLowerCase().replace(/ё/g, "е");
  if (!n.includes("краб")) return null;
  if (/x[\s-]?образ|х[\s-]?образ/.test(n)) return "x";
  if (/г[\s-]?образ|г обр/.test(n)) return "g";
  if (/т[\s-]?образ/.test(n)) return "t";
  return null;
}

export function isCrabName(name) {
  return crabKind(name) != null;
}

/** Имя строки: из поля name или из базы материалов по materialId */
export function lineDisplayName(ln, materials) {
  const direct = String(ln?.name || "").trim();
  if (direct) return direct;
  const id = ln?.materialId;
  if (id && Array.isArray(materials)) {
    const mat = materials.find((m) => m.id === id);
    if (mat?.name) return mat.name;
  }
  return "";
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
  return (n.includes("гровер") || n.includes("шайб")) && n.includes("м6") && !n.includes("пресс");
}

export function isScrewPressWasher(name) {
  const n = normFastenerName(name);
  return n.includes("саморез") && (n.includes("пресс") || n.includes("press"));
}

export function fastenerQtyFromCrabLines(lines, materials) {
  let total = 0;
  for (const ln of lines || []) {
    if (!ln?.included) continue;
    const kind = crabKind(lineDisplayName(ln, materials));
    if (!kind) continue;
    const qty = Number(ln.qty ?? ln.defaultQty) || 0;
    if (qty <= 0) continue;
    total += qty * (CRAB_FASTENER_PER_UNIT[kind] || 0);
  }
  return total;
}

export function screwQtyFromCrabLines(lines, materials) {
  let total = 0;
  for (const ln of lines || []) {
    if (!ln?.included) continue;
    if (!crabKind(lineDisplayName(ln, materials))) continue;
    const qty = Number(ln.qty ?? ln.defaultQty) || 0;
    if (qty <= 0) continue;
    total += qty * CRAB_SCREW_PER_UNIT;
  }
  return total;
}

/** Пересчитать болты/гайки/шайбы/саморезы по количеству крабов в том же списке строк */
export function syncFastenersFromCrabs(lines, materials) {
  const boltNutTotal = fastenerQtyFromCrabLines(lines, materials);
  const screwTotal = screwQtyFromCrabLines(lines, materials);
  if (boltNutTotal <= 0 && screwTotal <= 0) return lines;

  return lines.map((ln) => {
    const n = lineDisplayName(ln, materials);
    if (isBoltM6(n) || isNutM6(n) || isWasherM6(n)) {
      if (boltNutTotal <= 0) return ln;
      return {
        ...ln,
        included: true,
        qty: boltNutTotal,
        defaultQty: boltNutTotal,
      };
    }
    if (isScrewPressWasher(n)) {
      if (screwTotal <= 0) return ln;
      return {
        ...ln,
        included: true,
        qty: screwTotal,
        defaultQty: screwTotal,
      };
    }
    return ln;
  });
}
