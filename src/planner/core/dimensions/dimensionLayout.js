const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const clampZoom = (zoom) => Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

function priorityOf(dim, selectedId) {
  if (dim?.selected || dim?.id === selectedId) return 0;
  if (dim?.auto !== true || dim?.kind === "manual") return 1;
  if (
    dim?.kind === "total"
    || dim?.kind === "wall_total"
    || dim?.kind === "external_overall"
    || dim?.kind === "external_segment"
    || dim?.kind === "internal_clear"
    || dim?.kind === "room_edge_clear"
    || dim?.style?.importance === "important"
  ) return 2;
  return 3;
}

function geometryFor(geometry, dim, index) {
  if (Array.isArray(geometry)) return geometry[index];
  if (geometry instanceof Map) return geometry.get(dim?.id);
  return geometry?.[dim?.id] || dim?.geometry;
}

function labelSize(dim, geom, viewport) {
  const text = String(dim?.label ?? dim?.labelOverride ?? Math.round(geom?.length || 0));
  const font = Number(geom?.style?.fontSizePx)
    || Number(viewport?.fontSizePx)
    || 11;
  // Glyph-tight size for collision (no card padding).
  return { width: Math.max(28, text.length * font * 0.62), height: font };
}

function overlaps(a, b, gap = 2) {
  return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
}

function screenBox(center, size, zoom) {
  const x = center.x * zoom, y = center.y * zoom;
  return {
    left: x - size.width / 2, right: x + size.width / 2,
    top: y - size.height / 2, bottom: y + size.height / 2,
    width: size.width, height: size.height,
  };
}

function wallBoxes(viewport, zoom) {
  const input = viewport?.wallBounds || viewport?.walls || [];
  return input.flatMap((wall) => {
    if (wall && [wall.minX, wall.minY, wall.maxX, wall.maxY].every(Number.isFinite)) {
      return [{ left: wall.minX * zoom, top: wall.minY * zoom, right: wall.maxX * zoom, bottom: wall.maxY * zoom }];
    }
    const pts = wall?.pts || [];
    if (!pts.length || !pts.every(finitePoint)) return [];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const pad = Number(viewport?.wallClearancePx) || 6;
    return [{
      left: Math.min(...xs) * zoom - pad, top: Math.min(...ys) * zoom - pad,
      right: Math.max(...xs) * zoom + pad, bottom: Math.max(...ys) * zoom + pad,
    }];
  });
}

export function shouldRenderDimensionLabel(dim, geometry, viewport = {}) {
  if (!dim || !geometry?.valid || dim.visible === false) return false;
  if (dim.selected || dim.id === viewport.selectedId) return true;
  const zoom = clampZoom(viewport.zoom);
  const screenLength = Math.max(0, Number(geometry.length) || 0) * zoom;
  if (priorityOf(dim, viewport.selectedId) <= 2) return screenLength >= (viewport.majorMinLengthPx ?? 24);
  return screenLength >= (viewport.autoMinLengthPx ?? 72) && zoom >= (viewport.autoMinZoom ?? 0.45);
}

/**
 * Label base = dimension-line midpoint (world). Collision may only slide ALONG
 * the dimension line — never perpendicular (that caused zoom drift).
 */
export function computeDimensionLabelLanes(dimensions = [], geometry = {}, viewport = {}) {
  const zoom = clampZoom(viewport.zoom);
  const alongStepPx = Math.max(6, Number(viewport.alongStepPx) || 10);
  return dimensions.map((dim, index) => {
    const geom = geometryFor(geometry, dim, index);
    const line = geom?.dimensionLine;
    if (!geom?.valid || !finitePoint(line?.a) || !finitePoint(line?.b)) {
      return { id: dim?.id, valid: false, visible: false, reason: "invalid" };
    }
    const dx = line.b.x - line.a.x;
    const dy = line.b.y - line.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const unit = { x: dx / len, y: dy / len };
    const base = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
    const size = labelSize(dim, geom, viewport);
    return {
      id: dim?.id,
      dim,
      geometry: geom,
      base,
      unit,
      size,
      priority: priorityOf(dim, viewport.selectedId),
      alongStepWorld: alongStepPx / zoom,
      halfSpanWorld: len / 2,
      visible: shouldRenderDimensionLabel(dim, geom, viewport),
      valid: true,
      index,
    };
  });
}

/** Stable presentation-only layout. Labels stay on the dimension line. */
export function layoutDimensionLabels(dimensions = [], geometry = {}, viewport = {}) {
  const zoom = clampZoom(viewport.zoom);
  const maxSteps = Math.max(1, Math.round(viewport.maxAlongSteps || 6));
  const occupied = [...(viewport.labelBounds || [])];
  const walls = wallBoxes(viewport, zoom);
  const lanes = computeDimensionLabelLanes(dimensions, geometry, viewport);
  const sorted = [...lanes].sort((a, b) => (a.priority - b.priority)
    || String(a.id).localeCompare(String(b.id))
    || a.index - b.index);
  const results = new Map();
  for (const item of sorted) {
    if (!item.valid || !item.visible) {
      results.set(item.id, { id: item.id, visible: false, reason: item.reason || "lod" });
      continue;
    }
    let placed = null;
    // Along-line candidates only: 0, ±1, ±2, … Never use the line normal.
    const steps = [0];
    for (let s = 1; s <= maxSteps; s++) steps.push(s, -s);
    for (const step of steps) {
      const along = item.alongStepWorld * step;
      if (Math.abs(along) > item.halfSpanWorld - item.size.width / (2 * zoom)) continue;
      const position = {
        x: item.base.x + item.unit.x * along,
        y: item.base.y + item.unit.y * along,
      };
      const bounds = screenBox(position, item.size, zoom);
      if (occupied.some((box) => overlaps(bounds, box)) || walls.some((box) => overlaps(bounds, box, 4))) {
        continue;
      }
      placed = {
        id: item.id,
        visible: true,
        position,
        bounds,
        alongDisplacementMm: along,
        lane: 0,
        priority: item.priority,
        rotationDeg: item.geometry.textAngleDeg || 0,
      };
      occupied.push(bounds);
      break;
    }
    // LIVE4.4: major auto dims (priority ≤ 2: exterior / clear / totals) must
    // stay semantically visible. Collision may only crowd their text — never
    // hide them. Only low-priority auto wall_length (3) may drop on collision.
    if (!placed && item.priority <= 2) {
      const position = { ...item.base };
      const bounds = screenBox(position, item.size, zoom);
      placed = {
        id: item.id,
        visible: true,
        position,
        bounds,
        alongDisplacementMm: 0,
        lane: 0,
        priority: item.priority,
        rotationDeg: item.geometry.textAngleDeg || 0,
        crowded: true,
      };
      occupied.push(bounds);
    }
    results.set(item.id, placed || { id: item.id, visible: false, reason: "collision" });
  }
  applyMinimumVisiblePrioritySet(sorted, results, occupied, zoom, viewport);
  return dimensions.map((dim) => results.get(dim?.id) || { id: dim?.id, visible: false, reason: "invalid" });
}

function applyMinimumVisiblePrioritySet(sorted, results, occupied, zoom, viewport) {
  const minVisible = Math.max(0, Math.round(viewport.minVisibleCount ?? 2));
  if (minVisible === 0) return;
  const floorPx = Number.isFinite(viewport.minVisibleFloorPx) ? viewport.minVisibleFloorPx : 12;
  let visibleCount = 0;
  for (const entry of results.values()) if (entry.visible) visibleCount++;
  if (visibleCount >= minVisible) return;
  for (const item of sorted) {
    if (visibleCount >= minVisible) break;
    if (item.priority > 2) continue;
    const current = results.get(item.id);
    if (current?.visible) continue;
    if (!item.valid) continue;
    const screenLen = Math.max(0, Number(item.geometry?.length) || 0) * zoom;
    if (screenLen < floorPx) continue;
    const position = { x: item.base.x, y: item.base.y };
    const bounds = screenBox(position, item.size, zoom);
    results.set(item.id, {
      id: item.id,
      visible: true,
      position,
      bounds,
      alongDisplacementMm: 0,
      lane: 0,
      priority: item.priority,
      rotationDeg: item.geometry.textAngleDeg || 0,
      forcedMinVisible: true,
    });
    occupied.push(bounds);
    visibleCount++;
  }
}
