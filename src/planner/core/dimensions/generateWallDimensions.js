import { resolvePlanWalls } from "../../wallNetwork.js";
import { isDoorKind, isOpeningKind } from "../../doorTypes.js";
import { isRackKind } from "../../rackProperties.js";
import { formatDimensionValue } from "./display.js";

const EXTERNAL_OFFSET_1 = 300;
const EXTERNAL_OFFSET_2 = 600;
const MIN_PIER_MM = 40;
const ALIGN_THR_MM = 120;

export const MIN_SERVICE_AISLE_MM = 700;
export const MIN_MAIN_AISLE_MM = 900;
export const MIN_CART_AISLE_MM = 1000;

function uniqSorted(values = [], tol = 1) {
  const out = [];
  [...values].sort((a, b) => a - b).forEach((v) => {
    const last = out[out.length - 1];
    if (last == null || Math.abs(v - last) > tol) out.push(v);
  });
  return out;
}

function createAutoLinearDimension({
  id,
  p1,
  p2,
  offset = 120,
  orientation = null,
  kind = "auto",
  labelOverride = null,
  style = null,
  attachedTo = null,
}) {
  return {
    id,
    type: "dimension",
    mode: "linear",
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    offset,
    orientation: orientation || (Math.abs((p2.x || 0) - (p1.x || 0)) >= Math.abs((p2.y || 0) - (p1.y || 0)) ? "horizontal" : "vertical"),
    attachedTo,
    labelOverride,
    locked: true,
    invalid: false,
    auto: true,
    kind,
    style,
  };
}

function wallPointsBounds(walls, room) {
  const pts = [];
  (walls || []).forEach((w) => (w.pts || []).forEach((p) => pts.push(p)));
  if (!pts.length) {
    return { minX: 0, minY: 0, maxX: room?.w || 0, maxY: room?.h || 0 };
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function collectExteriorAxisCuts(walls, axis, edgeValue) {
  const cuts = [];
  (walls || []).forEach((w) => {
    const pts = w.pts || [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (axis === "x") {
        if (Math.abs(a.y - edgeValue) <= ALIGN_THR_MM && Math.abs(b.y - edgeValue) <= ALIGN_THR_MM) {
          cuts.push(a.x, b.x);
        }
      } else if (Math.abs(a.x - edgeValue) <= ALIGN_THR_MM && Math.abs(b.x - edgeValue) <= ALIGN_THR_MM) {
        cuts.push(a.y, b.y);
      }
    }
  });
  return uniqSorted(cuts, 5);
}

function generateExteriorDimensions(walls, room) {
  const out = [];
  const b = wallPointsBounds(walls, room);
  const topCuts = collectExteriorAxisCuts(walls, "x", b.minY);
  const leftCuts = collectExteriorAxisCuts(walls, "y", b.minX);
  const xCuts = uniqSorted([b.minX, ...topCuts, b.maxX], 5);
  const yCuts = uniqSorted([b.minY, ...leftCuts, b.maxY], 5);

  for (let i = 1; i < xCuts.length; i++) {
    const x0 = xCuts[i - 1];
    const x1 = xCuts[i];
    if (x1 - x0 < MIN_PIER_MM) continue;
    out.push(createAutoLinearDimension({
      id: `auto-ext-h-seg-${i}`,
      p1: { x: x0, y: b.minY },
      p2: { x: x1, y: b.minY },
      offset: -EXTERNAL_OFFSET_1,
      orientation: "horizontal",
      kind: "external_segment",
    }));
  }
  for (let i = 1; i < yCuts.length; i++) {
    const y0 = yCuts[i - 1];
    const y1 = yCuts[i];
    if (y1 - y0 < MIN_PIER_MM) continue;
    out.push(createAutoLinearDimension({
      id: `auto-ext-v-seg-${i}`,
      p1: { x: b.minX, y: y0 },
      p2: { x: b.minX, y: y1 },
      offset: EXTERNAL_OFFSET_1,
      orientation: "vertical",
      kind: "external_segment",
    }));
  }

  out.push(createAutoLinearDimension({
    id: "auto-ext-h-overall",
    p1: { x: b.minX, y: b.minY },
    p2: { x: b.maxX, y: b.minY },
    offset: -EXTERNAL_OFFSET_2,
    orientation: "horizontal",
    kind: "external_overall",
  }));
  out.push(createAutoLinearDimension({
    id: "auto-ext-v-overall",
    p1: { x: b.minX, y: b.minY },
    p2: { x: b.minX, y: b.maxY },
    offset: EXTERNAL_OFFSET_2,
    orientation: "vertical",
    kind: "external_overall",
  }));
  return out;
}

function zoneBounds(zone) {
  if (zone?.polygon?.length >= 3) {
    const xs = zone.polygon.map((p) => p.x);
    const ys = zone.polygon.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  return {
    x: zone?.x || 0,
    y: zone?.y || 0,
    w: zone?.w || 0,
    h: zone?.h || 0,
  };
}

function generateRoomDimensions(plan, displayMode) {
  const out = [];
  (plan?.zones || []).forEach((zone, idx) => {
    const b = zoneBounds(zone);
    if (b.w < MIN_PIER_MM || b.h < MIN_PIER_MM) return;
    const areaM2 = (b.w * b.h) / 1_000_000;
    const roomSmall = areaM2 < 4;
    const labelW = formatDimensionValue(b.w, displayMode, { roomChain: true });
    const labelH = formatDimensionValue(b.h, displayMode, { roomChain: true });

    if (!roomSmall) {
      out.push(createAutoLinearDimension({
        id: `auto-room-w-${zone.id || idx}`,
        p1: { x: b.x, y: b.y + b.h },
        p2: { x: b.x + b.w, y: b.y + b.h },
        offset: 120,
        orientation: "horizontal",
        kind: "room_width",
        labelOverride: labelW,
      }));
      out.push(createAutoLinearDimension({
        id: `auto-room-h-${zone.id || idx}`,
        p1: { x: b.x, y: b.y },
        p2: { x: b.x, y: b.y + b.h },
        offset: -120,
        orientation: "vertical",
        kind: "room_height",
        labelOverride: labelH,
      }));
    }

    // Meta labels stay in dimensions collection for one rendering pipeline.
    out.push({
      id: `auto-room-meta-${zone.id || idx}`,
      type: "dimension",
      mode: "annotation",
      p1: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      p2: { x: b.x + b.w / 2, y: b.y + b.h / 2 },
      offset: 0,
      orientation: "free",
      attachedTo: { type: "zone", id: zone.id || null },
      labelOverride: roomSmall
        ? `S ${(areaM2 || 0).toFixed(2)} м² · H ${Math.round(zone?.height || plan?.room?.height || 2700)} мм`
        : `S ${(areaM2 || 0).toFixed(2)} м² · H ${Math.round(zone?.height || plan?.room?.height || 2700)} мм`,
      locked: true,
      invalid: false,
      auto: true,
      kind: "room_meta",
      style: { textOnly: true },
    });
  });
  return out;
}

function collectOpeningIntervalsOnWall(items, wall) {
  if (!wall?.pts || wall.pts.length < 2) return [];
  const out = [];
  const a = wall.pts[0];
  const b = wall.pts[wall.pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;

  (items || []).forEach((it) => {
    if (!isDoorKind(it.kind) && !isOpeningKind(it.kind)) return;
    if (!it.wallId || it.wallId !== wall.id) return;
    const c = { x: it.x + it.w / 2, y: it.y + it.h / 2 };
    const t = (c.x - a.x) * ux + (c.y - a.y) * uy;
    const openingLen = Math.max(100, Math.min(Math.max(it.w, it.h), len));
    out.push({
      item: it,
      t0: Math.max(0, t - openingLen / 2),
      t1: Math.min(len, t + openingLen / 2),
      len: openingLen,
    });
  });
  return out.sort((x, y) => x.t0 - y.t0);
}

function projectWallT(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function generateOpeningAndPierDimensions(plan, displayMode) {
  const walls = resolvePlanWalls(plan);
  const out = [];
  walls.forEach((wall) => {
    if (!wall?.pts || wall.pts.length < 2) return;
    const a = wall.pts[0];
    const b = wall.pts[wall.pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const intervals = collectOpeningIntervalsOnWall(plan.items, wall);
    if (!intervals.length) return;
    intervals.forEach((iv, i) => {
      const p1 = projectWallT(a, b, iv.t0 / len);
      const p2 = projectWallT(a, b, iv.t1 / len);
      out.push(createAutoLinearDimension({
        id: `auto-opening-${wall.id}-${iv.item.id}-${i}`,
        p1,
        p2,
        offset: 180,
        kind: "opening",
        labelOverride: formatDimensionValue(iv.len, displayMode),
        style: { importance: "important" },
        attachedTo: { type: "item", id: iv.item.id },
      }));
    });

    const cuts = uniqSorted([0, ...intervals.flatMap((iv) => [iv.t0, iv.t1]), len], 5);
    for (let i = 1; i < cuts.length; i++) {
      const t0 = cuts[i - 1];
      const t1 = cuts[i];
      const span = t1 - t0;
      if (span < MIN_PIER_MM) continue;
      const overlapsOpening = intervals.some((iv) => t0 >= iv.t0 - 1 && t1 <= iv.t1 + 1);
      if (overlapsOpening) continue;
      const p1 = projectWallT(a, b, t0 / len);
      const p2 = projectWallT(a, b, t1 / len);
      out.push(createAutoLinearDimension({
        id: `auto-pier-${wall.id}-${i}`,
        p1,
        p2,
        offset: 240,
        kind: "pier",
        labelOverride: formatDimensionValue(span, displayMode),
      }));
    }
  });
  return out;
}

function rackItems(items = []) {
  return items.filter((it) => it.category === "rack" || it.layer === "racks" || isRackKind(it.kind));
}

function overlapSpan(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function rackAisleType(rackA, rackB) {
  const t = rackA?.aisleType || rackB?.aisleType || "service";
  if (t === "cart") return { key: "cart", minMm: MIN_CART_AISLE_MM };
  if (t === "main") return { key: "main", minMm: MIN_MAIN_AISLE_MM };
  return { key: "service", minMm: MIN_SERVICE_AISLE_MM };
}

function generateRackAisles(plan, displayMode) {
  const racks = rackItems(plan?.items || []);
  const dims = [];
  const warnings = [];
  for (let i = 0; i < racks.length; i++) {
    for (let j = i + 1; j < racks.length; j++) {
      const a = racks[i];
      const b = racks[j];
      const ovY = overlapSpan(a.y, a.y + a.h, b.y, b.y + b.h);
      const ovX = overlapSpan(a.x, a.x + a.w, b.x, b.x + b.w);
      let gap = 0;
      let p1;
      let p2;
      let orientation;
      if (ovY > 100) {
        gap = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
        if (gap > 0) {
          const y = Math.max(a.y, b.y) + ovY / 2;
          if (a.x < b.x) {
            p1 = { x: a.x + a.w, y };
            p2 = { x: b.x, y };
          } else {
            p1 = { x: b.x + b.w, y };
            p2 = { x: a.x, y };
          }
          orientation = "horizontal";
        }
      } else if (ovX > 100) {
        gap = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
        if (gap > 0) {
          const x = Math.max(a.x, b.x) + ovX / 2;
          if (a.y < b.y) {
            p1 = { x, y: a.y + a.h };
            p2 = { x, y: b.y };
          } else {
            p1 = { x, y: b.y + b.h };
            p2 = { x, y: a.y };
          }
          orientation = "vertical";
        }
      }
      if (!gap || !p1 || !p2 || gap > 5000) continue;
      const aisle = rackAisleType(a, b);
      const tooSmall = gap < aisle.minMm;
      const style = tooSmall
        ? { importance: "error" }
        : aisle.minMm > MIN_SERVICE_AISLE_MM
          ? { importance: "important" }
          : { importance: "normal" };

      dims.push(createAutoLinearDimension({
        id: `auto-aisle-${a.id}-${b.id}`,
        p1,
        p2,
        offset: 120,
        orientation,
        kind: "rack_aisle",
        style,
        labelOverride: formatDimensionValue(gap, displayMode),
        attachedTo: { type: "rack_pair", ids: [a.id, b.id], aisleType: aisle.key },
      }));

      if (tooSmall) {
        warnings.push({
          id: `aisle-${a.id}-${b.id}`,
          severity: "warning",
          objectIds: [a.id, b.id],
          text: `Проход ${Math.round(gap)} мм меньше нормы ${aisle.minMm} мм`,
          source: "dimensions",
        });
      }
    }
  }
  return { dims, warnings };
}

export function generateWallDimensions(plan, opts = {}) {
  const displayMode = opts.dimensionDisplayMode || "remplanner_cm";
  const walls = resolvePlanWalls(plan);
  const dimensions = [
    ...generateExteriorDimensions(walls, plan?.room || {}),
    ...generateRoomDimensions(plan, displayMode),
    ...generateOpeningAndPierDimensions(plan, displayMode),
  ];
  const rack = generateRackAisles(plan, displayMode);
  return {
    dimensions: [...dimensions, ...rack.dims],
    validationWarnings: rack.warnings,
  };
}
