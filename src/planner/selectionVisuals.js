/** Блок 12 — визуал выделения, hover и статусов объектов. */

import { objectStatusStyle } from "./objectProperties.js";

export const SEL_COLORS = {
  select: "#116355",
  hover: "#5a9d8f",
  hoverFill: "rgba(17, 99, 85, 0.07)",
  error: "#a5371f",
  warning: "#d08a22",
  locked: "#8f9a94",
  hidden: "#6b7d74",
  spec: "#116355",
  noSpec: "#b9c2bd",
};

export function itemIncludedInSpec(it) {
  if (it.includedInProject === false) return false;
  const mode = it.specMode || "custom";
  return mode !== "custom";
}

export function itemIsLocked(it) {
  return it.locked === true;
}

/** Обводка и заливка объекта по состоянию. */
export function resolveItemVisual(it, {
  selected = false,
  hovered = false,
  hasError = false,
  hasWarning = false,
  highlightErrors = true,
} = {}) {
  const status = it.objectStatus || "draft";
  const excluded = it.includedInProject === false || status === "excluded";
  const hiddenClient = it.visibleToClient === false;
  const locked = itemIsLocked(it);
  const statusSt = objectStatusStyle(status);

  let stroke = it.color || "#5a5f5c";
  let strokeW = 1.4;
  let dash = null;
  let hoverFill = null;

  if (hasError && highlightErrors !== false) {
    stroke = SEL_COLORS.error;
    strokeW = 1.3;
  } else if (selected) {
    stroke = SEL_COLORS.select;
    strokeW = 2;
  } else if (hovered) {
    stroke = SEL_COLORS.hover;
    strokeW = 1.5;
    hoverFill = SEL_COLORS.hoverFill;
  } else if (status !== "draft" && status !== "approved") {
    stroke = statusSt.color;
    strokeW = 1.3;
  }

  if (status === "draft" && !selected && !(hasError && highlightErrors !== false)) {
    dash = [6, 4];
  } else if (excluded || hiddenClient) {
    dash = dash || [7, 5];
  }

  return {
    stroke,
    strokeW,
    dash,
    hoverFill,
    locked,
    hiddenClient,
    excluded,
    status,
    inSpec: itemIncludedInSpec(it),
    showReview: status === "review",
  };
}

export function warningIdsFromList(warnList) {
  const critical = new Set();
  const warning = new Set();
  (warnList || []).forEach((w) => {
    const ids = w.objectIds || [];
    if (w.severity === "critical") ids.forEach((id) => critical.add(id));
    else ids.forEach((id) => warning.add(id));
  });
  return { critical, warning };
}
