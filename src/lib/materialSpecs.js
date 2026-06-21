export { isSplitSystemName } from "../../shared/splitSpecs.js";
export { isExhaustFanName, isPumpName, isFlowSpecName } from "../../shared/flowSpecs.js";
import { isSplitSystemName } from "../../shared/splitSpecs.js";
import { isExhaustFanName } from "../../shared/flowSpecs.js";

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
