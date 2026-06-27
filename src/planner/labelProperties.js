/** Блок 13 — подписи объектов и выноски. */

import { catalogByKind } from "./catalog.js";
import { linksForItem } from "./linkGeometry.js";
import { isDoorKind } from "./doorTypes.js";
import { isOpeningKind } from "./openingTypes.js";
import {
  isRackKind, formatRackCaption, RACK_TYPES,
} from "./rackProperties.js";

export const LABEL_DISPLAY_MODES = [
  { id: "short", label: "Короткие" },
  { id: "full", label: "Полные" },
  { id: "number", label: "Только номера" },
];

export const LABEL_AUDIENCES = [
  { id: "internal", label: "Внутренняя" },
  { id: "install", label: "Монтажная" },
  { id: "client", label: "Клиентская" },
];

const TANK_KINDS = new Set(["tank", "osmosis", "water_prep", "pump"]);
const LIGHT_KINDS = new Set(["light_panel"]);

/** Минимальный читаемый размер на экране (мм в мире плана). */
export function labelFontSize(k, zoom) {
  const z = zoom ?? (k > 0 ? 1 / k : 0.1);
  const screenPt = Math.max(9, Math.min(14, 11));
  return screenPt / z;
}

export function labelModeForItem(it, display = {}) {
  return it.labelMode || display.labelMode || "short";
}

export function labelAudienceVisible(audience = "internal", activeId) {
  const a = audience || "internal";
  if (activeId === "client") return a === "client" || a === "internal";
  if (a === "client") return false;
  return true;
}

export function labelsVisible(layerId, activeId, display = {}, sheet = null) {
  const sh = sheet || display?.sheet;
  if (display.showLabels === false) return false;
  if (activeId === "install" || sh?.id === "install") return true;
  if (activeId === "client" || sh?.id === "client") {
    return layerId !== "spec";
  }
  const sheetActive = sh?.activeLayer || activeId;
  if (display.labelHideInactive !== false) {
    return layerId === sheetActive || layerId === activeId;
  }
  return true;
}

function rackTypeLabel(it) {
  const t = RACK_TYPES.find((r) => r.id === it.rackType);
  return t?.label || "Стеллаж";
}

function linkPartnerLabel(links, items, itemId, kindFilter) {
  for (const l of linksForItem(links, itemId)) {
    const otherId = l.fromId === itemId ? l.toId : l.fromId;
    const other = items.find((i) => i.id === otherId);
    if (!other || !kindFilter(other.kind)) continue;
    return other.label || other.rackNum || other.kind;
  }
  return null;
}

/** Строки подписи объекта по режиму. */
export function buildItemLabelLines(it, plan, mode = "short") {
  if (!it) return ["?"];
  const cat = catalogByKind(it.kind);
  const links = plan?.links || [];
  const items = plan?.items || [];

  if (mode === "number") {
    const num = it.rackNum || it.doorNum || it.openingNum || it.zoneNum || it.label;
    return [String(num || "?")];
  }

  if (isRackKind(it.kind)) {
    const short = formatRackCaption(it) || it.rackNum || it.label || cat?.label;
    if (mode === "short") return [short];
    const line1 = [rackTypeLabel(it), it.rowNum ? `ряд ${it.rowNum}` : null, it.rackNum || null]
      .filter(Boolean)
      .join(" ");
    const tiers = it.tierCount || it.params?.tiers;
    const line2 = `${Math.round(it.w)}×${Math.round(it.h)}${tiers ? ` · ${tiers} ярусов` : ""}`;
    const tank = linkPartnerLabel(links, items, it.id, (k) => TANK_KINDS.has(k));
    const light = linkPartnerLabel(links, items, it.id, (k) => LIGHT_KINDS.has(k));
    const line3 = [tank ? `Бак ${tank}` : null, light ? `свет ${light}` : null].filter(Boolean).join(" · ");
    return [line1 || short, line2, line3].filter(Boolean);
  }

  if (isDoorKind(it.kind)) {
    const base = it.doorNum ? `Дверь ${it.doorNum}` : (it.label || cat?.label);
    return mode === "full" ? [base, cat?.label].filter(Boolean) : [base];
  }

  if (isOpeningKind(it.kind)) {
    const base = it.openingNum ? `Проём ${it.openingNum}` : (it.label || cat?.label);
    return mode === "full" ? [base, cat?.label].filter(Boolean) : [base];
  }

  const base = it.label || cat?.label || "?";
  if (mode === "full") {
    const extra = [];
    if (it.zoneName) extra.push(it.zoneName);
    if (it.w && it.h) extra.push(`${Math.round(it.w)}×${Math.round(it.h)}`);
    return extra.length ? [base, extra.join(" · ")] : [base];
  }
  return [base];
}

export function itemAnchor(it) {
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}

/** Авторазмещение подписи: снаружи для мелких объектов. */
export function autoItemLabelPlacement(it, room = null) {
  const anchor = itemAnchor(it);
  const small = Math.min(it.w, it.h) < 500 || it.w * it.h < 400_000;
  const rcx = room?.w ? room.w / 2 : anchor.x;
  const rcy = room?.h ? room.h / 2 : anchor.y;
  const dx = anchor.x - rcx;
  const dy = anchor.y - rcy;
  const dist = Math.hypot(dx, dy) || 1;
  const push = Math.max(it.w, it.h) * 0.55 + 350;
  if (small) {
    return {
      anchor,
      x: anchor.x + (dx / dist) * push,
      y: anchor.y + (dy / dist) * push,
      external: true,
    };
  }
  return {
    anchor,
    x: anchor.x,
    y: it.y + it.h + Math.max(180, it.h * 0.15),
    external: false,
  };
}

export function resolveFreeLabelPosition(lb, target) {
  if (!target) return { x: lb.x, y: lb.y, anchor: null };
  const anchor = itemAnchor(target);
  if (lb.pinned) return { x: lb.x, y: lb.y, anchor };
  const ox = lb.offsetX ?? (lb.x - anchor.x);
  const oy = lb.offsetY ?? (lb.y - anchor.y);
  return { x: anchor.x + ox, y: anchor.y + oy, anchor };
}

export function defaultFreeLabelFields(target, pos, text) {
  const anchor = target ? itemAnchor(target) : { x: pos.x, y: pos.y };
  return {
    text: text || "Подпись",
    targetId: target?.id || null,
    x: pos.x,
    y: pos.y,
    offsetX: pos.x - anchor.x,
    offsetY: pos.y - anchor.y,
    pinned: false,
    audience: "internal",
  };
}

export function labelBoxMetrics(lines, k, zoom) {
  const fs = labelFontSize(k, zoom);
  const padX = 6 * k;
  const padY = 5 * k;
  const lineH = fs * 1.35;
  const w = Math.max(90 * k, ...lines.map((s) => s.length * fs * 0.58)) + padX * 2;
  const h = lines.length * lineH + padY * 2;
  return { w, h, fs, lineH, padX, padY };
}

/** Пересечения подписей — предупреждения. */
export function collectLabelWarnings(plan, display = {}) {
  if (display.showLabels === false) return [];
  const warnings = [];
  const boxes = [];

  const addBox = (id, x, y, w, h, text) => {
    boxes.push({ id, x, y, w, h, text });
  };

  (plan.items || []).forEach((it) => {
    const mode = labelModeForItem(it, display);
    if (mode === "number" && display.labelMode === "off") return;
    const lines = buildItemLabelLines(it, plan, mode);
    const place = autoItemLabelPlacement(it, plan.room);
    const k = 1;
    const { w, h } = labelBoxMetrics(lines, k, 0.1);
    addBox(it.id, place.x - w / 2, place.y, w, h, lines[0]);
  });

  (plan.labels || []).forEach((lb) => {
    const tgt = lb.targetId ? plan.items.find((i) => i.id === lb.targetId) : null;
    const pos = resolveFreeLabelPosition(lb, tgt);
    const lines = (lb.text || "").split("\n").filter(Boolean);
    const { w, h } = labelBoxMetrics(lines, 1, 0.1);
    addBox(lb.id, pos.x, pos.y, w, h, lines[0]);
  });

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        warnings.push({
          id: `label-overlap-${a.id}-${b.id}`,
          severity: "warning",
          objectIds: [a.id, b.id].filter((id) => plan.items.some((it) => it.id === id)),
          text: `Подписи пересекаются: «${a.text}» и «${b.text}»`,
        });
      }
    }
  }
  return warnings;
}
