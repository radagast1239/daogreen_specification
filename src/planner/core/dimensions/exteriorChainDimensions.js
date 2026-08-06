/**
 * PHASE 2F1 — exterior dimension chains from rendered outer contours.
 *
 * Emits:
 *   - external_segment  — one readable length per meaningful outer face
 *                          (closer to the wall mass)
 *   - external_overall  — envelope bbox width/height (farther out)
 *
 * Anchors are on joined outer faces. No centreline fallback. No pairwise
 * distances through concavities — only real outer contour edges + overall
 * envelope extents.
 *
 * Pure: no React, no plan mutation.
 */
import { FACE_REF_KINDS } from "../walls/wallFaceReferences.js";
import { CONTOUR_DIAGNOSTICS, pointInLoop, loopToSegments } from "../walls/renderedContours.js";
import {
  buildDimensionGenerationKey,
  envelopeStableKey,
  quantizeMm,
} from "./dimensionCanonicalKeys.js";

export const MIN_EXTERIOR_SEG_MM = 200;
/** RemPlanner gap: same absolute face distance as room-edge lane (~120mm). */
export const EXTERNAL_SEGMENT_MARGIN_MM = 120;
/** Overall sits one lane farther only when a segment chain also exists. */
export const EXTERNAL_OVERALL_MARGIN_MM = 240;
/** When a side has overall alone (simple rectangle), use the shared gap. */
export const EXTERNAL_OVERALL_ALONE_MARGIN_MM = 120;

function finite(n) {
  return Number.isFinite(n);
}

function allFillPolygons(contours) {
  const out = [];
  for (const c of contours.components || []) out.push(...(c.fillPolygons || []));
  return out;
}

/**
 * Exterior chains must use the OUTER perimeter only. Prefer stitched outer
 * loops when they exist; otherwise fall back to boundary segments that lie on
 * the envelope extremes (fail-closed — never emit hole/inner faces as exterior).
 *
 * Diagnostics list why candidate edges were rejected (too short, inner face,
 * duplicate key, etc.) so L/oblique coverage failures are explainable.
 */
function outerEnvelopeSegments(contours, env, diagnostics = []) {
  const comp = (contours.components || []).find((c) => c.id === env.componentId);
  const loops = comp?.outerLoops || [];
  if (loops.length) {
    const out = [];
    const seenLoop = new Set();
    loops.forEach((ol, i) => {
      const loop = ol.loop || ol;
      // Deduplicate identical outer loops (stitch often emits CW+CCW pairs).
      const key = (loop || []).map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`).join("|");
      if (seenLoop.has(key)) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.EXTERIOR_LOOP_DUPLICATE,
          envelopeId: env.id,
          loopIndex: i,
          reason: "duplicate_outer_loop_geometry",
        });
        return;
      }
      seenLoop.add(key);
      out.push(...loopToSegments(loop, `${env.id}:o${i}`));
    });
    return out;
  }
  // Fail-closed fallback: keep only faces on the envelope bbox extremes.
  const bb = env.bbox;
  if (!bb) {
    diagnostics.push({ code: CONTOUR_DIAGNOSTICS.EXTERIOR_NO_BBOX, envelopeId: env.id });
    return [];
  }
  const eps = 2;
  const kept = [];
  for (const s of env.segments || []) {
    if (!s || (s.axis !== "horizontal" && s.axis !== "vertical" && s.axis !== "diagonal")) {
      diagnostics.push({
        code: CONTOUR_DIAGNOSTICS.EXTERIOR_SEG_REJECTED,
        envelopeId: env.id,
        segmentId: s?.id,
        reason: "unsupported_axis",
      });
      continue;
    }
    let onExtreme = false;
    if (s.axis === "horizontal") {
      onExtreme = Math.abs(s.mid.y - bb.y0) <= eps || Math.abs(s.mid.y - (bb.y0 + bb.h)) <= eps;
    } else if (s.axis === "vertical") {
      onExtreme = Math.abs(s.mid.x - bb.x0) <= eps || Math.abs(s.mid.x - (bb.x0 + bb.w)) <= eps;
    } else {
      // Oblique: keep if either endpoint is near the bbox ring.
      const nearRing = (p) => (
        Math.abs(p.x - bb.x0) <= eps || Math.abs(p.x - (bb.x0 + bb.w)) <= eps
        || Math.abs(p.y - bb.y0) <= eps || Math.abs(p.y - (bb.y0 + bb.h)) <= eps
      );
      onExtreme = nearRing(s.a) && nearRing(s.b);
    }
    if (!onExtreme) {
      diagnostics.push({
        code: CONTOUR_DIAGNOSTICS.EXTERIOR_SEG_REJECTED,
        envelopeId: env.id,
        segmentId: s.id,
        reason: "not_on_envelope_extreme",
        mid: s.mid,
      });
      continue;
    }
    kept.push(s);
  }
  return kept;
}

function outwardSign(seg, fills) {
  const mid = seg.mid || {
    x: (seg.a.x + seg.b.x) / 2,
    y: (seg.a.y + seg.b.y) / 2,
  };
  const n = seg.normal;
  if (!n || !finite(n.x) || !finite(n.y)) return 1;
  const probe = 12;
  const plus = { x: mid.x + n.x * probe, y: mid.y + n.y * probe };
  const minus = { x: mid.x - n.x * probe, y: mid.y - n.y * probe };
  const plusIn = fills.some((poly) => pointInLoop(plus, poly));
  const minusIn = fills.some((poly) => pointInLoop(minus, poly));
  if (plusIn === minusIn) {
    // Fail-closed default: prefer the geometric left-hand normal if ambiguous.
    return 1;
  }
  // Outward = the direction that is NOT inside wall mass fill.
  return plusIn ? -1 : 1;
}

function makeDimension({
  id,
  generationKey,
  p1,
  p2,
  orientation,
  kind,
  reference,
  offset,
  witnessA,
  witnessB,
  baselineStart,
  baselineEnd,
  labelPoint,
  measurementValue,
  offsetSide,
  axisOrDirection,
  sourceWallIds,
  roomId = null,
  wallId = null,
  style,
}) {
  return {
    id,
    generationKey: generationKey || id,
    type: "dimension",
    mode: "linear",
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    offset: offset ?? 0,
    offsetSide: offsetSide ?? (offset >= 0 ? 1 : -1),
    orientation,
    attachedTo: null,
    labelOverride: null,
    locked: true,
    invalid: false,
    invalidReason: null,
    auto: true,
    kind,
    style: style || { importance: kind === "external_overall" ? "important" : "normal" },
    referenceKind: FACE_REF_KINDS.JOINED_OUTER_FACE,
    reference,
    roomId,
    wallId,
    sourceWallIds: sourceWallIds || [],
    axisOrDirection: axisOrDirection || orientation,
    witnessA: { x: witnessA.x, y: witnessA.y },
    witnessB: { x: witnessB.x, y: witnessB.y },
    baselineStart: { x: baselineStart.x, y: baselineStart.y },
    baselineEnd: { x: baselineEnd.x, y: baselineEnd.y },
    extensionA: [
      { x: witnessA.x, y: witnessA.y },
      { x: baselineStart.x, y: baselineStart.y },
    ],
    extensionB: [
      { x: witnessB.x, y: witnessB.y },
      { x: baselineEnd.x, y: baselineEnd.y },
    ],
    labelPoint: { x: labelPoint.x, y: labelPoint.y },
    measurementValue,
  };
}

function extremeOpposingFaces(faces, key) {
  if (!faces || faces.length < 2) return null;
  const other = key === "x" ? "y" : "x";
  const lo = faces.reduce((m, s) => (s.mid[key] < m.mid[key] ? s : m), faces[0]);
  const hi = faces.reduce((m, s) => (s.mid[key] > m.mid[key] ? s : m), faces[0]);
  if (Math.abs(hi.mid[key] - lo.mid[key]) < MIN_EXTERIOR_SEG_MM) return null;
  const ovLo = Math.max(Math.min(lo.a[other], lo.b[other]), Math.min(hi.a[other], hi.b[other]));
  const ovHi = Math.min(Math.max(lo.a[other], lo.b[other]), Math.max(hi.a[other], hi.b[other]));
  if (!(ovHi > ovLo)) return null;
  const at = ovLo;
  const mk = (face) => (key === "x" ? { x: face.mid.x, y: at } : { x: at, y: face.mid.y });
  return { faceA: lo, faceB: hi, p1: mk(lo), p2: mk(hi), at };
}

function segmentSourceWallIds(seg) {
  const ids = [];
  if (Array.isArray(seg?.sourceWallIds)) ids.push(...seg.sourceWallIds);
  if (seg?.wallId) ids.push(seg.wallId);
  if (seg?.wallIds) ids.push(...seg.wallIds);
  return [...new Set(ids.filter(Boolean))].sort();
}

/**
 * Merge collinear outer-face fragments that share the same face line
 * (same axis + quantized perpendicular coordinate) into contiguous intervals.
 * Mitred corners often leave multiple pieces per side; RemPlanner-style chains
 * want one readable length per real facade run.
 */
function mergeCollinearFaceIntervals(segs, axis) {
  const keyCoord = axis === "horizontal" ? "y" : "x";
  const along = axis === "horizontal" ? "x" : "y";
  // Fragments are grouped by being on the SAME face line as each other, not by
  // a globally quantized coordinate. An absolute bucket makes the grouping
  // depend on where the building sits in world space: the metrology gate caught
  // the identical plan translated far from the origin producing a different
  // number of exterior segments. Differences are translation-invariant.
  const FACE_LINE_EPS_MM = 0.5;
  const entries = [];
  for (const seg of segs) {
    if (seg.axis !== axis) continue;
    const forward = seg.a[along] <= seg.b[along];
    const t0 = forward ? seg.a[along] : seg.b[along];
    const t1 = forward ? seg.b[along] : seg.a[along];
    // Keep the REAL endpoints, not just their along-axis coordinates: a face
    // classified "horizontal" may still be a fraction of a degree off, and
    // rebuilding it on a quantized axis line moves the anchors off the physical
    // face (measured up to 3.4mm on hand-drawn walls).
    entries.push({
      perp: (seg.mid || seg.a)[keyCoord],
      t0,
      t1,
      p0: forward ? { ...seg.a } : { ...seg.b },
      p1: forward ? { ...seg.b } : { ...seg.a },
      seg,
    });
  }
  // Cluster by perpendicular proximity to each other.
  entries.sort((a, b) => a.perp - b.perp);
  const groups = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(entry.perp - last.perp) <= FACE_LINE_EPS_MM) {
      last.items.push(entry);
    } else {
      groups.push({ perp: entry.perp, items: [entry] });
    }
  }
  const out = [];
  for (const { items } of groups) {
    items.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const len = cur.t1 - cur.t0;
      if (len < MIN_EXTERIOR_SEG_MM) return;
      const ref = cur.segs[0];
      // Anchors are the real extreme endpoints of the merged run, so they stay
      // ON the drawn face. (For an exactly axis-aligned face these are the same
      // points the quantized reconstruction produced.)
      const a = { ...cur.p0 };
      const b = { ...cur.p1 };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      out.push({
        ...ref,
        id: ref.id,
        a,
        b,
        len: L,
        axis,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dir: { x: dx / L, y: dy / L },
        normal: ref.normal || { x: -dy / L, y: dx / L },
        sourceWallIds: [...new Set(cur.segs.flatMap(segmentSourceWallIds))],
      });
    };
    for (const it of items) {
      if (!cur) {
        cur = { t0: it.t0, t1: it.t1, p0: it.p0, p1: it.p1, segs: [it.seg] };
        continue;
      }
      // Adjacent or overlapping within 2mm → same facade run.
      if (it.t0 <= cur.t1 + 2) {
        if (it.t1 > cur.t1) {
          cur.t1 = it.t1;
          cur.p1 = it.p1;
        }
        cur.segs.push(it.seg);
      } else {
        flush();
        cur = { t0: it.t0, t1: it.t1, p0: it.p0, p1: it.p1, segs: [it.seg] };
      }
    }
    flush();
  }
  return out;
}

/**
 * One external_segment (EXTERIOR_EDGE) per meaningful outer contour face,
 * including oblique edges. Parallel to the physical exterior face.
 */
export function generateExternalSegmentsFromContours(contours) {
  const dims = [];
  const diagnostics = [];
  const fills = allFillPolygons(contours);
  const envelopes = contours.envelopes || [];
  const seen = new Set();

  for (const env of envelopes) {
    const envKey = envelopeStableKey(env);
    const raw = outerEnvelopeSegments(contours, env, diagnostics).filter(
      (s) => s && (s.len || 0) >= 1,
    );
    // Merge only axis-aligned collinear runs; keep oblique edges intact.
    const axisAligned = [
      ...mergeCollinearFaceIntervals(raw.filter((s) => s.axis === "horizontal"), "horizontal"),
      ...mergeCollinearFaceIntervals(raw.filter((s) => s.axis === "vertical"), "vertical"),
    ];
    const oblique = raw.filter((s) => s.axis === "diagonal" || (s.axis !== "horizontal" && s.axis !== "vertical"));
    const candidates = [...axisAligned, ...oblique];
    for (const seg of candidates) {
      if ((seg.len || 0) < MIN_EXTERIOR_SEG_MM) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.EXTERIOR_SEG_REJECTED,
          envelopeId: env.id,
          segmentId: seg.id,
          reason: "below_min_length",
          len: seg.len,
        });
      }
    }
    const segs = candidates.filter((s) => (s.len || 0) >= MIN_EXTERIOR_SEG_MM);

    for (const seg of segs) {
      const isOblique = seg.axis === "diagonal" || (seg.axis !== "horizontal" && seg.axis !== "vertical");
      const orientation = isOblique
        ? "oblique"
        : (seg.axis === "horizontal" ? "horizontal" : "vertical");
      const p1 = { x: seg.a.x, y: seg.a.y };
      const p2 = { x: seg.b.x, y: seg.b.y };
      const generationKey = buildDimensionGenerationKey({
        kind: "external_segment",
        orientation,
        p1,
        p2,
        envelopeKey: envKey,
      });
      if (seen.has(generationKey)) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.EXTERIOR_SEG_REJECTED,
          envelopeId: env.id,
          segmentId: seg.id,
          reason: "canonical_key_collision",
          generationKey,
        });
        continue;
      }
      seen.add(generationKey);

      const sign = outwardSign(seg, fills);
      const offset = sign * EXTERNAL_SEGMENT_MARGIN_MM;
      const nx = seg.normal?.x ?? 0;
      const ny = seg.normal?.y ?? (orientation === "horizontal" ? -1 : 0);
      const baselineStart = { x: p1.x + nx * offset, y: p1.y + ny * offset };
      const baselineEnd = { x: p2.x + nx * offset, y: p2.y + ny * offset };
      const sourceWallIds = segmentSourceWallIds(seg);

      dims.push(makeDimension({
        id: generationKey,
        generationKey,
        p1,
        p2,
        orientation,
        kind: "external_segment",
        reference: {
          kind: FACE_REF_KINDS.JOINED_OUTER_FACE,
          envelopeId: env.id,
          componentId: env.componentId,
          sourceFaceA: seg.id,
          matchedContourSegmentIds: [seg.id],
          side: "outer",
          chainRole: "segment",
        },
        offset,
        offsetSide: sign,
        witnessA: p1,
        witnessB: p2,
        baselineStart,
        baselineEnd,
        labelPoint: {
          x: (baselineStart.x + baselineEnd.x) / 2,
          y: (baselineStart.y + baselineEnd.y) / 2,
        },
        measurementValue: seg.len,
        axisOrDirection: orientation,
        sourceWallIds,
        style: { importance: "important" },
      }));
    }
  }
  return { dims, diagnostics };
}

/**
 * Does an opposing physical face pair actually span the envelope extent along
 * this axis?
 *
 * PHASE 2F1 blocker A. The overall used to fall back to bbox min/max whenever a
 * pair could not be proven, minting synthetic `env:bbox-w0/w1` faces. On a
 * trapezoid that produced 905mm — a number measured between nothing, drawn next
 * to a room whose real edges are 554 / 687 / 800 / 811. BUILDING_EXTERIOR_OVERALL
 * means physical exterior face to physical exterior face, so a pair that does
 * not reach the drawn extent is not an overall either.
 */
function pairSpansEnvelope(pair, key, bb, eps = 2) {
  if (!pair || !bb) return false;
  const extent = key === "x" ? bb.w : bb.h;
  const separation = Math.abs(pair.faceB.mid[key] - pair.faceA.mid[key]);
  return Math.abs(separation - extent) <= eps;
}

/**
 * Exactly one horizontal and one vertical overall per depth-0 envelope, and
 * ONLY where the value is a proven physical exterior face to physical exterior
 * face distance. Baseline is farther out than the segment chain.
 */
export function generateExternalOverallFromContours(contours) {
  const dims = [];
  const diagnostics = [];
  const envelopes = contours.envelopes || [];
  if (!envelopes.length) return { dims, diagnostics };

  for (const env of envelopes) {
    const envKey = envelopeStableKey(env);
    const segs = outerEnvelopeSegments(contours, env, diagnostics);
    const verticals = segs.filter((s) => s.axis === "vertical");
    const horizontals = segs.filter((s) => s.axis === "horizontal");
    const bb = env.bbox;
    if (!bb || !(bb.w > 0) || !(bb.h > 0)) {
      diagnostics.push({ code: CONTOUR_DIAGNOSTICS.INVALID_EXTERNAL_ENVELOPE, envelopeId: env.id });
      continue;
    }

    const widthPair = extremeOpposingFaces(verticals, "x");
    const heightPair = extremeOpposingFaces(horizontals, "y");

    const widthProven = pairSpansEnvelope(widthPair, "x", bb);
    const heightProven = pairSpansEnvelope(heightPair, "y", bb);

    if (bb.w >= MIN_EXTERIOR_SEG_MM && widthProven) {
      const desiredBaselineY = bb.y0 - EXTERNAL_OVERALL_ALONE_MARGIN_MM;
      const { faceA, faceB, p1, p2, at } = widthPair;
      const sourceWallIds = [...new Set([...segmentSourceWallIds(faceA), ...segmentSourceWallIds(faceB)])];
      const offset = desiredBaselineY - at;
      const baselineStart = { x: p1.x, y: desiredBaselineY };
      const baselineEnd = { x: p2.x, y: desiredBaselineY };
      const generationKey = buildDimensionGenerationKey({
        kind: "external_overall",
        orientation: "horizontal",
        p1,
        p2,
        envelopeKey: envKey,
      });
      dims.push(makeDimension({
        id: generationKey,
        generationKey,
        p1,
        p2,
        orientation: "horizontal",
        kind: "external_overall",
        reference: {
          kind: FACE_REF_KINDS.JOINED_OUTER_FACE,
          envelopeId: env.id,
          componentId: env.componentId,
          sourceFaceA: faceA.id,
          sourceFaceB: faceB.id,
          matchedContourSegmentIds: [faceA.id, faceB.id].filter(Boolean),
          side: "outer",
          chainRole: "overall",
        },
        offset,
        offsetSide: offset >= 0 ? 1 : -1,
        witnessA: p1,
        witnessB: p2,
        baselineStart,
        baselineEnd,
        labelPoint: { x: (baselineStart.x + baselineEnd.x) / 2, y: desiredBaselineY },
        // The measured value is the PROVEN face-to-face distance, never the
        // envelope extent (they coincide on a rectangle and diverge otherwise).
        measurementValue: Math.abs(p2.x - p1.x),
        axisOrDirection: "horizontal",
        sourceWallIds,
        style: { importance: "important" },
      }));
    } else if (!(bb.w >= MIN_EXTERIOR_SEG_MM)) {
      diagnostics.push({
        code: CONTOUR_DIAGNOSTICS.INVALID_EXTERNAL_ENVELOPE, envelopeId: env.id, axis: "width",
      });
    } else {
      diagnostics.push({
        code: CONTOUR_DIAGNOSTICS.EXTERIOR_OVERALL_NO_PHYSICAL_FACE_PAIR,
        envelopeId: env.id,
        axis: "width",
        reason: widthPair
          ? "opposing_faces_do_not_span_the_drawn_extent"
          : "no_opposing_physical_exterior_face_pair",
        bboxExtentMm: bb.w,
      });
    }

    if (bb.h >= MIN_EXTERIOR_SEG_MM && heightProven) {
      const desiredBaselineX = bb.x0 - EXTERNAL_OVERALL_ALONE_MARGIN_MM;
      const { faceA, faceB, p1, p2, at } = heightPair;
      const sourceWallIds = [...new Set([...segmentSourceWallIds(faceA), ...segmentSourceWallIds(faceB)])];
      const offset = at - desiredBaselineX;
      const baselineStart = { x: desiredBaselineX, y: p1.y };
      const baselineEnd = { x: desiredBaselineX, y: p2.y };
      const generationKey = buildDimensionGenerationKey({
        kind: "external_overall",
        orientation: "vertical",
        p1,
        p2,
        envelopeKey: envKey,
      });
      dims.push(makeDimension({
        id: generationKey,
        generationKey,
        p1,
        p2,
        orientation: "vertical",
        kind: "external_overall",
        reference: {
          kind: FACE_REF_KINDS.JOINED_OUTER_FACE,
          envelopeId: env.id,
          componentId: env.componentId,
          sourceFaceA: faceA.id,
          sourceFaceB: faceB.id,
          matchedContourSegmentIds: [faceA.id, faceB.id].filter(Boolean),
          side: "outer",
          chainRole: "overall",
        },
        offset,
        offsetSide: offset >= 0 ? 1 : -1,
        witnessA: p1,
        witnessB: p2,
        baselineStart,
        baselineEnd,
        labelPoint: { x: desiredBaselineX, y: (baselineStart.y + baselineEnd.y) / 2 },
        measurementValue: Math.abs(p2.y - p1.y),
        axisOrDirection: "vertical",
        sourceWallIds,
        style: { importance: "important" },
      }));
    } else if (!(bb.h >= MIN_EXTERIOR_SEG_MM)) {
      diagnostics.push({
        code: CONTOUR_DIAGNOSTICS.INVALID_EXTERNAL_ENVELOPE, envelopeId: env.id, axis: "height",
      });
    } else {
      diagnostics.push({
        code: CONTOUR_DIAGNOSTICS.EXTERIOR_OVERALL_NO_PHYSICAL_FACE_PAIR,
        envelopeId: env.id,
        axis: "height",
        reason: heightPair
          ? "opposing_faces_do_not_span_the_drawn_extent"
          : "no_opposing_physical_exterior_face_pair",
        bboxExtentMm: bb.h,
      });
    }
  }
  return { dims, diagnostics };
}

/** Combined exterior chain: segments (near) + overalls (far when both present). */
export function generateExteriorChainDimensions(contours) {
  const seg = generateExternalSegmentsFromContours(contours);
  const ov = generateExternalOverallFromContours(contours);
  const diagnostics = [...seg.diagnostics, ...ov.diagnostics];
  const segments = suppressRedundantExteriorSegments(seg.dims, ov.dims, diagnostics);
  const overalls = stackOverallOutsideSegments(ov.dims, segments);
  return {
    dims: [...segments, ...overalls],
    diagnostics,
  };
}

/**
 * When a segment chain remains for an envelope, push that envelope's overall
 * one lane farther so segment and overall do not coincide — while a lone
 * overall (simple rectangle) keeps the shared internal/external gap.
 */
function stackOverallOutsideSegments(overalls = [], segments = []) {
  const hasSeg = new Set();
  for (const d of segments) {
    const envId = d.reference?.envelopeId || "_";
    hasSeg.add(`${envId}:${d.orientation}`);
  }
  const alone = EXTERNAL_OVERALL_ALONE_MARGIN_MM;
  const stacked = EXTERNAL_OVERALL_MARGIN_MM;
  return overalls.map((d) => {
    const envId = d.reference?.envelopeId || "_";
    if (!hasSeg.has(`${envId}:${d.orientation}`)) return d;
    const sign = Math.sign(d.offset) || -1;
    const newOffset = sign * stacked;
    const shift = newOffset - (d.offset || 0);
    if (Math.abs(shift) < 1e-6) return d;
    const baselineStart = d.baselineStart
      ? {
        x: d.baselineStart.x + (d.orientation === "vertical" ? -shift : 0),
        y: d.baselineStart.y + (d.orientation === "horizontal" ? shift : 0),
      }
      : d.baselineStart;
    const baselineEnd = d.baselineEnd
      ? {
        x: d.baselineEnd.x + (d.orientation === "vertical" ? -shift : 0),
        y: d.baselineEnd.y + (d.orientation === "horizontal" ? shift : 0),
      }
      : d.baselineEnd;
    return {
      ...d,
      offset: newOffset,
      baselineStart,
      baselineEnd,
      labelPoint: baselineStart && baselineEnd
        ? {
          x: (baselineStart.x + baselineEnd.x) / 2,
          y: (baselineStart.y + baselineEnd.y) / 2,
        }
        : d.labelPoint,
      extensionA: d.witnessA && baselineStart ? [d.witnessA, baselineStart] : d.extensionA,
      extensionB: d.witnessB && baselineEnd ? [d.witnessB, baselineEnd] : d.extensionB,
    };
  });
}

/**
 * Simple rectangle contract ONLY: when an envelope has exactly four axis-aligned
 * outer edges (no steps, no oblique), suppress local segments whose value equals
 * the overall for that direction — otherwise overall + identical edge duplicate.
 *
 * L-shape / irregular / stepped envelopes keep EVERY meaningful exterior edge,
 * even when a leg length equals the overall envelope span (anchors differ).
 */
export function suppressRedundantExteriorSegments(segments = [], overalls = [], diagnostics = null) {
  const overallLookup = new Map();
  for (const d of overalls) {
    if (d.kind !== "external_overall") continue;
    const envId = d.reference?.envelopeId || d.reference?.envelopeKey || "_";
    overallLookup.set(`${envId}:${d.orientation}`, d);
  }

  const byEnv = new Map();
  for (const d of segments) {
    if (d.kind !== "external_segment") continue;
    const envId = d.reference?.envelopeId || d.reference?.envelopeKey || "_";
    if (!byEnv.has(envId)) byEnv.set(envId, []);
    byEnv.get(envId).push(d);
  }

  const suppressIds = new Set();
  for (const [envId, list] of byEnv) {
    const axisAligned = list.filter((d) => d.orientation === "horizontal" || d.orientation === "vertical");
    const oblique = list.filter((d) => d.orientation === "oblique"
      || (d.orientation !== "horizontal" && d.orientation !== "vertical"));
    // Only a true 4-edge axis-aligned rectangle suppresses value=overall dupes.
    const isSimpleRect = oblique.length === 0 && axisAligned.length === 4
      && axisAligned.filter((d) => d.orientation === "horizontal").length === 2
      && axisAligned.filter((d) => d.orientation === "vertical").length === 2;
    if (!isSimpleRect) {
      if (diagnostics) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.EXTERIOR_SEG_KEEP_NON_RECT,
          envelopeId: envId,
          reason: "l_shape_or_irregular_keeps_all_local_edges",
          segmentCount: list.length,
          obliqueCount: oblique.length,
        });
      }
      continue;
    }

    for (const d of axisAligned) {
      const overall = overallLookup.get(`${envId}:${d.orientation}`);
      if (!overall) continue;
      const segVal = Number.isFinite(d.measurementValue)
        ? d.measurementValue
        : Math.hypot((d.p2?.x || 0) - (d.p1?.x || 0), (d.p2?.y || 0) - (d.p1?.y || 0));
      const ovVal = Number.isFinite(overall.measurementValue)
        ? overall.measurementValue
        : Math.hypot((overall.p2?.x || 0) - (overall.p1?.x || 0), (overall.p2?.y || 0) - (overall.p1?.y || 0));
      if (Number.isFinite(ovVal) && Math.abs(segVal - ovVal) <= 1) {
        suppressIds.add(d.generationKey || d.id);
        if (diagnostics) {
          diagnostics.push({
            code: CONTOUR_DIAGNOSTICS.EXTERIOR_SEG_SUPPRESSED_RECT_DUPE,
            envelopeId: envId,
            generationKey: d.generationKey || d.id,
            reason: "simple_rectangle_local_equals_overall",
            value: segVal,
          });
        }
      }
    }
  }
  return segments.filter((d) => !suppressIds.has(d.generationKey || d.id));
}

/** True when segment baseline is farther from the mass than overall would be — used by tests. */
export function exteriorChainStackOrderOk(segmentDim, overallDim) {
  if (!segmentDim || !overallDim) return false;
  if (segmentDim.orientation !== overallDim.orientation) return false;
  const segOff = Math.abs(segmentDim.offset || 0);
  const ovOff = Math.abs(overallDim.offset || 0);
  return ovOff > segOff + 1 && quantizeMm(segOff) >= EXTERNAL_SEGMENT_MARGIN_MM - 1;
}
