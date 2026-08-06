/**
 * PHASE 2F1 — movement / dimension / persistence acceptance on the REAL-MOUSE
 * fixture set. Every gesture below is real pointer input: centre handles and
 * endpoint grips are pressed and dragged, never moved through an e2e hook.
 *
 * Evidence: C:\tmp\phase2f1-real-mouse-fixtures\acceptance.json
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  VIEWPORT, readView, toScreen, selectTool, ensureVisible, readTopology,
} from "./lib/phase2f1RealMouse.mjs";
import { classifyPlanTopologyAnomalies } from "../src/planner/core/walls/legacyTopologyAudit.js";
import { repairLegacyTopology } from "../src/planner/core/walls/legacyTopologyRepair.js";

// Local diagnostic tooling. Credentials are never stored here: the run config
// (BASE/API/ADMIN_KEY/PROJECT_ID) is read from a file OUTSIDE the repository.
// Override both paths so a fresh session can point them anywhere writable.
const ENV_FILE = process.env.PHASE2F1_ENV_FILE || "C:/tmp/phase2f1-dimensions/env.json";
const ENV = JSON.parse(fs.readFileSync(ENV_FILE, "utf8"));
const OUT = process.env.PHASE2F1_FIXTURES_DIR || "C:/tmp/phase2f1-real-mouse-fixtures";
const SHOTS = path.join(OUT, "shots-acceptance");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(OUT, "scheme-manifest.json"), "utf8"));
const PROJECT = MANIFEST.projectId;
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
let failures = 0;
const check = (id, ok, msg) => {
  findings.push({ id, ok: !!ok, msg });
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} [${id}] ${msg}`);
  return !!ok;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const scheme = (n) => MANIFEST.schemes.find((s) => s.number === n);

async function apiPlan() {
  const r = await fetch(`${ENV.API}/api/projects/${PROJECT}`, {
    headers: { "X-Admin-Key": ENV.ADMIN_KEY },
  });
  return (await r.json()).plan;
}

const degreeOf = (plan, nodeId) => (plan.walls || [])
  .filter((w) => w.a === nodeId || w.b === nodeId).length;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const writes = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/projects/${PROJECT}`) && ["PUT", "PATCH"].includes(req.method())) {
      writes.push(Date.now());
    }
  });

  await page.goto(`${ENV.BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="password"], input[name="key"], input', ENV.ADMIN_KEY);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  await page.goto(`${ENV.BASE}/project/${PROJECT}/plan`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
  await page.waitForTimeout(1500);

  const shot = async (n) => page.screenshot({ path: path.join(SHOTS, n) });

  /** Live geometry of one wall, straight from the running app. */
  const wallNow = async (wallId) => page.evaluate((id) => {
    const p = window.__dgPlanner;
    const w = (p.plan.walls || []).find((x) => x.id === id);
    if (!w) return null;
    const rw = (p.resolvedWalls || []).find((x) => x.id === id);
    return {
      id, a: w.a, b: w.b, chainId: w.chainId,
      A: { ...p.plan.nodes[w.a] }, B: { ...p.plan.nodes[w.b] },
      pts: rw ? rw.pts.map((q) => ({ x: q.x, y: q.y })) : null,
    };
  }, wallId);

  /** Real click on a wall body, slightly off-centre to miss the dimension. */
  const selectWall = async (wallId) => {
    await selectTool(page, "Выбор");
    const w = await wallNow(wallId);
    const v = await readView(page);
    const p = {
      x: w.pts[0].x + (w.pts[1].x - w.pts[0].x) * 0.36,
      y: w.pts[0].y + (w.pts[1].y - w.pts[0].y) * 0.36,
    };
    const s = toScreen(p, v);
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(450);
    return page.evaluate(() => (window.__dgPlanner.selection
      ? { coll: window.__dgPlanner.selection.coll, ids: [...window.__dgPlanner.selection.ids] }
      : null));
  };

  /**
   * Drag a wall by its CENTRE HANDLE with the real mouse: press on the handle
   * at the wall midpoint and move the pointer, exactly as a user does.
   */
  const dragWallCentre = async (wallId, deltaMm, { steps = 12 } = {}) => {
    await selectWall(wallId);
    const w = await wallNow(wallId);
    const v = await readView(page);
    const mid = {
      x: (w.pts[0].x + w.pts[1].x) / 2,
      y: (w.pts[0].y + w.pts[1].y) / 2,
    };
    const from = toScreen(mid, v);
    const to = {
      x: from.x + deltaMm.x * v.view.zoom,
      y: from.y + deltaMm.y * v.view.zoom,
    };
    await page.mouse.move(from.x, from.y);
    await page.waitForTimeout(120);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + (to.x - from.x) * (i / steps),
        from.y + (to.y - from.y) * (i / steps));
      await page.waitForTimeout(45);
    }
    await page.mouse.up();
    await page.waitForTimeout(1100);
    return wallNow(wallId);
  };

  // ============================================================ S09 double-T
  const s09 = scheme(9);
  const hostTop = s09.walls[0].wallId;
  const partition = s09.walls[2].wallId;
  await ensureVisible(page, [
    { x: s09.origin.x, y: s09.origin.y }, { x: s09.origin.x + 8000, y: s09.origin.y + 4000 },
  ], { zoom: 0.14 });

  const p0 = await wallNow(partition);
  const plan0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
  check("S09.attached", degreeOf(plan0, p0.a) === 3 && degreeOf(plan0, p0.b) === 3,
    `partition starts attached to both hosts (degrees ${degreeOf(plan0, p0.a)}/${degreeOf(plan0, p0.b)})`);
  await shot("s09-01-before.png");

  // horizontal drag → slides along both hosts
  const afterH = await dragWallCentre(partition, { x: 1500, y: 0 });
  const planH = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
  check("S09.slide_x", Math.abs(afterH.A.x - (p0.A.x + 1500)) <= 60,
    `horizontal drag slid the partition along its hosts (${Math.round(afterH.A.x - p0.A.x)}mm)`);
  check("S09.slide_attached",
    degreeOf(planH, afterH.a) === 3 && degreeOf(planH, afterH.b) === 3,
    `both endpoints stayed attached after sliding (${degreeOf(planH, afterH.a)}/${degreeOf(planH, afterH.b)})`);
  check("S09.slide_length", Math.abs(dist(afterH.A, afterH.B) - dist(p0.A, p0.B)) <= 2,
    "the partition kept its length while sliding");
  await shot("s09-02-slid.png");

  // vertical drag → must be blocked by the host constraint
  const beforeV = await wallNow(partition);
  const afterV = await dragWallCentre(partition, { x: 0, y: 1200 });
  check("S09.vertical_blocked", Math.abs(afterV.A.y - beforeV.A.y) <= 2
    && Math.abs(afterV.B.y - beforeV.B.y) <= 2,
  `vertical drag cannot pass through the hosts (moved ${Math.round(afterV.A.y - beforeV.A.y)}mm)`);

  // diagonal drag → only the component along the hosts is applied
  const beforeD = await wallNow(partition);
  const afterD = await dragWallCentre(partition, { x: -900, y: 900 });
  check("S09.diagonal_tangent_only",
    Math.abs(afterD.A.x - (beforeD.A.x - 900)) <= 60 && Math.abs(afterD.A.y - beforeD.A.y) <= 2,
    `diagonal drag applied only the common tangent (dx=${Math.round(afterD.A.x - beforeD.A.x)}, dy=${Math.round(afterD.A.y - beforeD.A.y)})`);

  // huge drag → stays within the finite host extents
  const beforeBig = await wallNow(partition);
  const afterBig = await dragWallCentre(partition, { x: 9000, y: 0 });
  const host = await wallNow(hostTop);
  const hostMinX = Math.min(host.A.x, host.B.x);
  const hostMaxX = Math.max(host.A.x, host.B.x);
  check("S09.bounded", afterBig.A.x >= hostMinX - 1 && afterBig.A.x <= hostMaxX + 1,
    `a 9 m drag stayed inside the host extent (x=${Math.round(afterBig.A.x)} in [${hostMinX}..${hostMaxX}])`);
  const planBig = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
  check("S09.bounded_attached",
    degreeOf(planBig, afterBig.a) === 3 && degreeOf(planBig, afterBig.b) === 3,
    "still attached to both hosts after the oversized drag");
  await shot("s09-03-bounded.png");

  // ===================================================== S01 connected room
  const s01 = scheme(1);
  await ensureVisible(page, [
    { x: s01.origin.x, y: s01.origin.y }, { x: s01.origin.x + 4000, y: s01.origin.y + 3000 },
  ], { zoom: 0.14 });
  const top = s01.walls[0].wallId;
  const left = s01.walls[3].wallId;
  const topBefore = await wallNow(top);
  const leftBefore = await wallNow(left);
  const topAfter = await dragWallCentre(top, { x: 0, y: -800 });
  const leftAfter = await wallNow(left);
  check("S01.moved", Math.abs(topAfter.A.y - (topBefore.A.y - 800)) <= 60,
    `the top wall moved with its centre handle (${Math.round(topAfter.A.y - topBefore.A.y)}mm)`);
  check("S01.neighbour_stretched",
    Math.abs(dist(leftAfter.A, leftAfter.B) - dist(leftBefore.A, leftBefore.B)) >= 700,
    `the neighbouring wall stretched (${Math.round(dist(leftBefore.A, leftBefore.B))} -> ${Math.round(dist(leftAfter.A, leftAfter.B))}mm)`);
  const planS01 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
  check("S01.no_pass_through",
    classifyPlanTopologyAnomalies(planS01).anomalies
      .filter((a) => a.class === "UNNODED_CROSSING").length === 0,
    "no wall passed through a connected wall");
  await shot("s01-moved.png");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1200);

  // ============================================ S12 branch delete → host heal
  const s12 = scheme(12);
  await ensureVisible(page, [
    { x: s12.origin.x, y: s12.origin.y }, { x: s12.origin.x + 6000, y: s12.origin.y + 3500 },
  ], { zoom: 0.14 });
  const branch12 = s12.walls[1].wallId;
  const hostChain12 = s12.walls[0].chainId;
  const before12 = await page.evaluate((c) => (window.__dgPlanner.plan.walls || [])
    .filter((w) => w.chainId === c).length, hostChain12);
  await selectWall(branch12);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(1400);
  const after12 = await page.evaluate((c) => (window.__dgPlanner.plan.walls || [])
    .filter((w) => w.chainId === c).length, hostChain12);
  check("S12.heal", before12 === 2 && after12 === 1,
    `deleting the branch healed the host (${before12} -> ${after12} segments)`);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1400);
  const undo12 = await page.evaluate((c) => (window.__dgPlanner.plan.walls || [])
    .filter((w) => w.chainId === c).length, hostChain12);
  check("S12.undo", undo12 === 2, `Undo restored the T split (${undo12} segments)`);

  // ==================================================== S13 independent walls
  const s13 = scheme(13);
  const w13a = s13.walls[0];
  const w13b = s13.walls[1];
  check("S13.independent_lineage", w13a.chainId !== w13b.chainId,
    `the two collinear walls kept separate lineage (${w13a.chainId} vs ${w13b.chainId})`);
  const planS13 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
  check("S13.not_merged",
    [w13a.wallId, w13b.wallId].every((id) => planS13.walls.some((w) => w.id === id)),
    "both independent walls still exist as separate records");

  // ============================================ dimensions under repeated move
  const dimKeys = async () => page.evaluate(() => (window.__dgPlanner.runtimeDimensions || [])
    .map((d) => `${d.kind}|${Math.round(d.measurementValue)}|${Math.round(d.p1.x)},${Math.round(d.p1.y)}|${Math.round(d.p2.x)},${Math.round(d.p2.y)}`));
  await ensureVisible(page, [
    { x: s01.origin.x, y: s01.origin.y }, { x: s01.origin.x + 4000, y: s01.origin.y + 3000 },
  ], { zoom: 0.14 });
  const dimsBefore = await dimKeys();
  const beforeSel = dimsBefore.length;
  await selectWall(top);
  const dimsSelected = await dimKeys();
  check("DIM.selection_adds_none", dimsSelected.length === beforeSel,
    `selecting a wall adds zero dimension records (${beforeSel} -> ${dimsSelected.length})`);

  for (let i = 0; i < 4; i++) {
    await dragWallCentre(top, { x: 0, y: i % 2 === 0 ? -150 : 150 });
  }
  const dimsAfter = await dimKeys();
  const dupAfter = dimsAfter.filter((k, i) => dimsAfter.indexOf(k) !== i);
  check("DIM.no_duplicates_after_movement", dupAfter.length === 0,
    `repeated movement produced no duplicate dimension records (${dupAfter.length})`);
  check("DIM.no_accumulation", dimsAfter.length <= beforeSel + 2,
    `dimension count did not accumulate (${beforeSel} -> ${dimsAfter.length})`);
  const blank = await page.evaluate(() => (window.__dgPlanner.runtimeDimensions || [])
    .filter((d) => !d.labelOverride && !(d.measurementValue > 0)).length);
  check("DIM.no_blank_labels", blank === 0, `no blank dimension labels (${blank})`);
  await shot("dims-after-repeated-move.png");

  // ================================================== persistence gate (§10)
  for (let i = 0; i < 30; i++) {
    const api = await apiPlan();
    if ((api.walls || []).length) break;
    await page.waitForTimeout(400);
  }
  const apiBefore = await apiPlan();
  const fingerprint = (plan) => JSON.stringify({
    walls: (plan.walls || []).map((w) => `${w.id}|${w.chainId}|${w.a}|${w.b}`).sort(),
    nodes: Object.entries(plan.nodes || {})
      .map(([id, p]) => `${id}|${Math.round(p.x)}|${Math.round(p.y)}`).sort(),
  });
  const fpBefore = fingerprint(apiBefore);

  for (const pass of [1, 2]) {
    const writesBefore = writes.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.resolvedWalls?.length,
      null, { timeout: 45000 });
    await page.waitForTimeout(3500);
    const planAfter = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
    const repair = repairLegacyTopology(planAfter, { makeId: (p) => `${p}_probe` });
    check(`F5.${pass}.zero_repairs`, repair.repairs.length === 0,
      `reload ${pass}: hydration performed zero legacy repairs (${repair.repairs.length})`);
    check(`F5.${pass}.zero_writes`, writes.length - writesBefore === 0,
      `reload ${pass}: zero hydration writes (${writes.length - writesBefore})`);
    check(`F5.${pass}.identical`, fingerprint(await apiPlan()) === fpBefore,
      `reload ${pass}: topology fingerprint unchanged`);
  }

  const finalTopology = await readTopology(page);
  const report = {
    generatedAt: new Date().toISOString(),
    projectId: PROJECT,
    planUrl: `${ENV.BASE}/project/${PROJECT}/plan`,
    totals: {
      walls: finalTopology.walls.length,
      nodes: finalTopology.nodes.length,
      rooms: finalTopology.roomCount,
      zones: finalTopology.zoneCount,
    },
    findings,
    failures,
  };
  fs.writeFileSync(path.join(OUT, "acceptance.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`\nreport: ${path.join(OUT, "acceptance.json")}`);
  console.log(failures ? `RESULT: ${failures} FAILING CHECK(S)` : "RESULT: PASS");
  await browser.close();
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
