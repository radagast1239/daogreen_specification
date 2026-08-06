/**
 * PHASE 2F1-LIVE4 — zoom-responsive grip visuals vs fixed hit targets.
 * LIVE4.1 — near-wall dimension lane (screen px → world mm).
 */

export const GRIP_MODEL_RADIUS_MM = 90;
export const GRIP_VISUAL_MIN_PX = 5;
export const GRIP_VISUAL_MAX_PX = 14;
export const GRIP_HIT_MIN_PX = 32;

export const NEAR_LANE_PREFERRED_PX = 22;
export const NEAR_LANE_MIN_PX = 14;
export const NEAR_LANE_MAX_PX = 40;

/**
 * LIVE4.5 — presentation constants. Interaction hit targets stay ≥32 px;
 * visual dimension-line knockout uses only visible chrome + these margins.
 */
export const NUDGE_ARROW_RING_PX = 36;
export const NUDGE_ARROW_VISUAL_R_PX = 11;
export const NUDGE_ARROW_HIT_R_PX = 16;
/** Screen-space safety outside a visible control outline before the dim line resumes. */
export const VISUAL_KNOCKOUT_MARGIN_PX = 8;
/** Compact along-line padding around dimension text (not candidate-search padding). */
export const TEXT_KNOCKOUT_PAD_PX = 5;
/**
 * Placement / label-dodge occupancy may cover the interaction cluster.
 * Must never be fed into visual line knockout.
 */
export const INTERACTION_OCCUPANCY_PX = 42;

/** Visible grip radius in CSS/screen pixels. */
export function zoomResponsiveGripRadiusPx(zoom, {
  modelRadiusMm = GRIP_MODEL_RADIUS_MM,
  minPx = GRIP_VISUAL_MIN_PX,
  maxPx = GRIP_VISUAL_MAX_PX,
} = {}) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const raw = modelRadiusMm * z;
  return Math.min(maxPx, Math.max(minPx, raw));
}

/** Convert screen px → world mm for SVG drawn in model space. */
export function screenPxToWorldMm(px, zoom) {
  return (Number(px) || 0) / Math.max(Number(zoom) || 1, 1e-6);
}

/** World-mm radius for a zoom-responsive visual grip. */
export function zoomResponsiveGripRadiusWorld(zoom, opts) {
  return screenPxToWorldMm(zoomResponsiveGripRadiusPx(zoom, opts), zoom);
}

/** World-mm radius for a minimum screen hit target. */
export function gripHitRadiusWorld(zoom, hitPx = GRIP_HIT_MIN_PX) {
  return screenPxToWorldMm(hitPx / 2, zoom);
}

/**
 * LIVE4.5 — radius of the VISIBLE centre grip plus the visual knockout margin.
 * Invisible hit targets (GRIP_HIT_MIN_PX) must not use this path.
 */
export function visibleCentreKnockoutRadiusPx(zoom) {
  return zoomResponsiveGripRadiusPx(zoom) + VISUAL_KNOCKOUT_MARGIN_PX;
}

/**
 * Visible nudge-pad disks in wall-local screen px (origin = cluster centre,
 * +u along wall tangent, +v = left normal). Hit circles are intentionally
 * omitted — they must not enlarge the painted dimension-line gap.
 */
export function visibleNudgeControlDisksPx(zoom) {
  const centre = zoomResponsiveGripRadiusPx(zoom);
  return Object.freeze([
    { id: "centre", uPx: 0, vPx: 0, rPx: centre },
    { id: "up", uPx: 0, vPx: -NUDGE_ARROW_RING_PX, rPx: NUDGE_ARROW_VISUAL_R_PX },
    { id: "down", uPx: 0, vPx: NUDGE_ARROW_RING_PX, rPx: NUDGE_ARROW_VISUAL_R_PX },
    { id: "left", uPx: -NUDGE_ARROW_RING_PX, vPx: 0, rPx: NUDGE_ARROW_VISUAL_R_PX },
    { id: "right", uPx: NUDGE_ARROW_RING_PX, vPx: 0, rPx: NUDGE_ARROW_VISUAL_R_PX },
  ]);
}

/**
 * Project visible control disks onto a parallel dim line at signed lanePx.
 * Returns merged intervals in screen-px along the wall tangent, relative to mid.
 * Controls farther than (visualR + margin) from the dim line do not contribute.
 */
export function visualKnockoutIntervalsAlongDimPx({ zoom, lanePx = 0 } = {}) {
  const margin = VISUAL_KNOCKOUT_MARGIN_PX;
  const lane = Number.isFinite(lanePx) ? lanePx : 0;
  const raw = [];
  for (const c of visibleNudgeControlDisksPx(zoom)) {
    const reach = c.rPx + margin;
    const perp = Math.abs(c.vPx - lane);
    if (perp >= reach - 1e-9) continue;
    const half = Math.sqrt(Math.max(0, reach * reach - perp * perp));
    raw.push({ t0: c.uPx - half, t1: c.uPx + half, source: c.id });
  }
  raw.sort((a, b) => a.t0 - b.t0);
  const merged = [];
  for (const g of raw) {
    if (!merged.length || g.t0 > merged[merged.length - 1].t1 + 0.5) {
      merged.push({ t0: g.t0, t1: g.t1, sources: [g.source] });
    } else {
      const last = merged[merged.length - 1];
      last.t1 = Math.max(last.t1, g.t1);
      last.sources.push(g.source);
    }
  }
  return merged;
}

/**
 * Bounded near-wall dimension lane offset in world mm (RemPlanner close lane).
 * Preferred ~14–28 px; hard max ~40 px at any zoom.
 */
export function nearWallLaneOffsetMm(zoom, {
  preferredPx = NEAR_LANE_PREFERRED_PX,
  minPx = NEAR_LANE_MIN_PX,
  maxPx = NEAR_LANE_MAX_PX,
} = {}) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const px = Math.min(maxPx, Math.max(minPx, preferredPx));
  return px / z;
}

/**
 * LIVE4.1 — selected/live face dim lane. Alias of nearWallLaneOffsetMm.
 * Deprecated args ignored (old max(minMm, clusterPx/zoom) over-shifted labels).
 */
export function dimensionClearanceMmForActiveCluster(zoom, {
  preferredPx = NEAR_LANE_PREFERRED_PX,
  minPx = NEAR_LANE_MIN_PX,
  maxPx = NEAR_LANE_MAX_PX,
  clusterRadiusPx: _clusterRadiusPx,
  textPadPx: _textPadPx,
  minMm: _minMm,
} = {}) {
  return nearWallLaneOffsetMm(zoom, { preferredPx, minPx, maxPx });
}
