/**
 * PHASE 2F1 — build the acceptance fixture set with REAL BROWSER MOUSE INPUT ONLY.
 *
 * The user's video proved that construction path matters: walls produced by
 * helper commands could be dragged through other walls, while a wall drawn by
 * hand with the Wall tool clipped correctly at the first host. So every wall
 * here is created by pressing the real Wall tool and dragging the real pointer
 * across the visible canvas. This file never calls commitDrawnWall, never
 * touches wallCommands, never writes a plan through the API and never mutates
 * plan state — it only drives the mouse and reads back what the app produced.
 *
 * Stops at the FIRST failed assertion and preserves the browser state.
 *
 * Evidence: C:\tmp\phase2f1-real-mouse-fixtures\
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  VIEWPORT, readView, toScreen, selectTool, ensureVisible, drawWall, readTopology,
} from "./lib/phase2f1RealMouse.mjs";
import { classifyPlanTopologyAnomalies } from "../src/planner/core/walls/legacyTopologyAudit.js";
import { repairLegacyTopology } from "../src/planner/core/walls/legacyTopologyRepair.js";

// Local diagnostic tooling. Credentials are never stored here: the run config
// (BASE/API/ADMIN_KEY/PROJECT_ID) is read from a file OUTSIDE the repository.
// Override both paths so a fresh session can point them anywhere writable.
const ENV_FILE = process.env.PHASE2F1_ENV_FILE || "C:/tmp/phase2f1-dimensions/env.json";
const ENV = JSON.parse(fs.readFileSync(ENV_FILE, "utf8"));
const OUT = process.env.PHASE2F1_FIXTURES_DIR || "C:/tmp/phase2f1-real-mouse-fixtures";
const SHOTS = path.join(OUT, "shots-build");
fs.mkdirSync(SHOTS, { recursive: true });

const W_OUTER = "outer";
const ORIGIN_SPACING = { x: 14000, y: 12000 };
const originOf = (col, row) => ({ x: col * ORIGIN_SPACING.x, y: row * ORIGIN_SPACING.y });
const at = (origin, x, y) => ({ x: origin.x + x, y: origin.y + y });

/**
 * The 14 control schemes, in LOCAL millimetres. `overshoot` marks a gesture that
 * deliberately drags past its terminating host so the preview clipping contract
 * can be proved.
 */
function buildSchemes() {
  const S = [];
  // Closed contours must produce rooms. Asserting this is what catches a
  // contour that LOOKS closed but whose corner never welded — the failure mode
  // that angle snap produced on the shallow oblique edge.
  const EXPECT_ROOMS = {
    1: 1, 2: 1, 3: 1, 4: 2, 5: 1, 6: 1, 7: 1,
    8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0,
  };
  const add = (n, key, title, ru, col, row, walls, notes = {}) => {
    S.push({
      number: n, key, title, ru, origin: originOf(col, row), walls,
      expectRooms: EXPECT_ROOMS[n], ...notes,
    });
  };

  add(1, "S01_rectangle", "Simple rectangle", "Прямоугольная комната", 0, 0, [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }], [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }], [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ]);

  add(2, "S02_asymmetric", "Asymmetric wall thickness", "Прямоугольник с толстыми стенами", 1, 0, [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }], [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }], [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ], { thicknessMm: 200 });

  add(3, "S03_lshape", "L-shaped room", "Г-образная комната", 2, 0, [
    [{ x: 0, y: 0 }, { x: 6000, y: 0 }], [{ x: 6000, y: 0 }, { x: 6000, y: 3000 }],
    [{ x: 6000, y: 3000 }, { x: 3000, y: 3000 }], [{ x: 3000, y: 3000 }, { x: 3000, y: 6000 }],
    [{ x: 3000, y: 6000 }, { x: 0, y: 6000 }], [{ x: 0, y: 6000 }, { x: 0, y: 0 }],
  ]);

  add(4, "S04_two_rooms", "Two rooms, shared partition", "Две комнаты с общей перегородкой", 3, 0, [
    [{ x: 0, y: 0 }, { x: 8000, y: 0 }], [{ x: 8000, y: 0 }, { x: 8000, y: 4000 }],
    [{ x: 8000, y: 4000 }, { x: 0, y: 4000 }], [{ x: 0, y: 4000 }, { x: 0, y: 0 }],
    // overshoot: drag well past the bottom wall — preview must clip at y=4000
    [{ x: 4000, y: 0 }, { x: 4000, y: 6000 }, { overshoot: { x: 4000, y: 4000 } }],
  ]);

  add(5, "S05_narrow", "Narrow room", "Узкая комната", 0, 1, [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }], [{ x: 4000, y: 0 }, { x: 4000, y: 900 }],
    [{ x: 4000, y: 900 }, { x: 0, y: 900 }], [{ x: 0, y: 900 }, { x: 0, y: 0 }],
  ]);

  // Free angles: drawn with the app's Alt modifier, otherwise angle snap
  // flattens a shallow edge to 0 degrees and the contour never closes.
  add(6, "S06_oblique", "Irregular / oblique quad", "Косоугольная комната", 1, 1, [
    [{ x: 400, y: 0 }, { x: 5400, y: 400 }, { alt: true }],
    [{ x: 5400, y: 400 }, { x: 4700, y: 3600 }, { alt: true }],
    [{ x: 4700, y: 3600 }, { x: 0, y: 3000 }, { alt: true }],
    [{ x: 0, y: 3000 }, { x: 400, y: 0 }, { alt: true }],
  ]);

  add(7, "S07_off_origin", "Off-origin room", "Комната со смещением", 2, 1, [
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }], [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }], [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
  ]);

  add(8, "S08_one_ended_t", "One-ended T branch", "Т-образное примыкание одним концом", 3, 1, [
    [{ x: 0, y: 0 }, { x: 6000, y: 0 }],
    [{ x: 3000, y: 0 }, { x: 3000, y: 3500 }],
  ]);

  add(9, "S09_double_t", "Double-T between parallel hosts", "Перегородка между двумя стенами", 0, 2, [
    [{ x: 0, y: 0 }, { x: 8000, y: 0 }],
    [{ x: 0, y: 4000 }, { x: 8000, y: 4000 }],
    // overshoot: must clip on the lower host
    [{ x: 4000, y: 0 }, { x: 4000, y: 6000 }, { overshoot: { x: 4000, y: 4000 } }],
  ]);

  add(10, "S10_cross", "Open degree-4 cross", "Крестовина", 1, 2, [
    [{ x: 0, y: 3000 }, { x: 6000, y: 3000 }],
    [{ x: 3000, y: 0 }, { x: 3000, y: 6000 }, { overshoot: { x: 3000, y: 3000 } }],
  ]);

  add(11, "S11_three_way", "Diagonal / corner three-way node", "Тройной узел с диагональю", 2, 2, [
    [{ x: 0, y: 3000 }, { x: 6000, y: 3000 }],
    [{ x: 6000, y: 3000 }, { x: 6000, y: 0 }],
    [{ x: 6000, y: 3000 }, { x: 9000, y: 6000 }],
  ]);

  add(12, "S12_heal", "Host split / heal fixture", "Стена для проверки заживления", 3, 2, [
    [{ x: 0, y: 0 }, { x: 6000, y: 0 }],
    [{ x: 3000, y: 0 }, { x: 3000, y: 3500 }],
  ]);

  add(13, "S13_independent", "Intentionally independent walls", "Две независимые стены в линию", 0, 3, [
    [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
    [{ x: 3000, y: 0 }, { x: 6000, y: 0 }],
  ], { independent: true });

  add(14, "S14_two_branches", "Two branches on one host", "Две перегородки на одной стене", 1, 3, [
    [{ x: 0, y: 0 }, { x: 8000, y: 0 }],
    [{ x: 2500, y: 0 }, { x: 2500, y: 3500 }],
    [{ x: 5500, y: 0 }, { x: 5500, y: 3500 }],
  ]);

  return S;
}

const findings = [];
let failed = null;
const check = (id, ok, msg) => {
  findings.push({ id, ok: !!ok, msg });
  console.log(`${ok ? "  ok  " : "  FAIL"} [${id}] ${msg}`);
  if (!ok && !failed) failed = { id, msg };
  return !!ok;
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Every §5 invariant, evaluated on the live plan after each gesture. */
function verifyTopology(topology, planForAudit, label) {
  const results = [];
  const nodesById = Object.fromEntries(topology.nodes.map((n) => [n.id, n]));

  const noChain = topology.walls.filter((w) => w.chainId == null);
  results.push([`${label}.chainId`, noChain.length === 0,
    `every wall carries chainId (${noChain.length} without)`]);

  const coincident = [];
  for (let i = 0; i < topology.nodes.length; i++) {
    for (let j = i + 1; j < topology.nodes.length; j++) {
      if (dist(topology.nodes[i], topology.nodes[j]) <= 1.5) {
        coincident.push([topology.nodes[i].id, topology.nodes[j].id]);
      }
    }
  }
  results.push([`${label}.coincident`, coincident.length === 0,
    `no coincident duplicate nodes (${JSON.stringify(coincident)})`]);

  const audit = classifyPlanTopologyAnomalies(planForAudit);
  const unnoded = audit.anomalies.filter((a) => a.class === "UNNODED_CROSSING");
  results.push([`${label}.unnoded`, unnoded.length === 0,
    `no unnoded crossing / endpoint-on-body (${unnoded.length})`]);

  const stale = audit.anomalies.filter((a) => a.class === "STALE_LEGACY_PLAN_STRUCTURE");
  results.push([`${label}.stale`, stale.length === 0,
    `no stale legacy structure (${stale.length})`]);

  const repair = repairLegacyTopology(planForAudit, { makeId: (p) => `${p}_probe` });
  results.push([`${label}.repairs`, repair.repairs.length === 0,
    `legacy repair finds nothing to fix (${repair.repairs.length})`]);

  const danglingOnBody = topology.nodes.filter((n) => {
    if (n.degree !== 1) return false;
    return topology.walls.some((w) => {
      if (w.a === n.id || w.b === n.id || !w.A || !w.B) return false;
      const dx = w.B.x - w.A.x;
      const dy = w.B.y - w.A.y;
      const l2 = dx * dx + dy * dy;
      if (l2 < 1e-9) return false;
      const t = Math.max(0, Math.min(1, ((n.x - w.A.x) * dx + (n.y - w.A.y) * dy) / l2));
      const d = Math.hypot(n.x - (w.A.x + dx * t), n.y - (w.A.y + dy * t));
      const along = t * Math.sqrt(l2);
      return d <= 1.5 && along > 2 && along < Math.sqrt(l2) - 2;
    });
  });
  results.push([`${label}.degree1_on_body`, danglingOnBody.length === 0,
    `no degree-1 endpoint sitting on a wall body (${danglingOnBody.map((n) => n.id)})`]);

  void nodesById;
  return results;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const writes = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/projects/") && ["PUT", "PATCH"].includes(req.method())) {
      writes.push(Date.now());
    }
  });

  await page.goto(`${ENV.BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="password"], input[name="key"], input', ENV.ADMIN_KEY);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);

  // A brand-new EMPTY project, created through the application's own project
  // endpoint (no plan payload — the plan is produced entirely by mouse below).
  const project = await page.evaluate(async ({ api, key }) => {
    const r = await fetch(`${api}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": key },
      body: JSON.stringify({
        name: "PHASE 2F1 real-mouse acceptance", client: "local", status: "draft",
      }),
    });
    return r.json();
  }, { api: ENV.API, key: ENV.ADMIN_KEY });
  console.log(`\nNEW PROJECT: ${project.id}\n`);

  await page.goto(`${ENV.BASE}/project/${project.id}/plan`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
  await page.waitForTimeout(1500);

  const start = await readTopology(page);
  check("INIT", start.walls.length === 0, `the new project starts empty (${start.walls.length} walls)`);

  const schemes = buildSchemes();
  const manifest = { projectId: project.id, generatedAt: new Date().toISOString(), schemes: [] };

  for (const scheme of schemes) {
    if (failed) break;
    console.log(`\n--- scheme ${scheme.number}: ${scheme.title} ---`);
    const worldWalls = scheme.walls.map(([a, b, opts]) => ({
      from: at(scheme.origin, a.x, a.y),
      to: at(scheme.origin, b.x, b.y),
      overshoot: opts?.overshoot ? at(scheme.origin, opts.overshoot.x, opts.overshoot.y) : null,
      alt: !!opts?.alt,
    }));
    const allPoints = worldWalls.flatMap((w) => [w.from, w.to]);
    await ensureVisible(page, allPoints, { zoom: 0.12 });

    const roomsBefore = (await readTopology(page)).roomCount;
    const record = {
      number: scheme.number, key: scheme.key, title: scheme.title, ru: scheme.ru,
      origin: scheme.origin, expectRooms: scheme.expectRooms, walls: [],
    };

    for (const [index, spec] of worldWalls.entries()) {
      const result = await drawWall(page, spec.from, spec.to, { alt: spec.alt });
      const topology = await readTopology(page);
      const plan = await page.evaluate(() => ({
        nodes: JSON.parse(JSON.stringify(window.__dgPlanner.plan.nodes || {})),
        walls: JSON.parse(JSON.stringify(window.__dgPlanner.plan.walls || [])),
      }));

      const label = `S${String(scheme.number).padStart(2, "0")}w${index + 1}`;
      // A gesture that tees into a host legitimately produces MORE than one
      // record: the drawn wall, plus a new half for every host it split. The
      // drawn wall is the one whose endpoints match the preview.
      const newWalls = topology.walls.filter((w) => result.createdWallIds.includes(w.id));
      if (!check(`${label}.created`, newWalls.length >= 1,
        `the pointer gesture produced geometry (${newWalls.length} new records)`)) break;

      const pv = result.preview;
      const matchesPreview = (w) => {
        if (!pv?.start || !pv?.end) return false;
        return (dist(w.A, pv.start) <= 1.5 && dist(w.B, pv.end) <= 1.5)
          || (dist(w.B, pv.start) <= 1.5 && dist(w.A, pv.end) <= 1.5);
      };
      const created = newWalls.find(matchesPreview) || newWalls[0];
      check(`${label}.drawn_wall_identified`, !!newWalls.find(matchesPreview),
        `the drawn wall is identifiable from the preview (${created?.id})`);

      // Every OTHER new record must be a split half of a wall that already
      // existed — never a stray extra wall invented by the gesture.
      const splits = newWalls.filter((w) => w.id !== created.id);
      const priorChainIds = new Set(record.walls.map((w) => w.chainId)
        .concat(manifest.schemes.flatMap((s) => s.walls.map((w) => w.chainId))));
      const strays = splits.filter((w) => !priorChainIds.has(w.chainId));
      check(`${label}.only_host_splits`, strays.length === 0,
        `extra records are host splits of existing walls (${splits.length} splits, ${strays.length} stray)`);

      const previewEnd = result.preview?.end;
      if (previewEnd) {
        const ends = [created.A, created.B];
        const nearest = Math.min(...ends.map((e) => dist(e, previewEnd)));
        check(`${label}.preview_equals_persisted`, nearest <= 1.5,
          `persisted endpoint equals the visible preview endpoint (${nearest.toFixed(2)}mm)`);
      } else {
        check(`${label}.preview_captured`, false, "no preview was exposed before pointerup");
      }

      if (spec.overshoot) {
        const ends = [created.A, created.B];
        const clipDist = Math.min(...ends.map((e) => dist(e, spec.overshoot)));
        const beyond = Math.max(...ends.map((e) => dist(e, spec.from)));
        const intended = dist(spec.from, spec.overshoot);
        check(`${label}.clipped_at_host`, clipDist <= 60,
          `overshoot clipped at the first host (${clipDist.toFixed(1)}mm from it)`);
        check(`${label}.no_overrun`, beyond <= intended + 60,
          `no geometry continued past the host (${beyond.toFixed(0)} vs ${intended.toFixed(0)}mm)`);
      }

      for (const [id, ok, msg] of verifyTopology(topology, plan, label)) check(id, ok, msg);
      if (failed) break;

      record.walls.push({
        index: index + 1,
        requested: spec,
        preview: result.preview,
        wallId: created.id,
        chainId: created.chainId,
        a: created.a, b: created.b, A: created.A, B: created.B,
        lengthMm: Math.round(dist(created.A, created.B)),
      });
    }
    // Rooms are cumulative across schemes, so compare the delta this scheme added.
    const roomsNow = (await readTopology(page)).roomCount;
    check(`S${String(scheme.number).padStart(2, "0")}.rooms`,
      roomsNow - roomsBefore === scheme.expectRooms,
      `scheme closed as intended: ${roomsNow - roomsBefore} room(s), expected ${scheme.expectRooms}`);
    record.roomsAdded = roomsNow - roomsBefore;

    manifest.schemes.push(record);
    await page.screenshot({ path: path.join(SHOTS, `scheme-${String(scheme.number).padStart(2, "0")}.png`) });
    if (failed) break;
  }

  const finalTopology = await readTopology(page);
  manifest.totals = {
    walls: finalTopology.walls.length,
    nodes: finalTopology.nodes.length,
    rooms: finalTopology.roomCount,
    zones: finalTopology.zoneCount,
    apiWrites: writes.length,
  };
  manifest.findings = findings;
  manifest.failed = failed;
  fs.writeFileSync(path.join(OUT, "scheme-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT, "final-topology.json"),
    JSON.stringify(finalTopology, null, 2), "utf8");

  console.log(`\ntotals: ${JSON.stringify(manifest.totals)}`);
  console.log(`manifest: ${path.join(OUT, "scheme-manifest.json")}`);
  if (failed) {
    console.log(`\nSTOPPED at first failure: [${failed.id}] ${failed.msg}`);
    await page.screenshot({ path: path.join(SHOTS, "FAILURE-STATE.png") });
  }
  console.log(failed ? "RESULT: STOPPED" : "RESULT: BUILD PASS");
  await browser.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
