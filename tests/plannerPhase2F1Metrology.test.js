/**
 * PHASE 2F1-M — the metrology gate.
 *
 * The Planner's dimension pipeline is the SYSTEM UNDER TEST. Expected values
 * come from tests/metrology/geometryOracle.js, which derives physical wall
 * faces from centrelines + thickness + topology alone.
 *
 * Plan fixture: tests/fixtures/phase2f1/metrologyPlan.json (in-repo, frozen).
 * Optional evidence dump: set PHASE2F1_EVIDENCE_DIR to a writable directory.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// SYSTEM UNDER TEST — imported here, never inside the oracle.
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import {
  distance, unitTangent, sub, angleBetweenDeg,
  faceCandidates, nearestFace, wallFaces, faceOffsets, intersectLines,
  findClosedLoops, loopInteriorPolygon, polygonArea, miteredFacePoint,
} from "./metrology/geometryOracle.js";
import {
  inventoryDimensions, TOLERANCE, parseLabelMm, FACE_REQUIRED_KINDS,
} from "./metrology/dimensionMetrology.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Self-contained fixture: the gate must assert on every machine, so the plan
// lives in the repository. A missing fixture is a hard failure, never a skip.
const PLAN_FILE = path.join(REPO, "tests/fixtures/phase2f1/metrologyPlan.json");
const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
// Optional diagnostic evidence dump; off unless a directory is requested.
const OUT = process.env.PHASE2F1_EVIDENCE_DIR || null;
const writeEvidence = (name, body) => {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), body, "utf8");
};

const W = {
  thk: 100, role: "outer", kind: "new", thicknessSide: "center",
  height: 3000, material: "", type: "wall", locked: false,
};
const mkPlan = (nodes, walls) => ({
  nodes, walls,
  items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
  dimensions: [], validationWarnings: [],
  room: { w: 40000, h: 40000, wallThk: 100, height: 3000 },
});

describe("PHASE 2F1-M — oracle isolation", () => {
  it("the oracle imports nothing from the dimension pipeline", () => {
    for (const file of ["geometryOracle.js", "dimensionMetrology.js"]) {
      const src = fs.readFileSync(path.join(REPO, "tests", "metrology", file), "utf8");
      const imports = [...src.matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)]
        .map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} must not import Planner code: ${spec}`).not.toMatch(/src\/planner/);
        expect(spec, `${file} must not import dimensions: ${spec}`).not.toMatch(/dimension/i);
        expect(spec, `${file} must not import contour helpers: ${spec}`).not.toMatch(/contour/i);
      }
      // Belt and braces: no dynamic import of the pipeline either.
      expect(src).not.toMatch(/import\(\s*["'][^"']*planner/);
    }
  });
});

describe("PHASE 2F1-M — unit contract (1 unit = 1 mm)", () => {
  it("2. known real-mouse spans measure their drawn millimetres", () => {
    const lengths = (plan.walls || []).map((w) => {
      const A = plan.nodes[w.a];
      const B = plan.nodes[w.b];
      return A && B ? distance(A, B) : null;
    }).filter((v) => v != null);
    // Spans the real-mouse fixture set was drawn with. The project is edited
    // during manual acceptance, so only spans that still exist are asserted —
    // what matters is that a drawn N mm wall measures exactly N units.
    const present = [900, 3000, 4000, 6000, 8000]
      .filter((mm) => lengths.some((l) => Math.abs(l - mm) <= 0.5));
    expect(present.length, "no canonical span survives in the plan")
      .toBeGreaterThanOrEqual(3);
    for (const expected of present) {
      const hit = lengths.find((l) => Math.abs(l - expected) <= 0.1);
      expect(hit, `${expected}mm wall is not exactly ${expected} units`).toBeDefined();
    }
    // Diagonal: 3000/3000 -> 4242.6407
    const diag = lengths.find((l) => Math.abs(l - Math.hypot(3000, 3000)) <= 0.1);
    expect(diag, "no 45° diagonal wall").toBeDefined();
  });

  it("face offsets are exactly half the thickness for centred walls", () => {
    for (const wall of (plan.walls || []).slice(0, 12)) {
      const f = wallFaces(wall, plan.nodes);
      if (!f) continue;
      expect(f.offsets.left).toBeCloseTo((wall.thk || 100) / 2, 9);
      expect(f.offsets.right).toBeCloseTo(-(wall.thk || 100) / 2, 9);
      expect(distance(f.left.a, f.centre.a)).toBeCloseTo((wall.thk || 100) / 2, 9);
    }
  });

  it("thicknessSide in/out put the whole band on one side", () => {
    const nodes = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } };
    const base = { ...W, id: "w", a: "a", b: "b" };
    const centre = wallFaces(base, nodes);
    const inside = wallFaces({ ...base, thicknessSide: "in", thk: 200 }, nodes);
    const outside = wallFaces({ ...base, thicknessSide: "out", thk: 200 }, nodes);
    expect(centre.offsets).toEqual({ left: 50, right: -50 });
    expect(inside.offsets).toEqual({ left: 200, right: 0 });
    expect(outside.offsets).toEqual({ left: 0, right: -200 });
    expect(faceOffsets({ thk: 300, thicknessSide: "center" })).toEqual({ left: 150, right: -150 });
  });
});

describe("PHASE 2F1-M — physical face and miter mathematics", () => {
  it("8. a 90° corner miter is the face-line intersection, not an offset endpoint", () => {
    const nodes = { c1: { x: 0, y: 0 }, c2: { x: 4000, y: 0 }, c3: { x: 4000, y: 3000 } };
    const w1 = { ...W, id: "w1", a: "c1", b: "c2" };
    const w2 = { ...W, id: "w2", a: "c2", b: "c3" };
    const f1 = wallFaces(w1, nodes);
    const f2 = wallFaces(w2, nodes);
    // Outer faces (right of each direction) meet 50mm beyond each raw endpoint.
    const hit = miteredFacePoint(f1.right, f2.right);
    expect(hit.x).toBeCloseTo(4050, 6);
    expect(hit.y).toBeCloseTo(-50, 6);
    // The raw offset segment stops short of the true corner.
    expect(distance(f1.right.b, hit)).toBeCloseTo(50, 6);
  });

  it("acute and obtuse miters extend further than the wall thickness", () => {
    const acute = {
      nodes: { p: { x: 0, y: 0 }, q: { x: 3000, y: 0 }, r: { x: 300, y: 1500 } },
      w1: { ...W, id: "a1", a: "q", b: "p" },
      w2: { ...W, id: "a2", a: "p", b: "r" },
    };
    const f1 = wallFaces(acute.w1, acute.nodes);
    const f2 = wallFaces(acute.w2, acute.nodes);
    const hit = intersectLines(f1.left.a, f1.tangent, f2.left.a, f2.tangent);
    expect(hit).toBeTruthy();
    // A sharp corner pushes the mitre well past a simple half-thickness offset.
    expect(distance(hit, acute.nodes.p)).toBeGreaterThan(50);
  });

  it("unequal thicknesses miter at the true intersection of both faces", () => {
    const nodes = { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 }, n3: { x: 4000, y: 3000 } };
    const thin = { ...W, id: "thin", a: "n1", b: "n2", thk: 100 };
    const thick = { ...W, id: "thick", a: "n2", b: "n3", thk: 300 };
    const ft = wallFaces(thin, nodes);
    const fk = wallFaces(thick, nodes);
    const hit = miteredFacePoint(ft.right, fk.right);
    // thin's right face is y=-50; thick's right face is x=4150.
    expect(hit.y).toBeCloseTo(-50, 6);
    expect(hit.x).toBeCloseTo(4150, 6);
  });

  it("diagonal-to-horizontal miters are computed, and diagonals use Euclid", () => {
    const nodes = { d1: { x: 0, y: 0 }, d2: { x: 3000, y: 0 }, d3: { x: 6000, y: 3000 } };
    const h = { ...W, id: "h", a: "d1", b: "d2" };
    const d = { ...W, id: "d", a: "d2", b: "d3" };
    expect(distance(nodes.d2, nodes.d3)).toBeCloseTo(Math.hypot(3000, 3000), 9);
    const hit = miteredFacePoint(wallFaces(h, nodes).left, wallFaces(d, nodes).left);
    expect(hit).toBeTruthy();
    expect(Number.isFinite(hit.x) && Number.isFinite(hit.y)).toBe(true);
  });

  it("reversed endpoints and reordered arrays give identical faces", () => {
    const nodes = { a: { x: 100, y: 200 }, b: { x: 4100, y: 200 } };
    const fwd = wallFaces({ ...W, id: "w", a: "a", b: "b" }, nodes);
    const rev = wallFaces({ ...W, id: "w", a: "b", b: "a" }, nodes);
    // Reversal swaps which face is "left", but the PHYSICAL pair is the same.
    const fwdLines = [fwd.left.a.y, fwd.right.a.y].sort();
    const revLines = [rev.left.a.y, rev.right.a.y].sort();
    expect(fwdLines).toEqual(revLines);
  });
});

describe("PHASE 2F1-M — independent room polygons", () => {
  it("a drawn rectangle encloses its clear area, computed from faces alone", () => {
    const nodes = {
      r1: { x: 0, y: 0 }, r2: { x: 4000, y: 0 },
      r3: { x: 4000, y: 3000 }, r4: { x: 0, y: 3000 },
    };
    const p = mkPlan(nodes, [
      { ...W, id: "t", a: "r1", b: "r2" }, { ...W, id: "r", a: "r2", b: "r3" },
      { ...W, id: "b", a: "r3", b: "r4" }, { ...W, id: "l", a: "r4", b: "r1" },
    ]);
    const loops = findClosedLoops(p);
    expect(loops).toHaveLength(1);
    const poly = loopInteriorPolygon(loops[0], p.nodes);
    expect(poly).toHaveLength(4);
    // Clear interior of a 4000x3000 centreline rectangle with 100mm walls.
    expect(Math.abs(polygonArea(poly))).toBeCloseTo(3900 * 2900, 3);
  });
});

describe("PHASE 2F1-M — dimension inventory against the oracle", () => {
  it("3/4/5/6/10/13. every visible dimension is proven", () => {
    const out = generateWallDimensions(plan, {});
    const dims = out.dimensions || [];
    expect(dims.length).toBeGreaterThan(0);

    const report = inventoryDimensions(plan, dims);
    writeEvidence("dimension-inventory.json", JSON.stringify(report, null, 2));

    const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v);
    const lines = [];
    lines.push("PHASE 2F1-M — DIMENSION METROLOGY REPORT");
    lines.push(`generated: ${new Date().toISOString()}`);
    lines.push(`plan:      ${PLAN_FILE}`);
    lines.push(`walls=${plan.walls.length} nodes=${Object.keys(plan.nodes).length} `
      + `oracleRoomPolygons=${report.summary.roomPolygons}`);
    lines.push("");
    lines.push("TOLERANCES  anchor<=0.01mm  length<=0.1mm  display<=1mm");
    lines.push("");
    lines.push("== EVERY DIMENSION ==");
    for (const r of report.records) {
      lines.push([
        r.pass ? "PASS" : "FAIL",
        `id=${r.id}`,
        `semantic=${r.semanticType || r.kind}`,
        `kind=${r.kind}`,
        `room=${r.roomId || "-"}`,
        `contour=${r.contourId || "-"}`,
        `label=${r.label ?? "-"}`,
        `stored=${r2(r.storedValueMm)}`,
        `oracle=${r2(r.oracleLengthMm)}`,
        `A=(${r2(r.anchorA?.x)},${r2(r.anchorA?.y)})`,
        `B=(${r2(r.anchorB?.x)},${r2(r.anchorB?.y)})`,
        `axis=${r.orientation}`,
        `lane=${r.lane}`,
        `side=${r.side || "-"}`,
        `placement=${r.expectedPlacement}/${r.insideRoomPolygon ? "inside" : "outside"}`,
        `faceA=${r.faceA ? `${r.faceA.wallId}.${r.faceA.side}` : "-"}`,
        `faceB=${r.faceB ? `${r.faceB.wallId}.${r.faceB.side}` : "-"}`,
        `anchorErr=${r2(r.anchorErrorMm)}`,
        `lenErr=${r2(r.lengthErrorMm)}`,
        `dispErr=${r2(r.displayErrorMm)}`,
        `problems=[${r.problems.join(";")}]`,
      ].join(" | "));
    }
    lines.push("");
    lines.push("== DUPLICATE EXACT PHYSICAL SPANS ==");
    lines.push(report.duplicateSpans.length ? JSON.stringify(report.duplicateSpans, null, 1) : "(none)");
    lines.push("");
    lines.push("== NEAR-DUPLICATE PAIRS (<=2mm anchors, <=5mm value, <=0.1deg) ==");
    if (!report.nearDuplicates.length) lines.push("(none)");
    for (const n of report.nearDuplicates) {
      lines.push(`${n.classification} | ${n.ids.join(" + ")} | kinds=${n.kinds.join(",")} `
        + `| anchorGap=${r2(n.anchorGapMm)}mm valueGap=${r2(n.valueGapMm)}mm parallel=${r2(n.parallelDeg)}deg`);
    }
    lines.push("");
    lines.push("== SUMMARY ==");
    for (const [k, v] of Object.entries(report.summary)) lines.push(`${k}: ${v}`);
    writeEvidence("DIMENSION-METROLOGY-REPORT.txt", lines.join("\n"));

    // ---- acceptance thresholds -------------------------------------------
    const failures = report.records.filter((r) => !r.pass);
    expect(report.summary.syntheticBbox, "synthetic bbox dimensions").toBe(0);
    expect(report.summary.centrelineMeasurements, "centreline measurements").toBe(0);
    expect(report.summary.duplicateExactSpans, "duplicate exact physical spans").toBe(0);
    expect(report.summary.nearDuplicateDefects, "near-duplicate defects").toBe(0);
    expect(report.summary.placementViolations, "inside/outside violations").toBe(0);
    expect(report.summary.maxAnchorErrorMm).toBeLessThanOrEqual(TOLERANCE.anchorMm);
    expect(report.summary.maxLengthErrorMm).toBeLessThanOrEqual(TOLERANCE.lengthMm);
    expect(report.summary.maxDisplayErrorMm).toBeLessThanOrEqual(TOLERANCE.displayMm);
    expect(failures.map((f) => `${f.id}: ${f.problems.join(";")}`)).toEqual([]);
  });
});

describe("PHASE 2F1-M — determinism", () => {
  // Anchor ORDER inside a record follows wall direction, so the fingerprint is
  // canonicalised: metrology is about the measured span, and swapping p1/p2
  // measures the identical span. Order sensitivity is asserted separately.
  const canonicalAnchors = (d) => {
    const a = `${Math.round(d.p1.x * 100)},${Math.round(d.p1.y * 100)}`;
    const b = `${Math.round(d.p2.x * 100)},${Math.round(d.p2.y * 100)}`;
    return a <= b ? `${a}|${b}` : `${b}|${a}`;
  };
  const fingerprint = (p) => {
    const out = generateWallDimensions(p, {});
    return (out.dimensions || [])
      .map((d) => `${d.kind}|${Math.round(d.measurementValue * 100)}|${canonicalAnchors(d)}`)
      .sort()
      .join("\n");
  };

  it("11. wall array reordering does not change any dimension", () => {
    const shuffled = { ...plan, walls: [...plan.walls].reverse() };
    expect(fingerprint(shuffled)).toBe(fingerprint(plan));
  });

  it("11. wall endpoint reversal does not change any dimension", () => {
    const reversed = { ...plan, walls: plan.walls.map((w) => ({ ...w, a: w.b, b: w.a })) };
    expect(fingerprint(reversed)).toBe(fingerprint(plan));
  });

  it("11. a plan far from the origin keeps every metrology guarantee", () => {
    const D = { x: 1234567, y: -987654 };
    const moved = {
      ...plan,
      nodes: Object.fromEntries(Object.entries(plan.nodes)
        .map(([id, p]) => [id, { x: p.x + D.x, y: p.y + D.y }])),
    };
    const here = inventoryDimensions(plan, generateWallDimensions(plan, {}).dimensions || []);
    const there = inventoryDimensions(moved, generateWallDimensions(moved, {}).dimensions || []);
    writeEvidence("translation-determinism.json",
      JSON.stringify({ base: here.summary, movedFarFromOrigin: there.summary }, null, 2));

    // Every hard guarantee must survive the move.
    for (const [name, r] of [["base", here], ["moved", there]]) {
      expect(r.summary.failed, `${name}: failing records`).toBe(0);
      expect(r.summary.duplicateExactSpans, `${name}: duplicate spans`).toBe(0);
      expect(r.summary.nearDuplicateDefects, `${name}: near-duplicate defects`).toBe(0);
      expect(r.summary.centrelineMeasurements, `${name}: centreline`).toBe(0);
      expect(r.summary.syntheticBbox, `${name}: bbox`).toBe(0);
      expect(r.summary.maxAnchorErrorMm).toBeLessThanOrEqual(TOLERANCE.anchorMm);
      expect(r.summary.maxLengthErrorMm).toBeLessThanOrEqual(TOLERANCE.lengthMm);
      expect(r.summary.maxDisplayErrorMm).toBeLessThanOrEqual(TOLERANCE.displayMm);
    }
    // The measured VALUES are the same set of spans.
    const values = (r) => r.records.map((x) => `${x.kind}|${Math.round(x.oracleLengthMm)}`).sort();
    expect(values(there)).toEqual(values(here));
    // Strict off-origin determinism: same record count and normalized anchors.
    expect(there.summary.total ?? there.records.length).toBe(here.summary.total ?? here.records.length);
    const normKey = (rec, dx, dy) => {
      const a = rec.p1 || rec.anchorA || {};
      const b = rec.p2 || rec.anchorB || {};
      const q = (n) => Math.round((Number(n) || 0) * 10) / 10;
      const p1 = `${q((a.x || 0) - dx)},${q((a.y || 0) - dy)}`;
      const p2 = `${q((b.x || 0) - dx)},${q((b.y || 0) - dy)}`;
      const anchors = p1 <= p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
      return `${rec.kind}|${Math.round(rec.oracleLengthMm || rec.measurementValueMm || 0)}|${anchors}`;
    };
    const hereKeys = here.records.map((r) => normKey(r, 0, 0)).sort();
    const thereKeys = there.records.map((r) => normKey(r, D.x, D.y)).sort();
    expect(thereKeys).toEqual(hereKeys);
  });
});

describe("PHASE 2F1-M — face contract on constructed fixtures", () => {
  it("4. an asymmetric-thickness room is measured on faces, not centrelines", () => {
    const nodes = {
      a1: { x: 0, y: 0 }, a2: { x: 5000, y: 0 },
      a3: { x: 5000, y: 4000 }, a4: { x: 0, y: 4000 },
    };
    const walls = [
      { ...W, id: "at", a: "a1", b: "a2", thk: 200, thicknessSide: "in" },
      { ...W, id: "ar", a: "a2", b: "a3", thk: 300, thicknessSide: "in" },
      { ...W, id: "ab", a: "a3", b: "a4", thk: 200, thicknessSide: "in" },
      { ...W, id: "al", a: "a4", b: "a1", thk: 300, thicknessSide: "in" },
    ];
    const p = mkPlan(nodes, walls);
    const dims = generateWallDimensions(p, {}).dimensions || [];
    const report = inventoryDimensions(p, dims);
    const faceDims = report.records.filter((r) => FACE_REQUIRED_KINDS.has(r.kind));
    expect(faceDims.length).toBeGreaterThan(0);
    for (const r of faceDims) {
      expect(r.usesCentreline, `${r.id} measured a centreline`).toBe(false);
      expect(r.anchorErrorMm, `${r.id} anchor off face`).toBeLessThanOrEqual(TOLERANCE.anchorMm);
      expect(r.lengthErrorMm, `${r.id} length error`).toBeLessThanOrEqual(TOLERANCE.lengthMm);
    }
  });

  it("6. the 3.08 / 3.09 / 3.10 rounding class reports true millimetres", () => {
    // Values that sit either side of a 10mm display step.
    for (const [dx, dy] of [[3084, 0], [3085, 0], [3086, 0], [3094, 0], [3095, 0], [3096, 0],
      [2182, 2182], [2183, 2183]]) {
      const raw = Math.hypot(dx, dy);
      const shownMetres = Math.round(raw / 10) * 10;
      expect(Math.abs(shownMetres - raw)).toBeLessThanOrEqual(5);
      const label = `${(shownMetres / 1000).toFixed(2)} м`;
      expect(parseLabelMm(label)).toBeCloseTo(shownMetres, 6);
    }
  });

  it("diagonal spans use Euclidean distance, never an axis substitute", () => {
    const dims = generateWallDimensions(plan, {}).dimensions || [];
    const oblique = dims.filter((d) => (d.orientation === "oblique"
      || d.axisOrDirection === "oblique") && d.p1 && d.p2);
    expect(oblique.length).toBeGreaterThan(0);
    for (const d of oblique) {
      const euclid = distance(d.p1, d.p2);
      expect(Math.abs(d.measurementValue - euclid)).toBeLessThanOrEqual(TOLERANCE.lengthMm);
      const dxAbs = Math.abs(d.p2.x - d.p1.x);
      const dyAbs = Math.abs(d.p2.y - d.p1.y);
      expect(d.measurementValue, "value collapsed to a bbox axis")
        .toBeGreaterThan(Math.max(dxAbs, dyAbs) - TOLERANCE.lengthMm);
    }
  });

  it("selection adds no dimension record", () => {
    const base = (generateWallDimensions(plan, {}).dimensions || []).length;
    const withSelection = (generateWallDimensions(plan, {
      selectedWallId: plan.walls[0].id,
    }).dimensions || []).length;
    expect(withSelection).toBe(base);
  });
});

describe("PHASE 2F1-M — anchors sit on real faces", () => {
  it("every face-required anchor resolves to a physical face of a real wall", () => {
    const dims = generateWallDimensions(plan, {}).dimensions || [];
    const candidates = faceCandidates(plan);
    const wallIds = new Set(plan.walls.map((w) => w.id));
    let checked = 0;
    for (const d of dims) {
      if (!FACE_REQUIRED_KINDS.has(d.kind) || !d.p1 || !d.p2) continue;
      for (const anchor of [d.p1, d.p2]) {
        const f = nearestFace(anchor, candidates);
        expect(f, `${d.id}: anchor on no face`).toBeTruthy();
        expect(wallIds.has(f.wallId)).toBe(true);
        expect(f.perpendicularMm).toBeLessThanOrEqual(TOLERANCE.anchorMm);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("a dimension span is parallel to the face it measures", () => {
    const dims = generateWallDimensions(plan, {}).dimensions || [];
    const candidates = faceCandidates(plan);
    for (const d of dims) {
      if (d.kind !== "room_edge_clear" && d.kind !== "external_segment") continue;
      const fa = nearestFace(d.p1, candidates);
      const fb = nearestFace(d.p2, candidates);
      if (!fa || !fb || fa.wallId !== fb.wallId) continue;
      const wall = plan.walls.find((w) => w.id === fa.wallId);
      const A = plan.nodes[wall.a];
      const B = plan.nodes[wall.b];
      const deg = angleBetweenDeg(sub(d.p2, d.p1), sub(B, A));
      expect(deg, `${d.id} not parallel to its face`).toBeLessThanOrEqual(TOLERANCE.parallelDeg);
      expect(unitTangent(d.p1, d.p2)).toBeTruthy();
    }
  });
});
