const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function placeHandleAvoidingLabels(handle, labelBounds = [], options = {}) {
  if (!finitePoint(handle)) return null;
  const zoom = Number.isFinite(options.zoom) && options.zoom > 0 ? options.zoom : 1;
  const visualPx = Math.max(8, Math.min(12, Number(handle.visualSizePx ?? options.visualSizePx) || 10));
  const gap = Number(options.gapPx) || 6;
  const candidates = [[0, 0], [0, visualPx + gap], [0, -(visualPx + gap)], [visualPx + gap, 0], [-(visualPx + gap), 0]];
  for (const [dx, dy] of candidates) {
    const screenX = handle.x * zoom + dx, screenY = handle.y * zoom + dy;
    const box = { left: screenX - visualPx / 2, right: screenX + visualPx / 2,
      top: screenY - visualPx / 2, bottom: screenY + visualPx / 2 };
    if (!(labelBounds || []).some((label) => intersects(box, label))) {
      return { ...handle, x: screenX / zoom, y: screenY / zoom, visualSizePx: visualPx,
        hitSizePx: Math.max(visualPx, Number(handle.hitSizePx ?? options.hitSizePx) || 22), displaced: dx !== 0 || dy !== 0 };
    }
  }
  return { ...handle, visualSizePx: visualPx, hitSizePx: Math.max(visualPx, Number(options.hitSizePx) || 22), crowded: true };
}

export function computeSelectionHandles(selection = {}, options = {}) {
  if (!selection || (!selection.selected && !selection.hovered && !selection.toolActive)) return [];
  const points = selection.points || selection.endpoints || [];
  const raw = [];
  points.filter(finitePoint).forEach((p, index) => raw.push({ id: `endpoint-${index}`, ...p, glyph: "endpoint" }));
  if (finitePoint(selection.movePoint || selection.center)) raw.push({ id: "move", ...(selection.movePoint || selection.center), glyph: "move" });
  if (finitePoint(selection.offsetPoint)) raw.push({ id: "offset", ...selection.offsetPoint, glyph: "offset" });
  return raw.map((handle) => placeHandleAvoidingLabels(handle, options.labelBounds, options)).filter(Boolean);
}
