/**
 * PHASE 2F1-M — judge Planner dimension records against the independent oracle.
 *
 * Dimension records arrive as DATA. This module imports nothing from the
 * Planner's dimension pipeline: the only geometry it trusts is geometryOracle,
 * which derives physical faces from centrelines + thickness alone.
 */
import {
  distance, unitTangent, sub, angleBetweenDeg,
  faceCandidates, nearestFace, nearestCentreline,
  findClosedLoops, loopInteriorPolygon, isEnclosedByWalls,
  physicalSpanKey,
} from "./geometryOracle.js";

/** Tolerances from the phase's acceptance thresholds. */
export const TOLERANCE = Object.freeze({
  anchorMm: 0.01,
  lengthMm: 0.1,
  displayMm: 1,
  parallelDeg: 0.1,
});

/**
 * Read a displayed label back to millimetres.
 * "4.00 м" -> 4000, "905 мм" -> 905.
 */
export function parseLabelMm(label) {
  if (typeof label !== "string") return null;
  const cleaned = label.replace(/ /g, " ").trim();
  const m = cleaned.match(/^(-?[\d\s.,]+)\s*(мм|м|mm|m|см|cm)?$/i);
  if (!m) return null;
  const value = parseFloat(m[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const unit = (m[2] || "мм").toLowerCase();
  if (unit === "м" || unit === "m") return value * 1000;
  if (unit === "см" || unit === "cm") return value * 10;
  return value;
}

const INNER_KINDS = new Set(["room_edge_clear", "internal_clear"]);
const OUTER_KINDS = new Set(["external_segment", "external_overall"]);
/** Kinds that must measure PHYSICAL FACES, never centrelines. */
export const FACE_REQUIRED_KINDS = new Set([
  "room_edge_clear", "internal_clear", "external_segment", "external_overall",
]);

/** Independent interior polygons, from topology + thickness only. */
export function oracleRoomPolygons(plan) {
  const nodes = plan.nodes || {};
  const polys = [];
  for (const loop of findClosedLoops(plan)) {
    const poly = loopInteriorPolygon(loop, nodes);
    if (poly && poly.length >= 3) polys.push(poly);
  }
  return polys;
}

/**
 * Full metrology for one dimension record.
 * @param {object} dim   Planner output (system under test)
 * @param {object} ctx   { plan, candidates, roomPolys }
 */
export function measureDimension(dim, ctx) {
  const { candidates, plan, roomPolys } = ctx;
  const p1 = dim.p1;
  const p2 = dim.p2;
  const out = {
    id: dim.id,
    generationKey: dim.generationKey || dim.id,
    semanticType: dim.semanticType || null,
    kind: dim.kind,
    roomId: dim.roomId || dim.reference?.roomId || null,
    contourId: dim.reference?.envelopeId || dim.reference?.loopId || null,
    sourceWallIds: dim.sourceWallIds || [],
    matchedFaceIds: dim.reference?.matchedContourSegmentIds || [],
    label: dim.labelOverride ?? null,
    storedValueMm: Number.isFinite(dim.measurementValue) ? dim.measurementValue : null,
    anchorA: p1 ? { x: p1.x, y: p1.y } : null,
    anchorB: p2 ? { x: p2.x, y: p2.y } : null,
    lane: dim.lane || null,
    side: dim.reference?.side || null,
    orientation: dim.orientation || dim.axisOrDirection || null,
    problems: [],
  };
  if (!p1 || !p2) {
    out.problems.push("MISSING_ANCHORS");
    out.pass = false;
    return out;
  }

  // ---- length -------------------------------------------------------------
  out.oracleLengthMm = distance(p1, p2);
  out.lengthErrorMm = out.storedValueMm == null
    ? null : Math.abs(out.storedValueMm - out.oracleLengthMm);

  // ---- displayed rounding -------------------------------------------------
  out.labelMm = parseLabelMm(out.label);
  if (out.labelMm != null) {
    // The label is shown in metres with 2 decimals above 1 m, so the honest
    // comparison is against the correctly rounded value at that precision.
    const oracle = out.oracleLengthMm;
    const shownAsMetres = /м$|m$/i.test(String(out.label).trim())
      && !/мм|mm/i.test(String(out.label));
    const correct = shownAsMetres ? Math.round(oracle / 10) * 10 : Math.round(oracle);
    out.displayErrorMm = Math.abs(out.labelMm - correct);
    out.correctRoundedMm = correct;
  } else {
    out.displayErrorMm = null;
  }

  // ---- anchors on physical faces -----------------------------------------
  const fa = nearestFace(p1, candidates);
  const fb = nearestFace(p2, candidates);
  out.faceA = fa;
  out.faceB = fb;
  out.anchorErrorMm = Math.max(fa?.perpendicularMm ?? Infinity, fb?.perpendicularMm ?? Infinity);

  // ---- centreline anti-check ---------------------------------------------
  const ca = nearestCentreline(p1, plan);
  const cb = nearestCentreline(p2, plan);
  out.centrelineDistanceA = ca?.distanceMm ?? null;
  out.centrelineDistanceB = cb?.distanceMm ?? null;
  // An anchor that sits ON a centreline while being off every face is the
  // failure §4 forbids.
  const onCentreline = (c, f) => c != null && c <= TOLERANCE.anchorMm
    && (f?.perpendicularMm ?? Infinity) > TOLERANCE.anchorMm;
  out.usesCentreline = onCentreline(out.centrelineDistanceA, fa)
    || onCentreline(out.centrelineDistanceB, fb);

  // ---- synthetic bbox -----------------------------------------------------
  out.syntheticBbox = (out.matchedFaceIds || [])
    .some((f) => typeof f === "string" && f.includes(":bbox-"));

  // ---- interior / exterior ------------------------------------------------
  const baseA = dim.baselineStart || p1;
  const baseB = dim.baselineEnd || p2;
  const baseMid = { x: (baseA.x + baseB.x) / 2, y: (baseA.y + baseB.y) / 2 };
  out.baselineMidpoint = baseMid;
  // Enclosure is decided by ray casting against the wall mass, not by loop
  // traversal: a room bounded by a wall that also carries a T branch has no
  // clean degree-2 loop, and judging it "outside" would be the oracle's error.
  const enclosure = isEnclosedByWalls(baseMid, plan);
  out.insideRoomPolygon = enclosure.enclosed;
  out.enclosure = enclosure;
  if (INNER_KINDS.has(dim.kind)) {
    out.expectedPlacement = "inside";
    out.placementOk = out.insideRoomPolygon;
  } else if (OUTER_KINDS.has(dim.kind)) {
    out.expectedPlacement = "outside";
    out.placementOk = !out.insideRoomPolygon;
  } else {
    out.expectedPlacement = "any";
    out.placementOk = true;
  }

  // ---- axis / parallelism -------------------------------------------------
  const spanVec = sub(p2, p1);
  out.axisUnit = unitTangent(p1, p2);
  if (fa && fb && fa.wallId === fb.wallId) {
    const wall = (plan.walls || []).find((w) => w.id === fa.wallId);
    const A = plan.nodes[wall?.a];
    const B = plan.nodes[wall?.b];
    if (A && B) out.parallelToFaceDeg = angleBetweenDeg(spanVec, sub(B, A));
  }

  out.spanKey = physicalSpanKey(p1, p2, {
    axis: out.orientation === "oblique" ? "o" : null,
    side: OUTER_KINDS.has(dim.kind) ? "outer" : (INNER_KINDS.has(dim.kind) ? "inner" : "_"),
    role: FACE_REQUIRED_KINDS.has(dim.kind) ? "face" : "other",
  });

  // ---- verdict ------------------------------------------------------------
  if (FACE_REQUIRED_KINDS.has(dim.kind)) {
    if (!(out.anchorErrorMm <= TOLERANCE.anchorMm)) {
      out.problems.push(`ANCHOR_OFF_FACE_${out.anchorErrorMm.toFixed(4)}mm`);
    }
    if (out.usesCentreline) out.problems.push("MEASURES_CENTRELINE");
    if (out.syntheticBbox) out.problems.push("SYNTHETIC_BBOX_FACE");
    if (!out.placementOk) out.problems.push(`PLACEMENT_EXPECTED_${out.expectedPlacement}`);
  }
  if (out.lengthErrorMm != null && out.lengthErrorMm > TOLERANCE.lengthMm) {
    out.problems.push(`LENGTH_ERROR_${out.lengthErrorMm.toFixed(4)}mm`);
  }
  if (out.displayErrorMm != null && out.displayErrorMm > TOLERANCE.displayMm) {
    out.problems.push(`DISPLAY_ERROR_${out.displayErrorMm.toFixed(2)}mm`);
  }
  out.pass = out.problems.length === 0;
  return out;
}

/** Metrology over every finalized dimension record. */
export function inventoryDimensions(plan, dims) {
  const candidates = faceCandidates(plan);
  const roomPolys = oracleRoomPolygons(plan);
  const records = dims.map((d) => measureDimension(d, { plan, candidates, roomPolys }));

  const bySpan = new Map();
  for (const r of records) {
    if (!r.spanKey) continue;
    if (!bySpan.has(r.spanKey)) bySpan.set(r.spanKey, []);
    bySpan.get(r.spanKey).push(r.id);
  }
  const duplicateSpans = [...bySpan.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ spanKey: key, ids }));

  const nearDuplicates = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      if (!a.anchorA || !b.anchorA || !a.axisUnit || !b.axisUnit) continue;
      const anchorGap = Math.min(
        Math.max(distance(a.anchorA, b.anchorA), distance(a.anchorB, b.anchorB)),
        Math.max(distance(a.anchorA, b.anchorB), distance(a.anchorB, b.anchorA)),
      );
      if (anchorGap > 2) continue;
      const valueGap = Math.abs((a.oracleLengthMm ?? 0) - (b.oracleLengthMm ?? 0));
      if (valueGap > 5) continue;
      const parallelDeg = angleBetweenDeg(a.axisUnit, b.axisUnit);
      if (!(parallelDeg <= TOLERANCE.parallelDeg)) continue;
      // Two records this close are only legitimate when they describe genuinely
      // different physical faces (an inner face and an outer face).
      const differentFaces = a.faceA?.wallId !== b.faceA?.wallId
        || a.faceA?.side !== b.faceA?.side
        || a.faceB?.wallId !== b.faceB?.wallId
        || a.faceB?.side !== b.faceB?.side;
      nearDuplicates.push({
        ids: [a.id, b.id],
        kinds: [a.kind, b.kind],
        anchorGapMm: anchorGap,
        valueGapMm: valueGap,
        parallelDeg,
        facesA: [a.faceA, b.faceA],
        facesB: [a.faceB, b.faceB],
        classification: differentFaces ? "legitimate_distinct_faces" : "DEFECT_same_physical_span",
      });
    }
  }

  const finite = (v) => Number.isFinite(v);
  const summary = {
    total: records.length,
    passed: records.filter((r) => r.pass).length,
    failed: records.filter((r) => !r.pass).length,
    maxAnchorErrorMm: Math.max(0, ...records.map((r) => (finite(r.anchorErrorMm) ? r.anchorErrorMm : 0))),
    maxLengthErrorMm: Math.max(0, ...records.map((r) => (finite(r.lengthErrorMm) ? r.lengthErrorMm : 0))),
    maxDisplayErrorMm: Math.max(0, ...records.map((r) => (finite(r.displayErrorMm) ? r.displayErrorMm : 0))),
    centrelineMeasurements: records.filter((r) => r.usesCentreline).length,
    syntheticBbox: records.filter((r) => r.syntheticBbox).length,
    placementViolations: records.filter((r) => r.placementOk === false).length,
    duplicateExactSpans: duplicateSpans.length,
    nearDuplicateDefects: nearDuplicates.filter((n) => n.classification.startsWith("DEFECT")).length,
    roomPolygons: roomPolys.length,
  };
  return { records, duplicateSpans, nearDuplicates, summary };
}
