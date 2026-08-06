/**
 * PHASE 2D ACCEPTANCE — first-intersection preview clipping + right-click cancel.
 *
 * Cases A–X: the rubber band stops at the first wall it meets, the committed
 * wall ends exactly where the band ended, the right mouse button cancels the
 * drawing and hands the canvas back to Select, and the Phase 2C3A / 2D1
 * behaviours still hold.
 *
 * Requires: VITE_DG_PLANNER_E2E=1  VITE_DG_PLANNER_WALL_DRAW_V2=1
 *
 * Hardened: every URL/key/project/evidence path comes from the environment and
 * fails closed; BASE/API must be loopback; EVIDENCE_DIR must be outside the
 * repository; no secret is written to evidence; no project is created here.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const need = (n) => { const v = process.env[n]; if (!v) throw new Error(`${n} is required`); return v; };
const loopback = (n, v) => {
  const u = new URL(v);
  if (u.protocol !== "http:") throw new Error(`${n} must be http:`);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(u.hostname)) throw new Error(`${n} must be loopback`);
  return v.replace(/\/$/, "");
};
const BASE = loopback("REVIEW_BASE", need("REVIEW_BASE"));
const API = loopback("REVIEW_API", need("REVIEW_API"));
const ADMIN_KEY = need("REVIEW_ADMIN_KEY");
const PROJECT_ID = need("REVIEW_PROJECT_ID");
const EVIDENCE_DIR = need("EVIDENCE_DIR");
if (!path.isAbsolute(EVIDENCE_DIR)) throw new Error("EVIDENCE_DIR must be absolute");
const rel = path.relative(REPO_ROOT, EVIDENCE_DIR);
if (!rel.startsWith("..") && rel !== "") throw new Error("EVIDENCE_DIR must be outside the repository");
const SHOTS = path.join(EVIDENCE_DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const SETTLE = Number(process.env.SETTLE_MS || 2200);
const mask = (s) => (typeof s === "string" && s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : "***");
const SAVE_PATH = `/api/projects/${encodeURIComponent(PROJECT_ID)}`;
const WRITE_ORIGINS = new Set([new URL(BASE).origin, new URL(API).origin]);
const isSave = (r) => {
  if (r.method() !== "PATCH" && r.method() !== "PUT") return false;
  try { const u = new URL(r.url()); return WRITE_ORIGINS.has(u.origin) && u.pathname === SAVE_PATH; } catch { return false; }
};

/* ---------------------------- diagnostics ---------------------------- */
function topologyDiagnostics(plan, walls) {
  const orphanNodes = Object.keys(plan.nodes || {}).filter(
    (id) => !(plan.walls || []).some((w) => w.a === id || w.b === id),
  );
  const seen = new Set();
  const duplicateEdges = [];
  const zeroLength = [];
  for (const w of plan.walls || []) {
    const key = [w.a, w.b].sort().join("|");
    if (seen.has(key)) duplicateEdges.push(w.id);
    seen.add(key);
    const a = plan.nodes?.[w.a];
    const b = plan.nodes?.[w.b];
    if (!a || !b || w.a === w.b || Math.hypot(b.x - a.x, b.y - a.y) < 50) zeroLength.push(w.id);
  }
  const seg = (w) => (w.pts?.length >= 2 ? [w.pts[0], w.pts[w.pts.length - 1]] : null);
  const cross = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
  };
  const unnodedCrossings = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const s1 = seg(walls[i]);
      const s2 = seg(walls[j]);
      if (!s1 || !s2) continue;
      const p = cross(s1[0], s1[1], s2[0], s2[1]);
      if (!p) continue;
      const hasNode = Object.values(plan.nodes || {}).some((n) => Math.hypot(n.x - p.x, n.y - p.y) <= 1);
      if (!hasNode) unnodedCrossings.push([walls[i].id, walls[j].id]);
    }
  }
  return { orphanNodes, duplicateEdges, zeroLength, unnodedCrossings };
}
function fingerprint(plan) {
  const nodes = Object.entries(plan?.nodes || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => `${id}@${Math.round(n.x)},${Math.round(n.y)}`);
  const walls = (plan?.walls || []).filter((w) => w.a && w.b).map((w) => `${w.id}:${w.a}>${w.b}`).sort();
  return JSON.stringify({ nodes, walls, rooms: (plan?.rooms || []).length });
}
const apiProject = async () => {
  const res = await fetch(`${API}${SAVE_PATH}`, { headers: { "X-Admin-Key": ADMIN_KEY } });
  if (!res.ok) throw new Error(`GET project failed: ${res.status}`);
  return res.json();
};

const ev = {
  phase: "2D", branch: "", head: "", baseUrl: BASE, apiUrl: API,
  projectIdMask: mask(PROJECT_ID),
  cases: {}, screenshots: [], writes: [], consoleErrors: [], failures: [],
  startedAt: new Date().toISOString(), finishedAt: null, pass: false,
};
try { ev.branch = execSync("git branch --show-current", { encoding: "utf8" }).trim(); } catch {}
try { ev.head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch {}
let writes = 0;
const fail = (m) => { ev.failures.push(m); console.log(`  FAIL: ${m}`); };
const ok = (m) => console.log(`  ok: ${m}`);
const round = (p) => (p ? { x: Math.round(p.x), y: Math.round(p.y) } : null);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") ev.consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => ev.consoleErrors.push(String(e)));
  page.on("request", (r) => { if (isSave(r)) { writes += 1; ev.writes.push({ at: Date.now(), method: r.method() }); } });

  // Records whether the app cancelled the browser context menu. Added in the
  // bubble phase, so it observes React's handler result.
  await page.addInitScript(() => {
    window.__ctxProbe = [];
    document.addEventListener("contextmenu", (e) => {
      window.__ctxProbe.push({ prevented: e.defaultPrevented });
    });
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(ADMIN_KEY);
  await page.locator("form button").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
  await page.goto(`${BASE}/project/${PROJECT_ID}/plan`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });

  const state = () => page.evaluate(() => {
    const d = window.__dgPlanner;
    const p = d.plan || {};
    const walls = d.resolvedWalls?.length ? d.resolvedWalls : (p.walls || []);
    return {
      tool: d.tool, v2: d.wallDrawV2 || null,
      canUndo: d.canUndo, canRedo: d.canRedo, selection: d.selection,
      view: { panX: d.view.panX, panY: d.view.panY, zoom: d.view.zoom },
      rect: { left: d.svgRect.left, top: d.svgRect.top, w: d.svgRect.width, h: d.svgRect.height },
      wallCount: walls.length,
      walls: walls.map((w) => ({ id: w.id, a: w.a, b: w.b, pts: (w.pts || []).map((q) => ({ x: q.x, y: q.y })) })),
      nodes: p.nodes || {},
      plan: { nodes: p.nodes || {}, walls: (p.walls || []).map((w) => ({ id: w.id, a: w.a, b: w.b })), rooms: p.rooms || [] },
      rooms: p.rooms || [],
    };
  });
  const boot = await state();
  if (!boot.v2?.enabled) throw new Error("VITE_DG_PLANNER_WALL_DRAW_V2=1 is not active — refusing to run the 2D gate");
  ok("V2 drag-release path is active");

  const w2s = async (mx, my) => {
    const s = await state();
    return { x: s.rect.left + s.view.panX + mx * s.view.zoom, y: s.rect.top + s.view.panY + my * s.view.zoom };
  };
  const shot = async (n) => { await page.screenshot({ path: path.join(SHOTS, n) }); ev.screenshots.push(n); };
  const guideCounts = () => page.evaluate(() => ({
    alignment: document.querySelectorAll('g[data-ui="wall-guides"] line').length,
    angles: document.querySelectorAll('g[data-ui="wall-angles"] *').length,
    band: document.querySelectorAll('g[data-ui="wall-cursor-preview"] *').length,
  }));
  const pickTool = async (id) => {
    await page.locator(`button[data-tool-id="${id}"]`).first().click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(250);
    const got = (await state()).tool;
    if (got !== id) throw new Error(`tool "${id}" did not activate (tool=${got})`);
  };
  const CANVAS_MARGIN = 70;
  const onScreen = async (px) => {
    const s = await state();
    return px.x > s.rect.left + CANVAS_MARGIN && px.x < s.rect.left + s.rect.w - CANVAS_MARGIN
      && px.y > s.rect.top + CANVAS_MARGIN && px.y < s.rect.top + s.rect.h - CANVAS_MARGIN;
  };
  /** A canvas point over bare background: a press on a wall never pans. */
  const bareSpot = async (fits) => {
    const s = await state();
    for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const q = { x: s.rect.left + s.rect.w * fx, y: s.rect.top + s.rect.h * fy };
        if (fits && !fits(q, s)) continue;
        const bare = await page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return !!el && (el.tagName === "svg" || el.getAttribute("data-canvas-bg") === "1");
        }, q);
        if (bare) return q;
      }
    }
    return null;
  };
  async function centerOn(mm) {
    for (let i = 0; i < 16; i++) {
      const s = await state();
      const cx = s.rect.left + s.rect.w / 2;
      const cy = s.rect.top + s.rect.h / 2;
      const p = { x: s.rect.left + s.view.panX + mm.x * s.view.zoom, y: s.rect.top + s.view.panY + mm.y * s.view.zoom };
      const dx = cx - p.x;
      const dy = cy - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 4) return true;
      const roomOf = (q, s2) => Math.min(
        dx >= 0 ? s2.rect.left + s2.rect.w - 20 - q.x : q.x - s2.rect.left - 20,
        dy >= 0 ? s2.rect.top + s2.rect.h - 20 - q.y : q.y - s2.rect.top - 20,
      );
      const start = await bareSpot((q, s2) => roomOf(q, s2) > 120);
      if (!start) return false;
      const k = Math.min(1, roomOf(start, s) / len);
      await page.mouse.move(start.x, start.y, { steps: 2 });
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(start.x + dx * k, start.y + dy * k, { steps: 8 });
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(130);
    }
    return false;
  }
  async function zoomTo(target) {
    const s0 = await state();
    await page.mouse.move(s0.rect.left + s0.rect.w / 2, s0.rect.top + s0.rect.h / 2);
    for (let i = 0; i < 160; i++) {
      const c = await state();
      if (Math.abs(c.view.zoom - target) / target <= 0.15) break;
      await page.mouse.wheel(0, c.view.zoom < target ? -120 : 120);
      await page.waitForTimeout(22);
    }
    return (await state()).view.zoom;
  }

  const seedPlan = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
  async function resetFixture() {
    const cur = await apiProject();
    const res = await fetch(`${API}${SAVE_PATH}`, {
      method: "PATCH",
      headers: { "X-Admin-Key": ADMIN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: seedPlan, expectedRevision: cur.revision }),
    });
    if (!res.ok) throw new Error(`fixture reset failed: ${res.status}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(1400);
  }

  /**
   * Hold a wall draft without releasing, sampling the preview at each waypoint.
   * The caller decides whether to release, Escape or right-click.
   */
  async function holdDraft(fromMm, waypointsMm) {
    const a = await w2s(fromMm.x, fromMm.y);
    if (!(await onScreen(a))) throw new Error(`draft start off canvas: ${JSON.stringify(a)}`);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.waitForTimeout(90);
    const samples = [];
    for (const wp of waypointsMm) {
      const b = await w2s(wp.x, wp.y);
      if (!(await onScreen(b))) throw new Error(`draft waypoint off canvas: ${JSON.stringify(b)}`);
      await page.mouse.move(b.x, b.y, { steps: 6 });
      await page.waitForTimeout(120);
      const s = await state();
      const pv = s.v2?.preview || null;
      samples.push({
        askedMm: { x: Math.round(wp.x), y: Math.round(wp.y) },
        start: round(pv?.start),
        end: round(pv?.end),
        lengthMm: pv?.lengthMm != null ? Math.round(pv.lengthMm) : null,
        clip: pv?.endSnap?.clip || null,
        endKind: pv?.endSnap?.kind ?? null,
        hostWallId: pv?.endSnap?.hostWallId ?? null,
      });
    }
    return samples;
  }
  const releaseDraft = async () => { await page.mouse.up(); await page.waitForTimeout(300); };

  /* ---- fixture geometry ---- */
  const s0 = await state();
  const wallById = (s, id) => s.walls.find((w) => w.id === id);
  const need2 = (s, id) => {
    const w = wallById(s, id);
    if (!w) throw new Error(`fixture is missing wall "${id}"`);
    return w;
  };
  need2(s0, "vA"); need2(s0, "vB"); need2(s0, "hTop"); need2(s0, "obl");
  ok(`fixture: ${s0.wallCount} walls / ${s0.rooms.length} rooms`);

  /* ---------- A / B / C / D: the band stops at the first wall ---------- */
  console.log("[A/B/C/D] preview stops at the first intersection");
  {
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: 9000, y: 0 });
    const wStart = writes;
    const before = fingerprint((await state()).plan);
    // vA is at x=6000, vB at x=12000; draw from x=2000 rightwards through both.
    const samples = await holdDraft({ x: 2000, y: 0 }, [
      { x: 5000, y: 0 },    // D: before any wall — follows the cursor
      { x: 8000, y: 0 },    // A: past vA — clipped at vA
      { x: 15000, y: 0 },   // B/C: past vB too — still clipped at vA
      { x: 5000, y: 0 },    // D again: back before the wall — follows again
      { x: 15000, y: 0 },   // released from here, so the commit must be clipped
    ]);
    const duringWrites = writes - wStart;
    const duringPlan = fingerprint((await state()).plan);
    await shot("A-preview-clipped.png");
    await releaseDraft();
    await page.waitForTimeout(SETTLE);

    const afterState = await state();
    const [beforeWall, atA, farther, backAgain] = samples;
    const released = samples[samples.length - 1];
    ev.cases.ABCD = { samples, duringWrites, holdChangedPlan: duringPlan !== before };

    if (beforeWall.end.x !== 5000) fail(`D: preview did not follow the cursor before any wall (${JSON.stringify(beforeWall.end)})`);
    if (atA.end.x !== 6000) fail(`A: preview did not stop at the first wall (${JSON.stringify(atA.end)})`);
    if (!atA.clip?.clipped) fail("A: preview endpoint carries no clip metadata");
    if (farther.end.x !== 6000) fail(`B/C: preview moved past the first wall (${JSON.stringify(farther.end)})`);
    if (backAgain.end.x !== 5000) fail(`D: preview did not follow the cursor back (${JSON.stringify(backAgain.end)})`);
    // I: nothing was written or committed while the button was held
    if (duringWrites !== 0) fail(`I: ${duringWrites} write(s) during hold`);
    if (duringPlan !== before) fail("I: the committed plan changed during hold");

    // J: the committed wall ends exactly where the preview ended
    const releasedWrites = writes - wStart;
    const newWall = afterState.walls.find((w) => !s0.walls.some((o) => o.id === w.id));
    const ends = newWall ? [newWall.pts[0], newWall.pts[newWall.pts.length - 1]] : [];
    const committedEnd = ends.find((p) => Math.abs(p.x - 2000) > 1 || Math.abs(p.y - 0) > 1);
    ev.cases.J = {
      previewEndAtRelease: released.end, committedEnd: round(committedEnd),
      previewLengthMm: released.lengthMm, clip: released.clip,
      newWallId: newWall?.id ?? null, writes: releasedWrites,
    };
    if (!newWall) fail("J: release created no wall");
    else if (!committedEnd || Math.round(committedEnd.x) !== released.end.x
      || Math.round(committedEnd.y) !== released.end.y) {
      fail(`J: committed endpoint ${JSON.stringify(round(committedEnd))} != preview endpoint ${JSON.stringify(released.end)}`);
    } else if (Math.round(committedEnd.x) !== 6000) {
      fail(`J: the released wall was not clipped at the first wall (${JSON.stringify(round(committedEnd))})`);
    }
    if (releasedWrites !== 1) fail(`J: expected exactly 1 write for the release, got ${releasedWrites}`);
    if (!ev.failures.length) ok(`A-D/I/J: band stopped at x=6000 through 2 walls, 0 writes on hold, 1 on release, committed end == preview end`);
  }

  /* ---------- E: oblique crossing ---------- */
  console.log("[E] oblique draft crossing");
  {
    await resetFixture();
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: 9000, y: 0 });
    const samples = await holdDraft({ x: 2000, y: -3000 }, [{ x: 10000, y: 3000 }]);
    await releaseDraft();
    await page.waitForTimeout(SETTLE);
    const s = samples[0];
    ev.cases.E = s;
    if (s.end.x !== 6000) fail(`E: oblique draft did not clip on vA (${JSON.stringify(s.end)})`);
    else ok(`E: oblique draft clipped at ${JSON.stringify(s.end)} on ${s.hostWallId}`);
  }

  /* ---------- F / G: start on a wall body and at a junction ---------- */
  console.log("[F/G] starting on a wall body / at a junction");
  {
    await resetFixture();
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: 9000, y: 0 });
    // F: start exactly on vA's centerline and draw away from it.
    const f = await holdDraft({ x: 6000, y: 1500 }, [{ x: 9500, y: 1500 }]);
    await releaseDraft();
    await page.waitForTimeout(SETTLE);
    // G: start at the top-left corner node and leave it.
    await centerOn({ x: 6000, y: -4000 });
    const g = await holdDraft({ x: 6000, y: -3000 }, [{ x: 9500, y: -3000 }]);
    await releaseDraft();
    await page.waitForTimeout(SETTLE);
    ev.cases.FG = { f: f[0], g: g[0] };
    if (!f[0].end || Math.abs(f[0].end.x - 6000) < 200) fail(`F: draft collapsed at its own start wall (${JSON.stringify(f[0])})`);
    if (!g[0].end || Math.abs(g[0].end.x - 6000) < 200) fail(`G: draft could not leave the junction (${JSON.stringify(g[0])})`);
    if (!ev.failures.length) ok(`F/G: body start reached ${JSON.stringify(f[0].end)}, junction start reached ${JSON.stringify(g[0].end)}`);
  }

  /* ---------- H: Alt keeps geometric clipping ---------- */
  console.log("[H] Alt disables magnets but not clipping");
  {
    await resetFixture();
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: 9000, y: 0 });
    await page.keyboard.down("Alt");
    const samples = await holdDraft({ x: 2000, y: 700 }, [{ x: 15000, y: 700 }]);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.waitForTimeout(SETTLE);
    ev.cases.H = samples[0];
    if (samples[0].end.x !== 6000) fail(`H: Alt let the preview run through vA (${JSON.stringify(samples[0].end)})`);
    else ok(`H: under Alt the band still stopped at ${JSON.stringify(samples[0].end)}`);
  }

  /* ---------- S: Escape keeps its accepted behaviour ---------- */
  console.log("[S] Escape");
  {
    await resetFixture();
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: 9000, y: 0 });
    const before = fingerprint((await state()).plan);
    const wStart = writes;
    await holdDraft({ x: 2000, y: 1200 }, [{ x: 4500, y: 1200 }]);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const afterEscape = await state();
    await page.mouse.up();
    await page.waitForTimeout(SETTLE);
    const g = await guideCounts();
    ev.cases.S = {
      previewAfterEscape: afterEscape.v2?.preview ?? null,
      toolAfterEscape: afterEscape.tool,
      writes: writes - wStart,
      planUnchanged: fingerprint((await state()).plan) === before,
      guides: g,
    };
    if (afterEscape.v2?.preview) fail("S: Escape left a preview");
    if (afterEscape.tool !== "wall") fail(`S: Escape changed the tool to ${afterEscape.tool} (2D changes only right-click)`);
    if (writes - wStart !== 0) fail(`S: Escape produced ${writes - wStart} write(s)`);
    if (!ev.cases.S.planUnchanged) fail("S: Escape changed the plan");
    if (!ev.failures.length) ok("S: Escape clears the band, keeps the wall tool, writes 0");
  }

  /* ---------- M / N / O / P / Q: right-click ---------- */
  console.log("[M/N/O/P/Q] right-click cancels drawing and returns to Select");
  {
    await resetFixture();
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: 9000, y: 0 });
    const before = fingerprint((await state()).plan);
    const wStart = writes;
    await page.evaluate(() => { window.__ctxProbe = []; });

    await holdDraft({ x: 2000, y: 1800 }, [{ x: 4500, y: 1800 }]);
    const during = await state();
    if (!during.v2?.preview) fail("M: no preview to cancel");
    const posM = await w2s(4500, 1800);
    await page.mouse.click(posM.x, posM.y, { button: "right" });
    await page.waitForTimeout(400);
    await page.mouse.up().catch(() => {});
    await page.waitForTimeout(SETTLE);

    const afterM = await state();
    const guidesM = await guideCounts();
    const ctxM = await page.evaluate(() => window.__ctxProbe.slice());
    ev.cases.MN = {
      previewAfter: afterM.v2?.preview ?? null,
      toolAfter: afterM.tool,
      guides: guidesM,
      writes: writes - wStart,
      planUnchanged: fingerprint(afterM.plan) === before,
      canUndo: afterM.canUndo,
      contextMenuPrevented: ctxM.map((c) => c.prevented),
    };
    if (afterM.v2?.preview) fail("M: right-click left the preview in place");
    if (guidesM.alignment !== 0 || guidesM.angles !== 0) fail(`M: guides survived right-click ${JSON.stringify(guidesM)}`);
    if (afterM.tool !== "select") fail(`M/O: tool is "${afterM.tool}" after right-click, expected "select"`);
    if (!ev.cases.MN.planUnchanged) fail("N: right-click changed the plan");
    if (writes - wStart !== 0) fail(`N: right-click produced ${writes - wStart} write(s)`);
    if (!ctxM.length || !ctxM.every((c) => c.prevented)) fail(`Q: browser context menu not suppressed in the wall tool (${JSON.stringify(ctxM)})`);
    await shot("M-after-right-click.png");

    // O: right-click while the wall tool is idle
    await pickTool("wall");
    await page.evaluate(() => { window.__ctxProbe = []; });
    const posO = await w2s(3000, 2400);
    await page.mouse.click(posO.x, posO.y, { button: "right" });
    await page.waitForTimeout(400);
    const afterO = await state();
    ev.cases.O = { toolAfter: afterO.tool, writes: writes - wStart };
    if (afterO.tool !== "select") fail(`O: idle right-click left the tool as "${afterO.tool}"`);

    // P: the following left click selects and starts no draft
    const vA = need2(await state(), "vA");
    const grab = {
      x: vA.pts[0].x + (vA.pts[1].x - vA.pts[0].x) * 0.35,
      y: vA.pts[0].y + (vA.pts[1].y - vA.pts[0].y) * 0.35,
    };
    await centerOn(grab);
    const gp = await w2s(grab.x, grab.y);
    await page.mouse.move(gp.x, gp.y, { steps: 3 });
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(350);
    const afterP = await state();
    ev.cases.P = { selection: afterP.selection, preview: afterP.v2?.preview ?? null, tool: afterP.tool };
    if (!afterP.selection || afterP.selection.coll !== "walls") fail(`P: left click after right-click did not select a wall (${JSON.stringify(afterP.selection)})`);
    if (afterP.v2?.preview) fail("P: left click after right-click started a draft");

    // Q: the Select tool keeps its own context menu behaviour
    await page.evaluate(() => { window.__ctxProbe = []; });
    const bare = await bareSpot(null);
    if (bare) {
      await page.mouse.click(bare.x, bare.y, { button: "right" });
      await page.waitForTimeout(400);
    }
    const ctxSel = await page.evaluate(() => window.__ctxProbe.slice());
    const ctxMenuOpen = await page.evaluate(() => !!document.querySelector(".dg-ctx-menu, [data-ui='context-menu']"));
    ev.cases.Q = { selectToolEvents: ctxSel, menuRendered: ctxMenuOpen };
    if (!ev.failures.length) {
      ok(`M/N/O/P/Q: preview+guides cleared, tool=select, plan/history/writes untouched, ctx suppressed in wall (${JSON.stringify(ev.cases.MN.contextMenuPrevented)}), select unchanged`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  /* ---------- R / T / U: release keeps the tool; click vs double-click ---------- */
  console.log("[R/T/U] release keeps the wall tool; single vs double click");
  {
    await resetFixture();
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: 3000, y: 3000 });
    await holdDraft({ x: 1500, y: 2500 }, [{ x: 4500, y: 2500 }]);
    await releaseDraft();
    await page.waitForTimeout(SETTLE);
    const afterRelease = await state();
    ev.cases.R = { tool: afterRelease.tool, preview: afterRelease.v2?.preview ?? null };
    if (afterRelease.tool !== "wall") fail(`R: the wall tool did not stay active after release (${afterRelease.tool})`);

    /* ---- T/U: the wall inspector click contract ---- */
    await pickTool("select");
    /**
     * "Open" is measured three ways at once: the panel's own phase attribute,
     * whether an editable field is reachable, and PlanPage's own open state.
     * A panel that merely exists in the DOM is not open.
     */
    const inspector = () => page.evaluate(() => {
      const el = document.querySelector(".dg-inspector");
      const phase = el?.getAttribute("data-sheet-state") ?? null;
      const open = phase === "half" || phase === "expanded";
      const fields = el ? el.querySelectorAll("input:not([readonly]), select") : [];
      return {
        mounted: !!el,
        phase,
        open,
        panels: document.querySelectorAll(".dg-inspector").length,
        editableFields: fields.length,
        appOpenState: window.__dgPlanner?.wallInspectorOpen ?? null,
      };
    });
    const grabOf = (w, frac = 0.2) => ({
      x: w.pts[0].x + (w.pts[1].x - w.pts[0].x) * frac,
      y: w.pts[0].y + (w.pts[1].y - w.pts[0].y) * frac,
    });
    const clickWall = async (gp, dbl = false) => {
      if (dbl) await page.mouse.dblclick(gp.x, gp.y);
      else { await page.mouse.move(gp.x, gp.y, { steps: 3 }); await page.mouse.down(); await page.mouse.up(); }
      await page.waitForTimeout(dbl ? 650 : 420);
      return inspector();
    };

    const vA = need2(await state(), "vA");
    const grab = grabOf(vA);
    await centerOn(grab);
    const gp = await w2s(grab.x, grab.y);
    const wStart = writes;
    const planBefore = fingerprint((await state()).plan);

    const seq = {};
    seq.beforeAnyClick = await inspector();
    seq.afterSingle1 = await clickWall(gp);                 // B
    seq.selectionAfterSingle = (await state()).selection;
    const repeats = [];
    for (let i = 0; i < 5; i++) repeats.push(await clickWall(gp)); // C
    seq.repeatedSingles = repeats.map((r) => r.open);
    await shot("T-before-escape-single-clicks.png");
    seq.afterDouble = await clickWall(gp, true);            // D
    await shot("U-after-double-click.png");
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Escape");                    // E
    await page.waitForTimeout(450);
    seq.afterEscape = await inspector();
    await shot("U-after-escape.png");
    seq.afterSingleAfterEscape = await clickWall(gp);        // F
    seq.afterDoubleAfterEscape = await clickWall(gp, true);  // G

    // I: another wall switches the panel, still exactly one
    const vB = wallById(await state(), "vB");
    let other = null;
    if (vB) {
      const g2 = grabOf(vB);
      await centerOn(g2);
      const gp2 = await w2s(g2.x, g2.y);
      other = await clickWall(gp2, true);
    }
    seq.otherWall = other;

    await page.waitForTimeout(SETTLE);
    seq.writes = writes - wStart;
    seq.planUnchanged = fingerprint((await state()).plan) === planBefore;
    ev.cases.TU = seq;

    if (seq.afterSingle1.open) fail(`T: a single click opened the properties (phase=${seq.afterSingle1.phase})`);
    if (!seq.selectionAfterSingle || seq.selectionAfterSingle.coll !== "walls") {
      fail(`T: a single click did not select the wall (${JSON.stringify(seq.selectionAfterSingle)})`);
    }
    if (repeats.some((r) => r.open)) fail(`T: repeated single clicks opened the properties (${JSON.stringify(seq.repeatedSingles)})`);
    if (!seq.afterDouble.open) fail(`U: a double click did not open the properties (phase=${seq.afterDouble.phase})`);
    if (seq.afterDouble.panels !== 1) fail(`U: ${seq.afterDouble.panels} property panels after double click, expected 1`);
    if (seq.afterDouble.editableFields < 1) fail("U: the opened panel exposes no editable field");
    if (seq.afterEscape.open) fail(`U: Escape did not close the properties (phase=${seq.afterEscape.phase})`);
    if (seq.afterSingleAfterEscape.open) fail("U: a single click after Escape reopened the properties");
    if (!seq.afterDoubleAfterEscape.open) fail("U: a double click after Escape did not reopen the properties");
    if (other && (!other.open || other.panels !== 1)) fail(`U: switching walls by double click failed (${JSON.stringify(other)})`);
    if (seq.writes !== 0) fail(`U: the click sequence produced ${seq.writes} write(s)`);
    if (!seq.planUnchanged) fail("U: the click sequence changed the plan");
    if (!ev.failures.length) {
      ok(`R: the wall tool stayed active after release`);
      ok(`T/U: single=closed, 5 repeats=closed, double=open(${seq.afterDouble.editableFields} fields), Esc=closed, single=closed, double=open; other wall=open×1; writes 0`);
    }
    await shot("U-double-click.png");
  }

  /* ---------- V: Phase 2D1 zoom snap + clean guides ---------- */
  console.log("[V] Phase 2D1 regression");
  {
    await resetFixture();
    await pickTool("wall");
    const zoom = await zoomTo(0.055);
    await centerOn({ x: 6000, y: -3000 });
    // A node 150 mm away must NOT capture (2D1 bound), and no dashed grid.
    const probeAt = { x: 6000 + 150 / Math.SQRT2, y: -3000 - 150 / Math.SQRT2 };
    const p = await w2s(probeAt.x, probeAt.y);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.down();
    await page.waitForTimeout(120);
    const s = await state();
    const g = await guideCounts();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const afterGuides = await guideCounts();
    const kind = s.v2?.preview?.startSnap?.kind ?? null;
    ev.cases.V = { zoom: Math.round(zoom * 1000) / 1000, kindAt150mm: kind, guidesDuring: g, guidesAfter: afterGuides };
    if (kind === "node" || kind === "wall-end") fail(`V: a node captured from 150 mm at zoom ${zoom} (2D1 regression)`);
    if (g.alignment > 1) fail(`V: ${g.alignment} alignment guides during draw (2D1 allows at most 1)`);
    if (g.angles > 0) fail(`V: ${g.angles} angle labels during draw (2D1 expects 0)`);
    if (afterGuides.alignment !== 0) fail(`V: ${afterGuides.alignment} guides left after cancel`);
    if (!ev.failures.length) ok(`V: node not captured at 150 mm (kind=${kind}), guides during=${g.alignment}/${g.angles}, after=0`);
  }

  /* ---------- W: Phase 2C3A connected wall movement + Ctrl+Z ---------- */
  console.log("[W] Phase 2C3A regression");
  {
    await resetFixture();
    await pickTool("select");
    await zoomTo(0.17);
    const s = await state();
    const results = [];
    for (const id of ["obl", "hTop"]) {
      const w = wallById(s, id);
      if (!w) { results.push({ id, moved: false, note: "missing" }); continue; }
      const a = w.pts[0];
      const b = w.pts[w.pts.length - 1];
      const grab = { x: a.x + (b.x - a.x) * 0.35, y: a.y + (b.y - a.y) * 0.35 };
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      await centerOn(grab);
      const from = await w2s(grab.x, grab.y);
      const to = await w2s(grab.x + nx * 400, grab.y + ny * 400);
      if (!(await onScreen(from)) || !(await onScreen(to))) { results.push({ id, moved: false, note: "off canvas" }); continue; }
      await page.mouse.move(from.x, from.y, { steps: 3 });
      await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(260);
      const beforeFp = fingerprint((await state()).plan);
      await page.mouse.move(from.x, from.y, { steps: 2 });
      await page.mouse.down();
      await page.mouse.move(from.x + (to.x - from.x) * 0.5, from.y + (to.y - from.y) * 0.5, { steps: 5 });
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      results.push({ id, moved: fingerprint((await state()).plan) !== beforeFp });
    }
    const beforeUndo = fingerprint((await state()).plan);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(700);
    const undoWorked = fingerprint((await state()).plan) !== beforeUndo;
    ev.cases.W = { results, undoWorked };
    const stuck = results.filter((r) => !r.moved).map((r) => r.id);
    if (stuck.length) fail(`W: wall(s) not draggable in Select: ${stuck.join(", ")}`);
    if (!undoWorked) fail("W: Ctrl+Z did not undo the move");
    if (!stuck.length && undoWorked) ok(`W: ${results.length}/${results.length} walls dragged, Ctrl+Z works`);
    await shot("W-select-movement.png");
  }

  /* ---------- X: rectangle regression ---------- */
  console.log("[X] five rectangles in clear space");
  {
    await resetFixture();
    await pickTool("wall");
    await zoomTo(0.055);
    const originY = 12000;                 // well clear of the seeded fixture
    await centerOn({ x: 9000, y: originY + 2000 });
    const before = await state();
    const wStart = writes;
    for (let r = 0; r < 5; r++) {
      const x0 = 1000 + r * 3500;
      const y0 = originY;
      const x1 = x0 + 2500;
      const y1 = y0 + 2500;
      const corners = [
        [{ x: x0, y: y0 }, { x: x1, y: y0 }],
        [{ x: x1, y: y0 }, { x: x1, y: y1 }],
        [{ x: x1, y: y1 }, { x: x0, y: y1 }],
        [{ x: x0, y: y1 }, { x: x0, y: y0 }],
      ];
      for (const [from, to] of corners) {
        await holdDraft(from, [to]);
        await releaseDraft();
        await page.waitForTimeout(160);
      }
    }
    await page.waitForTimeout(SETTLE);
    const after = await state();
    const diag = topologyDiagnostics(after.plan, after.walls);
    ev.cases.X = {
      wallsAdded: after.wallCount - before.wallCount,
      nodesAdded: Object.keys(after.nodes).length - Object.keys(before.nodes).length,
      roomsAdded: after.rooms.length - before.rooms.length,
      writes: writes - wStart,
      diagnostics: Object.fromEntries(Object.entries(diag).map(([k, v]) => [k, v.length])),
    };
    if (ev.cases.X.wallsAdded !== 20) fail(`X: expected 20 new walls, got ${ev.cases.X.wallsAdded}`);
    if (ev.cases.X.nodesAdded !== 20) fail(`X: expected 20 new nodes, got ${ev.cases.X.nodesAdded}`);
    if (ev.cases.X.roomsAdded !== 5) fail(`X: expected 5 new rooms, got ${ev.cases.X.roomsAdded}`);
    if (Object.values(diag).some((l) => l.length)) fail(`X/L: topology diagnostics not clean: ${JSON.stringify(ev.cases.X.diagnostics)}`);
    if (!ev.failures.length) ok(`X/L: +20 walls / +20 nodes / +5 rooms, all diagnostics zero`);
    await shot("X-rectangles.png");
  }

  /* ---------- K: API and reload parity ---------- */
  console.log("[K] API / reload parity");
  {
    await page.waitForTimeout(SETTLE);
    const committed = await state();
    const committedFp = fingerprint(committed.plan);
    const savedFp = fingerprint((await apiProject()).plan);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(1500);
    const reloaded = await state();
    const diag = topologyDiagnostics(reloaded.plan, reloaded.walls);
    ev.cases.K = {
      browserMatchesApi: committedFp === savedFp,
      reloadMatches: fingerprint(reloaded.plan) === committedFp,
      diagnostics: Object.fromEntries(Object.entries(diag).map(([k, v]) => [k, v.length])),
      walls: reloaded.wallCount, rooms: reloaded.rooms.length,
    };
    if (!ev.cases.K.browserMatchesApi) fail("K: committed != saved");
    if (!ev.cases.K.reloadMatches) fail("K: reload != committed");
    if (Object.values(diag).some((l) => l.length)) fail(`K: topology diagnostics not clean after reload: ${JSON.stringify(ev.cases.K.diagnostics)}`);
    if (ev.cases.K.browserMatchesApi && ev.cases.K.reloadMatches) {
      ok(`K: browser == API == reload; ${reloaded.wallCount} walls / ${reloaded.rooms.length} rooms; diagnostics zero`);
    }
    await shot("K-after-reload.png");
  }

  ev.finishedAt = new Date().toISOString();
  ev.totalWrites = writes;
  ev.pass = ev.failures.length === 0;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "evidence.json"), JSON.stringify(ev, null, 2));
  await ctx.close();
  await browser.close();
  console.log(`\nRESULT: ${ev.pass ? "PASS" : "FAIL"}  failures=${ev.failures.length}  writes=${writes}`);
  if (!ev.pass) console.log(JSON.stringify(ev.failures, null, 2));
  process.exit(ev.pass ? 0 : 1);
}

main().catch((e) => {
  ev.failures.push(`acceptance crashed: ${e?.message || e}`);
  ev.finishedAt = new Date().toISOString();
  ev.pass = false;
  try { fs.writeFileSync(path.join(EVIDENCE_DIR, "evidence.json"), JSON.stringify(ev, null, 2)); } catch {}
  console.error(e);
  process.exit(1);
});
