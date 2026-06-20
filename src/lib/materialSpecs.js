/** Сплит-система — поля кВт и BTU */
export function isSplitSystemName(name) {
  return /сплит/i.test(String(name || ""));
}

/** Основная вытяжка (не гофра/скотч) */
export function isExhaustFanName(name) {
  const n = String(name || "").toLowerCase();
  if (!/вытяж/i.test(n)) return false;
  if (/гофр|скотч|решётк|клапан/i.test(n)) return false;
  return true;
}

export function splitSpecFromMaterial(mat) {
  return {
    coolingKw: mat?.coolingKw ?? "",
    coolingBtu: mat?.coolingBtu ?? "",
  };
}

export function exhaustSpecFromMaterial(mat) {
  return { exhaustM3: mat?.exhaustM3 ?? "" };
}

export function materialSpecLabel(item) {
  const parts = [];
  if (isSplitSystemName(item?.name)) {
    if (item.coolingKw) parts.push(`${item.coolingKw} кВт`);
    if (item.coolingBtu) parts.push(`${item.coolingBtu} BTU`);
  }
  if (isExhaustFanName(item?.name) && item.exhaustM3) {
    parts.push(`${item.exhaustM3} м³/ч`);
  }
  return parts.join(" · ");
}
