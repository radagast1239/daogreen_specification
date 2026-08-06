/**
 * PHASE 2F1-M2 — exhaustive translation sweep (the M2 87-case gate).
 *
 * Proves normalized equivalence of every pipeline stage under many
 * translations, including quantization boundaries, reorder and reversal.
 * 3 variants x 29 vectors = 87 cases.
 *
 * Plan fixture: tests/fixtures/phase2f1/originIndependencePlan.json (in-repo,
 * frozen). A missing fixture is a hard failure, never a skip.
 * Optional evidence dump: set PHASE2F1_EVIDENCE_DIR to a writable directory.
 */
import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { buildRenderedContours } from "../src/planner/core/walls/renderedContours.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { wallGeometryMap } from "../src/planner/buildWallGeometry.js";
import { buildWallMassGeometry } from "../src/planner/core/walls/wallMass.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = path.join(REPO, "tests/fixtures/phase2f1/originIndependencePlan.json");
const PLAN = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
const OUT = process.env.PHASE2F1_EVIDENCE_DIR || null;

const translate = (plan, dx, dy) => ({
  ...plan,
  nodes: Object.fromEntries(Object.entries(plan.nodes).map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }])),
});
const q = (n, s = 10) => Math.round(n * s) / s;
const sub = (p, dx, dy) => ({ x: p.x - dx, y: p.y - dy });
const seg = (a, b, dx, dy) => {
  const s = `${q(a.x - dx)},${q(a.y - dy)}`;
  const e = `${q(b.x - dx)},${q(b.y - dy)}`;
  return s <= e ? `${s}|${e}` : `${e}|${s}`;
};
function loopKey(loop, dx, dy) {
  const pts = (loop || []).map((p) => sub(p, dx, dy));
  if (!pts.length) return "";
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[best].x - 1e-9
      || (Math.abs(pts[i].x - pts[best].x) < 1e-9 && pts[i].y < pts[best].y)) best = i;
  }
  const rot = [...pts.slice(best), ...pts.slice(0, best)];
  const fwd = rot.map((p) => `${q(p.x)},${q(p.y)}`).join(">");
  const rev = [rot[0], ...rot.slice(1).reverse()].map((p) => `${q(p.x)},${q(p.y)}`).join(">");
  return fwd <= rev ? fwd : rev;
}

/** Stage-by-stage normalized fingerprints A..Q. */
function fingerprint(plan, dx, dy) {
  const walls = resolvePlanWalls(plan);
  const geom = wallGeometryMap(walls, plan.room);
  const masses = buildWallMassGeometry(geom.polygons, geom.expandedWalls || walls);
  const c = buildRenderedContours(plan);
  const dims = generateWallDimensions(plan, {}).dimensions || [];

  const centrelines = walls.flatMap((w) => {
    const out = [];
    for (let i = 1; i < (w.pts || []).length; i++) out.push(seg(w.pts[i - 1], w.pts[i], dx, dy));
    return out;
  }).sort();
  const quads = (geom.polygons || [])
    .map((p) => (p.quad || []).map((pt) => `${q(pt.x - dx)},${q(pt.y - dy)}`).sort().join(" "))
    .sort();
  const massEdges = masses.flatMap((m) => (m.boundaryEdges || []).map((e) => seg(e.a, e.b, dx, dy))).sort();
  const massLoops = masses.flatMap((m) => [
    ...(m.loops || []).map((l) => loopKey(l, dx, dy)),
    ...(m.holeLoops || []).map((l) => loopKey(l, dx, dy)),
  ]).sort();
  const rooms = (c.roomContours || []).map((r) => loopKey(r.loop, dx, dy)).sort();
  const envSegs = (c.envelopes || []).flatMap((e) => (e.segments || []).map((s) => seg(s.a, s.b, dx, dy))).sort();
  const dimKeys = dims.map((d) => {
    const a = `${q(d.p1.x - dx)},${q(d.p1.y - dy)}`;
    const b = `${q(d.p2.x - dx)},${q(d.p2.y - dy)}`;
    const anchors = a <= b ? `${a}|${b}` : `${b}|${a}`;
    return `${d.kind}|${Math.round((d.measurementValue || 0) * 100) / 100}|${anchors}|off=${d.offset}|ref=${d.reference?.wallId || ""}`;
  }).sort();

  return {
    A_centrelines: centrelines,
    C_quads: quads,
    D_massEdges: massEdges,
    I_massLoops: massLoops,
    J_rooms: rooms,
    L_envSegs: envSegs,
    Q_dims: dimKeys,
    counts: {
      walls: walls.length,
      quads: quads.length,
      masses: masses.length,
      massEdges: massEdges.length,
      rooms: rooms.length,
      envelopes: (c.envelopes || []).length,
      dims: dimKeys.length,
    },
  };
}

const VECTORS = [
  ["+1mm X", 1, 0], ["+1mm Y", 0, 1], ["-1mm X", -1, 0], ["-1mm Y", 0, -1],
  ["+10mm", 10, 10], ["+100mm", 100, 100], ["+1000mm", 1000, 1000],
  ["+10000mm", 10000, 10000], ["+100000mm", 100000, 100000],
  ["+1.2km", 1200000, 1200000], ["-1.2km", -1200000, -1200000],
  ["accepted D", 1234567, -987654], ["accepted -D", -1234567, 987654],
  ["X only 1.2km", 1200000, 0], ["Y only -1.2km", 0, -1200000],
  ["diagonal", 500000, -500000],
  // quantization / bucket boundary probes
  ["q 0.4", 0.4, 0.4], ["q 0.5", 0.5, 0.5], ["q 0.6", 0.6, 0.6],
  ["q 0.05", 0.05, 0.05], ["q 0.5 X", 0.5, 0], ["q 0.5 Y", 0, 0.5],
  ["q 999.5", 999.5, 0], ["q 1000.5", 1000.5, 0],
  ["q 4.9999", 4.9999, 0], ["q 5.0001", 5.0001, 0],
  ["q 49999.5", 49999.5, 49999.5],
  ["odd frac", 1234.567, -8765.4321],
  ["huge", 12345678, -87654321],
];

it("m2 translation sweep — every stage stays normalized-equivalent (87 cases)", () => {
  const base = fingerprint(PLAN, 0, 0);
  const stages = Object.keys(base).filter((k) => k !== "counts");
  const results = [];
  let firstFailure = null;

  const variants = [
    ["plain", (p) => p],
    ["reordered", (p) => ({ ...p, walls: [...p.walls].reverse() })],
    ["reversed", (p) => ({ ...p, walls: p.walls.map((w) => ({ ...w, a: w.b, b: w.a })) })],
  ];

  for (const [vname, vfn] of variants) {
    const vbase = vname === "plain" ? base : fingerprint(vfn(PLAN), 0, 0);
    for (const [name, dx, dy] of VECTORS) {
      const fp = fingerprint(translate(vfn(PLAN), dx, dy), dx, dy);
      const bad = [];
      for (const st of stages) {
        if (JSON.stringify(fp[st]) !== JSON.stringify(vbase[st])) bad.push(st);
      }
      results.push({ variant: vname, vector: name, dx, dy, counts: fp.counts, divergedStages: bad });
      if (bad.length && !firstFailure) {
        const st = bad[0];
        const A = vbase[st]; const B = fp[st];
        const diffA = A.filter((x) => !B.includes(x));
        const diffB = B.filter((x) => !A.includes(x));
        firstFailure = { variant: vname, vector: name, dx, dy, stage: st, onlyBase: diffA.slice(0, 12), onlyMoved: diffB.slice(0, 12) };
      }
    }
  }

  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "translation-sweep.json"),
      JSON.stringify({ baseCounts: base.counts, results, firstFailure }, null, 2));
  }

  const failed = results.filter((r) => r.divergedStages.length);
  if (firstFailure) console.log("FIRST FAILURE:", JSON.stringify(firstFailure, null, 2));
  for (const f of failed) console.log("DIVERGED:", f.variant, f.vector, f.divergedStages.join(","), JSON.stringify(f.counts));

  // 3 variants x 29 vectors — the case count is part of the contract.
  expect(results.length).toBe(87);
  expect(base.counts.dims).toBe(66);
  expect(failed.map((f) => `${f.variant}/${f.vector}:${f.divergedStages}`)).toEqual([]);
}, 30000);
