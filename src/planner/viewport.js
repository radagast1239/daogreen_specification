export const PLANNER_MIN_ZOOM = 0.01;
export const PLANNER_MAX_ZOOM = 3;
export const PLANNER_DEFAULT_ZOOM = 0.08;

const finite = (value) => Number.isFinite(Number(value));
const point = (value) => value && finite(value.x) && finite(value.y)
  ? { x: Number(value.x), y: Number(value.y) }
  : null;

function createCollector() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  const add = (value, radius = 0) => {
    const p = point(value);
    if (!p) return;
    const r = finite(radius) ? Math.max(0, Number(radius)) : 0;
    minX = Math.min(minX, p.x - r); minY = Math.min(minY, p.y - r);
    maxX = Math.max(maxX, p.x + r); maxY = Math.max(maxY, p.y + r); count += 1;
  };
  const addRect = (x, y, w, h) => {
    if (![x, y, w, h].every(finite)) return;
    add({ x: Number(x), y: Number(y) });
    add({ x: Number(x) + Number(w), y: Number(y) + Number(h) });
  };
  const result = () => count ? {
    minX, minY, maxX, maxY, x: minX, y: minY,
    width: maxX - minX, height: maxY - minY, count, empty: false,
  } : null;
  return { add, addRect, result };
}

const values = (value) => Array.isArray(value) ? value : (value && typeof value === "object" ? Object.values(value) : []);
const pointsOf = (entity) => entity?.pts || entity?.points || entity?.polygon || entity?.poly || entity?.vertices || [];

function addRotatedRect(c, entity) {
  const x = Number(entity?.x), y = Number(entity?.y);
  const w = Number(entity?.w ?? entity?.width), h = Number(entity?.h ?? entity?.height);
  if (![x, y, w, h].every(Number.isFinite)) return false;
  const angle = Number(entity?.angle ?? entity?.rotation ?? entity?.rotationDeg) || 0;
  const radians = Math.abs(angle) > Math.PI * 2 ? angle * Math.PI / 180 : angle;
  const cx = entity?.origin === "center" || entity?.centered ? x : x + w / 2;
  const cy = entity?.origin === "center" || entity?.centered ? y : y + h / 2;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  for (const [dx, dy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
    c.add({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos });
  }
  return true;
}

function addDimension(c, dim) {
  const a = point(dim?.p1 || dim?.a), b = point(dim?.p2 || dim?.b);
  if (!a || !b) return;
  c.add(a); c.add(b);
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const offset = finite(dim?.offset) ? Number(dim.offset) : 0;
  const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
  c.add({ x: a.x + nx * offset, y: a.y + ny * offset });
  c.add({ x: b.x + nx * offset, y: b.y + ny * offset });
}

/** Collect persisted, visible plan geometry only. UI/session overlays are intentionally absent. */
export function computePlanContentBounds(plan = {}, options = {}) {
  const c = createCollector();
  const nodes = plan?.nodes || {};
  values(nodes).forEach((p) => c.add(p));
  for (const wall of values(plan?.walls)) {
    const radius = Math.max(0, Number(wall?.thickness ?? wall?.thk ?? wall?.width) || 0) / 2;
    const pts = pointsOf(wall);
    if (pts.length) pts.forEach((p) => c.add(p, radius));
    else {
      const a = point(typeof wall?.a === "string" ? nodes[wall.a] : wall?.a);
      const b = point(typeof wall?.b === "string" ? nodes[wall.b] : wall?.b);
      c.add(a, radius); c.add(b, radius);
    }
  }
  for (const key of ["items", "objects", "doors", "windows", "structurals"]) {
    for (const entity of values(plan?.[key])) {
      if (!addRotatedRect(c, entity)) {
        pointsOf(entity).forEach((p) => c.add(p));
        c.add(entity);
      }
    }
  }
  for (const key of ["rooms", "zones", "lines", "links", "rulers", "measurements"]) {
    for (const entity of values(plan?.[key])) {
      const pts = pointsOf(entity);
      if (pts.length) pts.forEach((p) => c.add(p));
      else { c.add(entity?.a); c.add(entity?.b); c.add(entity?.p1); c.add(entity?.p2); }
    }
  }
  values(plan?.dimensions).forEach((dim) => addDimension(c, dim));
  // Auto-generated runtime dimensions (external_overall, wall_length,
  // internal_clear, ...) are computed on the fly from walls/rooms and are
  // never part of persisted plan.dimensions -- without this, Fit frames only
  // the wall geometry itself and the primary overall/room-facing dimension
  // labels (offset outside the wall bounds) render off-canvas.
  values(options.extraDimensions).forEach((dim) => addDimension(c, dim));
  const backdrop = plan?.room?.backdrop || plan?.backgroundPlan || plan?.background;
  if (backdrop && options.includeBackground !== false && (backdrop.dataUrl || backdrop.url || backdrop.src || backdrop.bounds)) {
    const b = backdrop.bounds || backdrop;
    c.addRect(b.x ?? b.minX ?? 0, b.y ?? b.minY ?? 0,
      b.w ?? b.width ?? (finite(b.maxX) && finite(b.minX) ? b.maxX - b.minX : NaN),
      b.h ?? b.height ?? (finite(b.maxY) && finite(b.minY) ? b.maxY - b.minY : NaN));
  }
  const found = c.result();
  if (found) return found;
  const size = Math.max(1, Number(options.emptySize) || 1000);
  return { minX: -size / 2, minY: -size / 2, maxX: size / 2, maxY: size / 2,
    x: -size / 2, y: -size / 2, width: size, height: size, count: 0, empty: true };
}

export function clampPlannerZoom(zoom, minZoom = PLANNER_MIN_ZOOM, maxZoom = PLANNER_MAX_ZOOM) {
  const min = finite(minZoom) ? Number(minZoom) : PLANNER_MIN_ZOOM;
  const max = finite(maxZoom) ? Math.max(min, Number(maxZoom)) : PLANNER_MAX_ZOOM;
  const value = finite(zoom) ? Number(zoom) : PLANNER_DEFAULT_ZOOM;
  return Math.min(max, Math.max(min, value));
}

export function createViewportInsets(layout = {}) {
  const px = (value) => finite(value) ? Math.max(0, Number(value)) : 0;
  return Object.freeze({
    top: px(layout.top ?? layout.topbar), right: px(layout.right ?? layout.inspector),
    bottom: px(layout.bottom ?? layout.bottomBar), left: px(layout.left ?? layout.leftRail),
  });
}

export function computeFitTransform({ plan, bounds: suppliedBounds, width, height, viewport, insets, padding = 48,
  minZoom = PLANNER_MIN_ZOOM, maxZoom = PLANNER_MAX_ZOOM, reason = "fit" } = {}) {
  const outerWidth = Math.max(1, Number(viewport?.width ?? width) || 1);
  const outerHeight = Math.max(1, Number(viewport?.height ?? height) || 1);
  const edge = createViewportInsets(insets);
  const available = { x: edge.left, y: edge.top,
    width: Math.max(1, outerWidth - edge.left - edge.right),
    height: Math.max(1, outerHeight - edge.top - edge.bottom) };
  const pad = finite(padding) ? Math.max(0, Number(padding)) : 48;
  const contentWidth = Math.max(Number(suppliedBounds?.width) || 0, 1);
  const contentHeight = Math.max(Number(suppliedBounds?.height) || 0, 1);
  const bounds = suppliedBounds || computePlanContentBounds(plan);
  const bw = Math.max(Number(bounds.width) || 0, 1), bh = Math.max(Number(bounds.height) || 0, 1);
  const zoom = clampPlannerZoom(Math.min(
    Math.max(1, available.width - pad * 2) / bw,
    Math.max(1, available.height - pad * 2) / bh,
  ), minZoom, maxZoom);
  const centerX = available.x + available.width / 2, centerY = available.y + available.height / 2;
  return { zoom,
    panX: centerX - (bounds.minX + (Number(bounds.width) || contentWidth) / 2) * zoom,
    panY: centerY - (bounds.minY + (Number(bounds.height) || contentHeight) / 2) * zoom,
    bounds, viewport: { width: outerWidth, height: outerHeight, available, insets: edge, padding: pad }, reason };
}

const identityKey = (value) => value == null ? "" : (typeof value === "object"
  ? `${value.mode || value.type || "project"}:${value.id ?? value.projectId ?? ""}` : String(value));

/** Pure auto-fit decision. Keep `manual` true after any user pan/zoom for the active identity. */
export function shouldAutoFitPlan(previous = {}, next = {}, reason = "render") {
  if (reason === "fit-button" || reason === "reset" || reason === "import") return true;
  if (previous?.manual || next?.manual) return false;
  const previousId = identityKey(previous?.identity ?? previous);
  const nextId = identityKey(next?.identity ?? next);
  if (!nextId) return false;
  if (!previousId || previousId !== nextId) return true;
  if (!previous?.hasGeometry && next?.hasGeometry && !previous?.fitted) return true;
  return false;
}
