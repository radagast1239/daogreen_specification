import { LINK_RULES } from "./linkRules.js";

export { LINK_RULES } from "./linkRules.js";
export {
  linkTypeForLayer,
  linkTypesForLayer,
  canCreateLink,
  normalizeLinkEnds,
  resolveLinkColor,
  linksVisibleOnLayer,
  findNearestLinkTarget,
  defaultLinkFields,
  buildLinkPayload,
  collectLinkWarnings,
  findRackLinkTarget,
  RACK_LINK_ACTIONS,
  LAYER_LINK_TYPE,
} from "./linkRules.js";

export function itemCenter(it) {
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}

export function orthoRoute(a, b) {
  return [a, { x: b.x, y: a.y }, b];
}

export function routePoints2D(a, b, ortho = true) {
  if (!ortho) return [a, b];
  return orthoRoute(a, b);
}

export function pathLength2D(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/** Длина связи: план + вертикальный подъём (по умолчанию до потолка). */
export function linkLengthMm(link, items, room = {}) {
  const from = items.find((i) => i.id === link.fromId);
  const to = items.find((i) => i.id === link.toId);
  if (!from || !to) return { plan2d: 0, vertical: 0, total: 0, pts: [] };
  const a = itemCenter(from);
  const b = itemCenter(to);
  const pts = routePoints2D(a, b, link.ortho !== false);
  const plan2d = pathLength2D(pts);
  const roomH = room.height || 3000;
  const vertical = link.riseMm ?? Math.round(roomH * 0.85);
  const total = plan2d + vertical;
  return { plan2d, vertical, total, pts };
}

export function linksForItem(links, itemId) {
  return (links || []).filter((l) => l.fromId === itemId || l.toId === itemId);
}

export function itemHasLinkOfType(links, itemId, type, role = "any") {
  return (links || []).some((l) => {
    if (l.type !== type) return false;
    if (role === "from") return l.fromId === itemId;
    if (role === "to") return l.toId === itemId;
    return l.fromId === itemId || l.toId === itemId;
  });
}

export function linkLabel(link, items) {
  const rule = LINK_RULES[link.type] || { label: "Связь" };
  const from = items.find((i) => i.id === link.fromId);
  const to = items.find((i) => i.id === link.toId);
  return `${rule.label}: ${from?.label || "?"} → ${to?.label || "?"}`;
}
