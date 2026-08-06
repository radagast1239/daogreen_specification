/**
 * PHASE 2F1 — RemPlanner-like room edge clear dimensions.
 *
 * Every meaningful room-facing contour edge gets its own clear-length
 * dimension, placed just inside the room near that edge.
 *
 * Opposite edges with different lengths are NOT merged into one generic
 * "width"/"height". Exact semantic duplicates (same room, same edge key) are
 * suppressed.
 *
 * Pure: no React, no plan mutation.
 */
import { FACE_REF_KINDS } from "../walls/wallFaceReferences.js";
import {
  pointInLoop,
  sampleSegmentInsidePolygon,
  segmentIntersectsWallMass,
} from "../walls/renderedContours.js";
import {
  buildDimensionGenerationKey,
  roomStableKey,
  quantizeMm,
} from "./dimensionCanonicalKeys.js";

export const MIN_ROOM_EDGE_MM = 200;
/** RemPlanner-like: sit close to the measured face, not across the room centre. */
const EDGE_LANE_MM = [120, 90, 70, 50, 160, 200];

function allFillPolygons(contours) {
  const out = [];
  for (const c of contours.components || []) out.push(...(c.fillPolygons || []));
  return out;
}

function resolveInwardBaseline(p1, p2, normal, roomPolygon, fills, roomSide = null) {
  const nx = normal?.x ?? 0;
  const ny = normal?.y ?? 0;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return { ok: false };
  // Prefer contour roomSide (into the hole), then geometric probe.
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const probe = 8;
  const plusIn = pointInLoop({ x: mid.x + nx * probe, y: mid.y + ny * probe }, roomPolygon);
  const minusIn = pointInLoop({ x: mid.x - nx * probe, y: mid.y - ny * probe }, roomPolygon);
  let preferred;
  if (roomSide === "normal+") preferred = [1, -1];
  else if (roomSide === "normal-") preferred = [-1, 1];
  else preferred = plusIn && !minusIn ? [1, -1] : (!plusIn && minusIn ? [-1, 1] : [1, -1]);
  // Oblique / tight corners: try shorter lanes after the RemPlanner defaults.
  const lanes = [...EDGE_LANE_MM, 40, 30, 25];
  for (const lane of lanes) {
    for (const sign of preferred) {
      const offset = sign * lane;
      const baselineStart = { x: p1.x + nx * offset, y: p1.y + ny * offset };
      const baselineEnd = { x: p2.x + nx * offset, y: p2.y + ny * offset };
      const bm = {
        x: (baselineStart.x + baselineEnd.x) / 2,
        y: (baselineStart.y + baselineEnd.y) / 2,
      };
      if (!pointInLoop(bm, roomPolygon)) continue;
      if (!sampleSegmentInsidePolygon(baselineStart, baselineEnd, roomPolygon)) continue;
      if (segmentIntersectsWallMass(baselineStart, baselineEnd, fills, { stepMm: 25 })) continue;
      return { ok: true, offset, baselineStart, baselineEnd, offsetSide: sign };
    }
  }
  // Last resort for irregular/oblique rooms: accept a short inward offset whose
  // midpoint is inside the room even if the full baseline clips a miter.
  for (const lane of [40, 30, 20]) {
    for (const sign of preferred) {
      const offset = sign * lane;
      const baselineStart = { x: p1.x + nx * offset, y: p1.y + ny * offset };
      const baselineEnd = { x: p2.x + nx * offset, y: p2.y + ny * offset };
      const bm = {
        x: (baselineStart.x + baselineEnd.x) / 2,
        y: (baselineStart.y + baselineEnd.y) / 2,
      };
      if (!pointInLoop(bm, roomPolygon)) continue;
      if (fills.length && segmentIntersectsWallMass(baselineStart, baselineEnd, fills, { stepMm: 40 })) {
        continue;
      }
      return { ok: true, offset, baselineStart, baselineEnd, offsetSide: sign };
    }
  }
  return { ok: false };
}

function orientationOf(seg) {
  if (seg.axis === "horizontal") return "horizontal";
  if (seg.axis === "vertical") return "vertical";
  const dx = Math.abs((seg.b?.x || 0) - (seg.a?.x || 0));
  const dy = Math.abs((seg.b?.y || 0) - (seg.a?.y || 0));
  return dx >= dy ? "horizontal" : "vertical";
}

/**
 * Emit one dimension per meaningful room contour edge.
 * Includes axis-aligned and oblique (diagonal) faces.
 */
export function generateRoomEdgeClearFromContours(contours) {
  const dims = [];
  const diagnostics = [];
  const fills = allFillPolygons(contours);
  const seen = new Set();

  for (const rc of contours.roomContours || []) {
    const roomKey = roomStableKey(rc);
    const segs = (rc.segments || []).filter((s) => s && (s.len || 0) >= MIN_ROOM_EDGE_MM);
    if (!segs.length) {
      diagnostics.push({ code: "NO_ROOM_EDGE_SEGMENTS", roomId: rc.roomId });
      continue;
    }
    for (const seg of segs) {
      const p1 = { x: seg.a.x, y: seg.a.y };
      const p2 = { x: seg.b.x, y: seg.b.y };
      const baseline = resolveInwardBaseline(
        p1, p2, seg.normal, rc.roomPolygon, fills, seg.roomSide || null,
      );
      if (!baseline.ok) {
        diagnostics.push({
          code: "NO_ROOM_EDGE_LANE",
          roomId: rc.roomId,
          segmentId: seg.id,
        });
        continue;
      }
      const orientation = orientationOf(seg);
      const axisOrDirection = seg.axis === "diagonal" ? "oblique" : orientation;
      const generationKey = buildDimensionGenerationKey({
        kind: "room_edge_clear",
        orientation,
        p1,
        p2,
        roomKey,
      });
      if (seen.has(generationKey)) continue;
      seen.add(generationKey);

      dims.push({
        id: generationKey,
        generationKey,
        type: "dimension",
        mode: "linear",
        p1,
        p2,
        offset: baseline.offset,
        offsetSide: baseline.offsetSide,
        orientation,
        attachedTo: null,
        labelOverride: null,
        locked: true,
        invalid: false,
        invalidReason: null,
        auto: true,
        kind: "room_edge_clear",
        style: { importance: "important" },
        referenceKind: FACE_REF_KINDS.JOINED_ROOM_FACE,
        reference: {
          kind: FACE_REF_KINDS.JOINED_ROOM_FACE,
          roomId: rc.roomId,
          componentId: rc.componentId,
          loopId: rc.loopId,
          sourceFaceA: seg.id,
          matchedContourSegmentIds: [seg.id],
          side: "room",
          axis: axisOrDirection,
          chainRole: "room_edge",
        },
        roomId: rc.roomId || null,
        wallId: null,
        sourceWallIds: [],
        axisOrDirection,
        witnessA: p1,
        witnessB: p2,
        baselineStart: baseline.baselineStart,
        baselineEnd: baseline.baselineEnd,
        extensionA: [p1, baseline.baselineStart],
        extensionB: [p2, baseline.baselineEnd],
        labelPoint: {
          x: (baseline.baselineStart.x + baseline.baselineEnd.x) / 2,
          y: (baseline.baselineStart.y + baseline.baselineEnd.y) / 2,
        },
        measurementValue: seg.len,
      });
    }
  }
  return { dims, diagnostics };
}

/**
 * When opposite edges of a rectangular room share the same quantized length,
 * keep both (RemPlanner places one near each wall). Only suppress exact
 * generation-key duplicates (handled above).
 *
 * Helper used by tests: count unique edge lengths per axis in a room.
 */
export function roomEdgeLengthFingerprint(dims, roomId) {
  return (dims || [])
    .filter((d) => d.kind === "room_edge_clear" && (d.roomId === roomId || d.reference?.roomId === roomId))
    .map((d) => `${d.orientation}:${quantizeMm(d.measurementValue)}`)
    .sort()
    .join("|");
}
