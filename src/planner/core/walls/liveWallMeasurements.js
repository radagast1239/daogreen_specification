/**
 * PHASE 2F1-LIVE — transient live wall measurements.
 *
 * Pure: derived from draft / preview geometry only. Never creates persisted
 * dimension records. Face lengths reuse accepted wall-face offsets
 * (wallFaceSegment), not visual fudge.
 */
import { wallFaceSegment } from "../../wallParallelGeometry.js";
import { resolvePlanWalls } from "../../wallNetwork.js";
import { moveNode } from "./wallCommands.js";
import { resolveLogicalWallChain, isInternalChainNode } from "./logicalWallChain.js";
import { buildRenderedContours } from "./renderedContours.js";
import {
  resolveLogicalSelectedWallPhysicalSpans,
  openChainExteriorFaceSpan,
  canonicalDirSign,
} from "./selectedWallPhysicalSpans.js";
import { buildSelectedWallCornerAngles } from "../dimensions/cornerAngleDimensions.js";

const FACE_DIFF_EPS_MM = 0.5;
const MIN_LENGTH_MM = 1;
const HOST_DIST_EPS_MM = 0.5;

const isFinitePt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

function dist(a, b) {
  if (!isFinitePt(a) || !isFinitePt(b)) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function angleDeg(a, b) {
  if (!isFinitePt(a) || !isFinitePt(b)) return 0;
  let d = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (d < 0) d += 360;
  return d;
}

/** Included corner angle between vectors BA and BC in [0, 180]. */
export function includedCornerAngleDeg(prevA, joint, nextB) {
  if (!isFinitePt(prevA) || !isFinitePt(joint) || !isFinitePt(nextB)) return null;
  const v1x = prevA.x - joint.x;
  const v1y = prevA.y - joint.y;
  const v2x = nextB.x - joint.x;
  const v2y = nextB.y - joint.y;
  const l1 = Math.hypot(v1x, v1y) || 1;
  const l2 = Math.hypot(v2x, v2y) || 1;
  const dot = (v1x / l1) * (v2x / l2) + (v1y / l1) * (v2y / l2);
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * Display formatter for live canvas labels.
 * < 1000 mm → "NNN мм"; else "N.NN м" (matches fmtWallDraftLen / architectural).
 */
export function formatLiveLength(mm) {
  if (!Number.isFinite(mm)) return "—";
  const abs = Math.abs(mm);
  if (abs < 1000) return `${Math.round(mm)} мм`;
  return `${(mm / 1000).toFixed(2)} м`;
}

export function formatLiveAngle(deg, { snapped = false } = {}) {
  if (!Number.isFinite(deg)) return "—";
  const s = `${deg.toFixed(1)}°`;
  return snapped ? s : s;
}

/**
 * Parse user length input.
 *
 * Rules:
 * - bare integer/float with |value| >= 100 → millimetres (3000 → 3000 mm)
 * - bare value with |value| < 100 → metres (3 → 3000 mm) ONLY when unitless
 *   AND looks like metres (has decimal OR < 100); integers 100–999 stay mm
 * - explicit "м" / "m" → metres
 * - explicit "мм" / "mm" → millimetres
 * - never treat bare 3000 as metres
 * - opts.bareAsMm (LIVE3 draw typing): every bare number is millimetres
 */
export function parseLengthInput(text, opts = {}) {
  if (text == null) return { ok: false, reason: "empty", mm: null };
  const raw = String(text).trim().replace(",", ".");
  if (!raw) return { ok: false, reason: "empty", mm: null };
  if (/e/i.test(raw)) return { ok: false, reason: "scientific", mm: null };

  const mMm = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:мм|mm)$/i);
  if (mMm) {
    const mm = Number(mMm[1]);
    if (!Number.isFinite(mm) || mm <= 0) return { ok: false, reason: "non_positive", mm: null };
    return { ok: true, mm, unit: "mm", reason: null };
  }
  const mM = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:м|m)$/i);
  if (mM) {
    const metres = Number(mM[1]);
    if (!Number.isFinite(metres) || metres <= 0) return { ok: false, reason: "non_positive", mm: null };
    return { ok: true, mm: metres * 1000, unit: "m", reason: null };
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return { ok: false, reason: "invalid", mm: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "non_positive", mm: null };
  // LIVE3 draw: bare integers are always millimetres (3000 → 3000 mm, 3 → 3 mm).
  if (opts.bareAsMm) return { ok: true, mm: n, unit: "mm", reason: null };
  // Bare ≥100 → mm (3000 mm). Bare <100 → metres (3 → 3.00 м).
  if (n >= 100) return { ok: true, mm: n, unit: "mm", reason: null };
  return { ok: true, mm: n * 1000, unit: "m", reason: null };
}

function physicalFaceLengths(start, end, thk, thicknessSide, room) {
  const wall = { thk: thk || 100, thicknessSide: thicknessSide || "center" };
  const outer = wallFaceSegment(start, end, "outer", wall, room);
  const inner = wallFaceSegment(start, end, "inner", wall, room);
  const leftLen = dist(outer.a, outer.b);
  const rightLen = dist(inner.a, inner.b);
  return {
    leftFaceMm: leftLen,
    rightFaceMm: rightLen,
    leftSeg: outer,
    rightSeg: inner,
    facesDiffer: Math.abs(leftLen - rightLen) > FACE_DIFF_EPS_MM,
  };
}

function projectParam(a, b, p) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

/**
 * Host distances when a branch start sits on a logical host.
 * left + right ≈ total (centerline of logical host).
 */
export function hostJunctionDistances(plan, hostWallId, junctionPt) {
  if (!plan || !hostWallId || !isFinitePt(junctionPt)) return null;
  const chain = resolveLogicalWallChain(plan, hostWallId);
  if (!chain?.ok || !chain.a || !chain.b) return null;
  const total = chain.totalLengthMm;
  if (!(total > 0)) return null;
  const t = Math.max(0, Math.min(1, projectParam(chain.a, chain.b, junctionPt)));
  const left = total * t;
  const right = total - left;
  return {
    hostWallId,
    logicalId: chain.logicalId,
    totalMm: total,
    leftMm: left,
    rightMm: right,
    sumOk: Math.abs(left + right - total) <= HOST_DIST_EPS_MM,
    a: chain.a,
    b: chain.b,
  };
}

/**
 * Authoritative draw segment for live UI.
 *
 * V2 hold: use preview.start → preview.end (never last+cursor — that is ~0).
 * Click-chain: draft[last] → resolved cursor.
 * Returns null when there is no valid non-degenerate source (caller hides UI).
 */
export function resolveLiveDrawSegment({
  v2Preview = null,
  draft = null,
  cursor = null,
  minLenMm = MIN_LENGTH_MM,
} = {}) {
  if (v2Preview?.start && v2Preview?.end && v2Preview.moved !== false) {
    const start = v2Preview.start;
    const end = v2Preview.end;
    if (!isFinitePt(start) || !isFinitePt(end)) return null;
    const lengthMm = Number.isFinite(v2Preview.lengthMm)
      ? v2Preview.lengthMm
      : dist(start, end);
    if (!(lengthMm >= minLenMm)) {
      return { mode: "draw_v2", start, end, lengthMm: 0, valid: false, hostWallId: null, prevPoint: null };
    }
    return {
      mode: "draw_v2",
      start: { ...start },
      end: { ...end },
      lengthMm,
      valid: true,
      hostWallId: v2Preview.startSnap?.hostWallId
        || v2Preview.startSnap?.wallId
        || null,
      prevPoint: null,
      startSnap: v2Preview.startSnap || null,
      endSnap: v2Preview.endSnap || null,
    };
  }
  const pts = Array.isArray(draft) ? draft : [];
  if (pts.length >= 1 && isFinitePt(cursor)) {
    const start = pts[pts.length - 1];
    const prevPoint = pts.length >= 2 ? pts[pts.length - 2] : null;
    if (!isFinitePt(start)) return null;
    const lengthMm = dist(start, cursor);
    if (!(lengthMm >= minLenMm)) {
      return {
        mode: "draw_chain",
        start: { ...start },
        end: { ...cursor },
        lengthMm: 0,
        valid: false,
        hostWallId: null,
        prevPoint,
      };
    }
    return {
      mode: "draw_chain",
      start: { ...start },
      end: { ...cursor },
      lengthMm,
      valid: true,
      hostWallId: null,
      prevPoint: prevPoint && isFinitePt(prevPoint) ? { ...prevPoint } : null,
    };
  }
  return null;
}

/** Dev/test assertion: reject NaN/Inf/zero placeholders that must never paint. */
export function assertLiveMeasurementModel(model, { allowZero = false } = {}) {
  if (!model) return { ok: true, model: null };
  const bad = [];
  if (!Number.isFinite(model.centerlineMm) || (!allowZero && model.centerlineMm <= 0 && model.labels?.some((l) => l.role === "primary"))) {
    bad.push("invalid_centerline");
  }
  for (const lab of model.labels || []) {
    if (lab.mm != null && (!Number.isFinite(lab.mm) || lab.mm < 0)) bad.push(`label_mm:${lab.id}`);
    if (lab.deg != null && !Number.isFinite(lab.deg)) bad.push(`label_deg:${lab.id}`);
    if (lab.text === "0 мм" && !allowZero && model.centerlineMm > MIN_LENGTH_MM) bad.push(`zero_text:${lab.id}`);
    if (lab.text === "0.0°" && lab.deg == null) bad.push(`zero_angle:${lab.id}`);
  }
  return { ok: bad.length === 0, bad, model };
}

/**
 * Live measurements while drawing a wall segment (draft / V2 band).
 */
export function buildLiveWallDrawMeasurements({
  start,
  end,
  thk = 100,
  thicknessSide = "center",
  room = null,
  prevPoint = null,
  hostWallId = null,
  plan = null,
  snap = null,
  angleSnap = null,
} = {}) {
  if (!isFinitePt(start) || !isFinitePt(end)) return null;
  const centerlineMm = dist(start, end);
  if (centerlineMm < MIN_LENGTH_MM) {
    // Initial click / sub-threshold — hide labels (never paint "0 мм").
    return {
      kind: "draw",
      centerlineMm: 0,
      labels: [],
      valid: false,
    };
  }
  const faces = physicalFaceLengths(start, end, thk, thicknessSide, room);
  const draftAngle = angleDeg(start, end);
  const snapped = !!(angleSnap?.isSnapped || angleSnap?.snapped || snap?.snapped);
  const snapAngle = angleSnap?.snappedAngle ?? angleSnap?.angle ?? null;
  let cornerDeg = null;
  if (isFinitePt(prevPoint)) {
    cornerDeg = includedCornerAngleDeg(prevPoint, start, end);
  }
  const host = hostWallId && plan
    ? hostJunctionDistances(plan, hostWallId, start)
    : null;

  const labels = [];
  // Primary — centerline command length along the draft
  labels.push({
    role: "primary",
    id: "live-len",
    text: formatLiveLength(centerlineMm),
    mm: centerlineMm,
    a: start,
    b: end,
    offsetSide: -1,
  });
  // Thickness at active end
  labels.push({
    role: "secondary",
    id: "live-thk",
    text: formatLiveLength(thk),
    mm: thk,
    kind: "thickness",
    at: end,
    start,
    end,
  });
  if (faces.facesDiffer) {
    labels.push({
      role: "secondary",
      id: "live-face-L",
      text: formatLiveLength(faces.leftFaceMm),
      mm: faces.leftFaceMm,
      a: faces.leftSeg.a,
      b: faces.leftSeg.b,
      offsetSide: -1,
    });
    labels.push({
      role: "secondary",
      id: "live-face-R",
      text: formatLiveLength(faces.rightFaceMm),
      mm: faces.rightFaceMm,
      a: faces.rightSeg.a,
      b: faces.rightSeg.b,
      offsetSide: 1,
    });
  }
  // Angle only when geometrically meaningful (connected corner). Never emit a
  // free-wall direction bearing as "0.0°" — that was the LIVE acceptance defect.
  if (cornerDeg != null && Number.isFinite(cornerDeg)) {
    labels.push({
      role: "secondary",
      id: "live-corner",
      text: formatLiveAngle(cornerDeg, { snapped }),
      deg: cornerDeg,
      kind: "corner",
      at: start,
      snapped,
    });
  } else if (snapped && snapAngle != null && Number.isFinite(snapAngle)) {
    labels.push({
      role: "secondary",
      id: "live-snap-ang",
      text: formatLiveAngle(snapAngle, { snapped: true }),
      deg: snapAngle,
      kind: "corner",
      at: end,
      snapped: true,
    });
  }
  if (host) {
    labels.push({
      role: "context",
      id: "live-host-total",
      text: `Σ ${formatLiveLength(host.totalMm)}`,
      mm: host.totalMm,
      kind: "host_total",
    });
    labels.push({
      role: "context",
      id: "live-host-L",
      text: formatLiveLength(host.leftMm),
      mm: host.leftMm,
      kind: "host_left",
      a: host.a,
      b: junctionPointOnHost(host, host.leftMm),
    });
    labels.push({
      role: "context",
      id: "live-host-R",
      text: formatLiveLength(host.rightMm),
      mm: host.rightMm,
      kind: "host_right",
      a: junctionPointOnHost(host, host.leftMm),
      b: host.b,
    });
  }

  return {
    kind: "draw",
    valid: true,
    centerlineMm,
    thkMm: thk,
    leftFaceMm: faces.leftFaceMm,
    rightFaceMm: faces.rightFaceMm,
    facesDiffer: faces.facesDiffer,
    draftAngleDeg: draftAngle,
    cornerDeg,
    snapped,
    snapAngleDeg: snapAngle,
    host,
    start: { ...start },
    end: { ...end },
    labels,
  };
}

/**
 * Screen-space placement for the compact floating length editor.
 * Values are CSS px relative to the SVG client rect (fixed overlay).
 */
export function placeFloatingEditorScreen({
  anchorWorld,
  view,
  svgRect,
  width = 200,
  height = 78,
  offsetX = 28,
  offsetY = -56,
  margin = 8,
} = {}) {
  if (!isFinitePt(anchorWorld) || !view || !svgRect) return null;
  const zoom = view.zoom || 1;
  let left = svgRect.left + (view.panX || 0) + anchorWorld.x * zoom + offsetX;
  let top = svgRect.top + (view.panY || 0) + anchorWorld.y * zoom + offsetY;
  const vw = typeof window !== "undefined" ? window.innerWidth : svgRect.right;
  const vh = typeof window !== "undefined" ? window.innerHeight : svgRect.bottom;
  if (left + width + margin > vw) left = svgRect.left + (view.panX || 0) + anchorWorld.x * zoom - width - offsetX;
  if (top < margin) top = svgRect.top + (view.panY || 0) + anchorWorld.y * zoom + 24;
  if (top + height + margin > vh) top = Math.max(margin, vh - height - margin);
  if (left < margin) left = margin;
  if (left + width + margin > vw) left = Math.max(margin, vw - width - margin);
  return { left, top, width, height };
}

function junctionPointOnHost(host, leftMm) {
  if (!host?.a || !host?.b || !(host.totalMm > 0)) return host?.a || null;
  const t = leftMm / host.totalMm;
  return {
    x: host.a.x + (host.b.x - host.a.x) * t,
    y: host.a.y + (host.b.y - host.a.y) * t,
  };
}

function wallEndpoints(plan, wallId) {
  const walls = resolvePlanWalls(plan);
  const w = walls.find((x) => x.id === wallId);
  if (!w?.pts || w.pts.length < 2) return null;
  return {
    wall: w,
    a: w.pts[0],
    b: w.pts[w.pts.length - 1],
    thk: w.thk || 100,
    thicknessSide: w.thicknessSide || "center",
  };
}

function nodeValence(plan, nodeId) {
  if (!nodeId) return 0;
  return (plan.walls || []).filter((w) => w.a === nodeId || w.b === nodeId).length;
}

/**
 * Live measurements during wall edit / selected-wall interactive display.
 * LIVE4: primary canvas lengths are joined physical faces (not centreline).
 * Editable command length remains centerlineMm for the compact editor.
 */
export function buildLiveWallEditMeasurements({
  previewPlan,
  basePlan = null,
  wallId,
  editKind = "endpoint",
  selectedEndpoint = null,
  room = null,
} = {}) {
  const plan = previewPlan || basePlan;
  if (!plan || !wallId) return null;
  const ep = wallEndpoints(plan, wallId);
  if (!ep) return null;
  // LIVE4.3 — measure the highlighted logical host, not one topology half.
  // resolveLogicalSelectedWallPhysicalSpans falls back to the single segment
  // when there is no proven multi-segment chain.
  const chain = resolveLogicalWallChain(plan, wallId);
  const physical = resolveLogicalSelectedWallPhysicalSpans(plan, wallId, {
    room: room || plan.room,
  });
  const measureA = physical?.centerline?.a || chain?.a || ep.a;
  const measureB = physical?.centerline?.b || chain?.b || ep.b;
  const centerlineMm = physical?.centerline?.lengthMm > 0
    ? physical.centerline.lengthMm
    : dist(measureA, measureB);
  if (!(centerlineMm >= MIN_LENGTH_MM)) {
    return { kind: "edit", editKind, wallId, centerlineMm: 0, labels: [], valid: false };
  }
  const faces = physical
    ? {
      leftFaceMm: physical.faceA.lengthMm,
      rightFaceMm: physical.faceB.lengthMm,
      leftSeg: { a: physical.faceA.a, b: physical.faceA.b },
      rightSeg: { a: physical.faceB.a, b: physical.faceB.b },
      facesDiffer: physical.facesDiffer,
    }
    : physicalFaceLengths(measureA, measureB, ep.thk, ep.thicknessSide, room || plan.room);

  // PHASE 2F1-LIVE4.2 — which physical face is the true exterior of an open
  // chain. Reported, never used to change a measurement: presentation code must
  // be able to keep the exterior VALUE in the exterior lane when level of
  // detail allows only one face label. Closed rooms report null (both faces are
  // room faces and the closed-room semantics stay frozen).
  let exteriorSideKey = null;
  try {
    exteriorSideKey = openChainExteriorFaceSpan(plan, wallId)?.sideKey ?? null;
  } catch {
    exteriorSideKey = null;
  }

  const labels = [];
  // LIVE4 selected-wall contract: both physical faces on opposite sides when
  // they differ; a single face length when they are equal (no centreline dim).
  if (faces.facesDiffer) {
    labels.push({
      role: "primary",
      id: "live-edit-face-A",
      text: formatLiveLength(faces.leftFaceMm),
      mm: faces.leftFaceMm,
      a: faces.leftSeg.a,
      b: faces.leftSeg.b,
      offsetSide: -1,
      kind: "face",
      face: "A",
      exterior: exteriorSideKey === "A",
    });
    labels.push({
      role: "primary",
      id: "live-edit-face-B",
      text: formatLiveLength(faces.rightFaceMm),
      mm: faces.rightFaceMm,
      a: faces.rightSeg.a,
      b: faces.rightSeg.b,
      offsetSide: 1,
      kind: "face",
      face: "B",
      exterior: exteriorSideKey === "B",
    });
  } else {
    // PHASE 2F1-LIVE4.2 — when both physical faces measure the same, ONE label
    // is shown. It must land on a CANONICAL physical side. leftSeg is "+left of
    // the STORED a→b", which flips physical side under 180° rotation, endpoint
    // reversal or a re-drawn wall, so the single value used to sit on the other
    // face of a geometrically identical wall. Pick the canonical −v face
    // instead: leftSeg is −v exactly when the stored direction is the reversed
    // one. Both faces are equal here, so no measured value changes.
    const reversed = canonicalDirSign(measureA, measureB) < 0;
    const useLeft = reversed;
    const seg = (useLeft ? faces.leftSeg : faces.rightSeg) || faces.leftSeg;
    const mm = (useLeft ? faces.leftFaceMm : faces.rightFaceMm) || faces.leftFaceMm || centerlineMm;
    const faceKey = useLeft ? "A" : "B";
    labels.push({
      role: "primary",
      id: "live-edit-face",
      text: formatLiveLength(mm),
      mm,
      a: seg?.a || measureA,
      b: seg?.b || measureB,
      offsetSide: useLeft ? -1 : 1,
      kind: "face",
      face: faceKey,
      exterior: exteriorSideKey === faceKey,
    });
  }

  let host = null;
  let incidentAngles = [];
  // PHASE 2F2.2 — MODE B compact endpoint angles only when not in live movement.
  // MODE A (magnets / dynamic sectors) is rendered by AngleMagnetOverlay.
  let cornerAngles = [];
  const movementKind = editKind === "rotate";
  if (
    !movementKind
    && (
      editKind === "endpoint"
      || editKind === "select"
      || editKind === "wall_move"
      || editKind === "chain_move"
      || editKind === "t_slide"
      || editKind === "branch"
    )
  ) {
    cornerAngles = buildSelectedWallCornerAngles(plan, wallId);
    incidentAngles = cornerAngles.map((a) => a.displayDeg);
    // Keep compact label descriptors for consumers that still read labels[];
    // the overlay prefers cornerAngles for RemPlanner-style arcs.
    for (const ang of cornerAngles) {
      labels.push({
        role: "secondary",
        id: ang.id,
        text: ang.text,
        deg: ang.displayDeg,
        kind: "corner",
        at: ang.vertex,
        sectorKey: ang.sectorKey,
        cornerAngleId: ang.id,
      });
    }
    void selectedEndpoint;
  }

  if (editKind === "t_slide" || editKind === "branch") {
    // Branch wall: find host via shared node that is internal on a chain.
    const wRec = (plan.walls || []).find((w) => w.id === wallId);
    if (wRec) {
      for (const nodeId of [wRec.a, wRec.b]) {
        const hosts = (plan.walls || []).filter((h) => (
          h.id !== wallId && (h.a === nodeId || h.b === nodeId)
        ));
        for (const h of hosts) {
          const chain = resolveLogicalWallChain(plan, h.id);
          if (isInternalChainNode(chain, nodeId)) {
            const jpt = plan.nodes?.[nodeId];
            host = hostJunctionDistances(plan, h.id, jpt);
            if (host) {
              labels.push({
                role: "context",
                id: "live-host-total",
                text: `Σ ${formatLiveLength(host.totalMm)}`,
                mm: host.totalMm,
                kind: "host_total",
              });
              labels.push({
                role: "context",
                id: "live-host-L",
                text: formatLiveLength(host.leftMm),
                mm: host.leftMm,
                kind: "host_left",
                a: host.a,
                b: jpt,
              });
              labels.push({
                role: "context",
                id: "live-host-R",
                text: formatLiveLength(host.rightMm),
                mm: host.rightMm,
                kind: "host_right",
                a: jpt,
                b: host.b,
              });
            }
            break;
          }
        }
        if (host) break;
      }
    }
  }

  let clearSpans = [];
  let overallSpans = [];
  if (editKind === "wall_move" || editKind === "chain_move") {
    try {
      const contours = buildRenderedContours(plan);
      for (const rc of contours.roomContours || []) {
        const segs = rc.segments || [];
        // Axis-aligned clear spans from room contour bbox (preview only).
        const bb = rc.bbox;
        if (bb) {
          const w = (bb.x1 ?? bb.xMax ?? 0) - (bb.x0 ?? bb.xMin ?? 0);
          const h = (bb.y1 ?? bb.yMax ?? 0) - (bb.y0 ?? bb.yMin ?? 0);
          if (w > 1) {
            clearSpans.push({ orientation: "horizontal", mm: w });
            labels.push({
              role: "context",
              id: `live-clear-h-${rc.roomId || rc.loopId || clearSpans.length}`,
              text: formatLiveLength(w),
              mm: w,
              kind: "clear_h",
            });
          }
          if (h > 1) {
            clearSpans.push({ orientation: "vertical", mm: h });
            labels.push({
              role: "context",
              id: `live-clear-v-${rc.roomId || rc.loopId || clearSpans.length}`,
              text: formatLiveLength(h),
              mm: h,
              kind: "clear_v",
            });
          }
        }
        void segs;
      }
      for (const env of contours.envelopes || []) {
        const bb = env.bbox || env;
        const w = (bb.x1 ?? bb.xMax ?? 0) - (bb.x0 ?? bb.xMin ?? 0);
        const h = (bb.y1 ?? bb.yMax ?? 0) - (bb.y0 ?? bb.yMin ?? 0);
        if (w > 1) {
          overallSpans.push({ orientation: "horizontal", mm: w });
          labels.push({
            role: "context",
            id: `live-ov-h-${env.id || overallSpans.length}`,
            text: formatLiveLength(w),
            mm: w,
            kind: "overall_h",
          });
        }
        if (h > 1) {
          overallSpans.push({ orientation: "vertical", mm: h });
          labels.push({
            role: "context",
            id: `live-ov-v-${env.id || overallSpans.length}`,
            text: formatLiveLength(h),
            mm: h,
            kind: "overall_v",
          });
        }
      }
    } catch {
      // Preview contour failure must not break edit overlay.
    }
  }

  return {
    kind: "edit",
    editKind,
    wallId,
    logicalId: physical?.logicalId || chain?.logicalId || wallId,
    chainWallIds: physical?.chainWallIds || chain?.wallIds || [wallId],
    valid: true,
    centerlineMm,
    thkMm: ep.thk,
    leftFaceMm: faces.leftFaceMm,
    rightFaceMm: faces.rightFaceMm,
    facesDiffer: faces.facesDiffer,
    exteriorSideKey,
    physical,
    host,
    incidentAngles,
    cornerAngles,
    clearSpans,
    overallSpans,
    a: measureA,
    b: measureB,
    start: measureA,
    end: measureB,
    labels,
  };
}

/**
 * Anchor rules for exact length edit.
 * Returns { ok, anchorNodeId, moveNodeId, reason, free }.
 */
export function resolveLengthEditAnchor(plan, wallId, opts = {}) {
  const wall = (plan?.walls || []).find((w) => w.id === wallId);
  if (!wall?.a || !wall?.b) {
    return { ok: false, reason: "wall_not_found", anchorNodeId: null, moveNodeId: null };
  }
  const va = nodeValence(plan, wall.a);
  const vb = nodeValence(plan, wall.b);
  const aAttached = va >= 2;
  const bAttached = vb >= 2;

  // D — explicit endpoint selection: opposite end is anchor
  if (opts.selectedEndpoint === 0 || opts.selectedEndpoint === "a") {
    return {
      ok: true,
      anchorNodeId: wall.b,
      moveNodeId: wall.a,
      reason: null,
      rule: "D_selected_endpoint",
    };
  }
  if (opts.selectedEndpoint === 1 || opts.selectedEndpoint === "b") {
    return {
      ok: true,
      anchorNodeId: wall.a,
      moveNodeId: wall.b,
      reason: null,
      rule: "D_selected_endpoint",
    };
  }

  // C — both ends attached
  if (aAttached && bAttached) {
    return {
      ok: false,
      reason: "both_ends_attached",
      message: "Длина недоступна: оба конца стены связаны с другими стенами.",
      anchorNodeId: null,
      moveNodeId: null,
      rule: "C_double_attached",
    };
  }

  // B — one end attached
  if (aAttached && !bAttached) {
    return {
      ok: true,
      anchorNodeId: wall.a,
      moveNodeId: wall.b,
      reason: null,
      rule: "B_one_attached",
    };
  }
  if (bAttached && !aAttached) {
    return {
      ok: true,
      anchorNodeId: wall.b,
      moveNodeId: wall.a,
      reason: null,
      rule: "B_one_attached",
    };
  }

  // A — free wall: start (a) fixed, end (b) moves
  return {
    ok: true,
    anchorNodeId: wall.a,
    moveNodeId: wall.b,
    reason: null,
    rule: "A_free",
  };
}

/**
 * Apply exact length. Returns { ok, plan, changed, reason, message, preview }.
 * Does not invent wall.pts truth — moves the free node via moveNode.
 */
export function applyExactWallLength(plan, wallId, lengthMm, opts = {}) {
  if (!Number.isFinite(lengthMm) || lengthMm < 100) {
    return { ok: false, plan, changed: false, reason: "invalid_length", message: "Длина должна быть не меньше 100 мм." };
  }
  const anchor = resolveLengthEditAnchor(plan, wallId, opts);
  if (!anchor.ok) {
    return {
      ok: false,
      plan,
      changed: false,
      reason: anchor.reason,
      message: anchor.message || "Нельзя изменить длину.",
    };
  }
  const nodes = plan.nodes || {};
  const fixed = nodes[anchor.anchorNodeId];
  const moving = nodes[anchor.moveNodeId];
  if (!isFinitePt(fixed) || !isFinitePt(moving)) {
    return { ok: false, plan, changed: false, reason: "node_missing", message: "Узел стены не найден." };
  }
  const dx = moving.x - fixed.x;
  const dy = moving.y - fixed.y;
  const cur = Math.hypot(dx, dy);
  if (cur < 1) {
    return { ok: false, plan, changed: false, reason: "degenerate", message: "Стена вырождена." };
  }
  const next = {
    x: fixed.x + (dx / cur) * lengthMm,
    y: fixed.y + (dy / cur) * lengthMm,
  };
  if (opts.previewOnly) {
    return {
      ok: true,
      plan,
      changed: false,
      reason: null,
      preview: { moveNodeId: anchor.moveNodeId, point: next, anchor },
      message: null,
    };
  }
  const result = moveNode(plan, anchor.moveNodeId, next);
  return {
    ok: true,
    plan: result.plan,
    changed: !!result.changed,
    reason: null,
    message: null,
    anchor,
    result,
  };
}

/** Point at exact length from start along current direction (draft typing). */
export function pointAtLengthAlong(start, toward, lengthMm) {
  if (!isFinitePt(start) || !isFinitePt(toward)) return null;
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return null;
  const dx = toward.x - start.x;
  const dy = toward.y - start.y;
  const cur = Math.hypot(dx, dy);
  if (cur < 1e-6) return null;
  return {
    x: start.x + (dx / cur) * lengthMm,
    y: start.y + (dy / cur) * lengthMm,
  };
}

/** Filter labels by priority when canvas space is tight. */
export function prioritizeLiveLabels(labels = [], maxCount = 8) {
  const rank = { primary: 0, secondary: 1, context: 2 };
  return [...labels]
    .sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9))
    .slice(0, maxCount);
}
