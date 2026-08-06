/**
 * PHASE 2D1 ACCEPTANCE — zoom-bounded wall snap + single active guide.
 *
 * Cases A–R: attachment freedom along a wall at overview zoom, node capture
 * bounded by NODE_LINK_THR at every zoom, wall-body availability just outside
 * that bound, guide hygiene (one winner, replaced each move, cleared on
 * release/Escape/tool switch), Alt, the draw gesture contract, single vs
 * double click, reload parity and the rectangle regression.
 *
 * Also re-proves Phase 2C3A in the SELECT tool: free / T-branch / host-half
 * drag, arrow keys, Ctrl+Z and reload. (Walls are intentionally NOT draggable
 * while the Wall tool is active.)
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

const NODE_LINK_THR = 85;
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
  const walls = (plan?.walls || []).filter((w) => w.a && w.b)
    .map((w) => `${w.id}:${w.a}>${w.b}`).sort();
  const rooms = (plan?.rooms || []).length;
  return JSON.stringify({ nodes, walls, rooms });
}
const apiPlan = async () => {
  const res = await fetch(`${API}${SAVE_PATH}`, { headers: { "X-Admin-Key": ADMIN_KEY } });
  if (!res.ok) throw new Error(`GET project failed: ${res.status}`);
  const d = await res.json();
  return d.plan || d.project?.plan || {};
};

const ev = {
  phase: "2D1", branch: "", head: "", baseUrl: BASE, apiUrl: API,
  projectIdMask: mask(PROJECT_ID), nodeLinkThrMm: NODE_LINK_THR,
  cases: {}, screenshots: [], writes: [], consoleErrors: [], failures: [],
  startedAt: new Date().toISOString(), finishedAt: null, pass: false,
};
try { ev.branch = execSync("git branch --show-current", { encoding: "utf8" }).trim(); } catch {}
try { ev.head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch {}
let writes = 0;
const fail = (m) => { ev.failures.push(m); console.log(`  FAIL: ${m}`); };
const ok = (m) => console.log(`  ok: ${m}`);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") ev.consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => ev.consoleErrors.push(String(e)));
  page.on("request", (r) => { if (isSave(r)) { writes += 1; ev.writes.push({ at: Date.now(), method: r.method() }); } });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(ADMIN_KEY);
  await page.locator("form button").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
  // Let the login route's post-auth navigation settle before issuing the
  // project navigation; otherwise its delayed redirect to "/" can interrupt
  // page.goto(project) on a fast localhost run.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(350);
  await page.goto(`${BASE}${"/project/"}${PROJECT_ID}/plan`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });

  const state = () => page.evaluate(() => {
    const d = window.__dgPlanner;
    const p = d.plan || {};
    const ep = d.effectivePlan || p;
    const walls = d.resolvedWalls?.length ? d.resolvedWalls : (p.walls || []);
    return {
      tool: d.tool, draftLen: d.draftLen, v2: d.wallDrawV2 || null,
      canUndo: d.canUndo, canRedo: d.canRedo, selection: d.selection,
      view: { panX: d.view.panX, panY: d.view.panY, zoom: d.view.zoom },
      rect: { left: d.svgRect.left, top: d.svgRect.top, w: d.svgRect.width, h: d.svgRect.height },
      wallCount: walls.length,
      walls: walls.map((w) => ({ id: w.id, a: w.a, b: w.b, pts: (w.pts || []).map((q) => ({ x: q.x, y: q.y })) })),
      nodes: p.nodes || {},
      plan: { nodes: p.nodes || {}, walls: (p.walls || []).map((w) => ({ id: w.id, a: w.a, b: w.b })), rooms: p.rooms || [] },
      effectivePlan: {
        nodes: ep.nodes || {},
        walls: (ep.walls || []).map((w) => ({ id: w.id, a: w.a, b: w.b })),
        rooms: ep.rooms || [],
      },
      rooms: p.rooms || [],
      guideCount: (document.querySelectorAll('[data-ui="wall-guides"] line, [data-ui="wall-guides"] path').length) || null,
    };
  });
  const boot = await state();
  if (!boot.v2?.enabled) throw new Error("VITE_DG_PLANNER_WALL_DRAW_V2=1 is not active — refusing to run the 2D1 gate");
  ok("V2 drag-release path is active");

  const w2s = async (mx, my) => {
    const s = await state();
    return { x: s.rect.left + s.view.panX + mx * s.view.zoom, y: s.rect.top + s.view.panY + my * s.view.zoom };
  };
  const shot = async (n) => { await page.screenshot({ path: path.join(SHOTS, n) }); ev.screenshots.push(n); };
  /** Activate a tool through the rail's own button (id, not a label). */
  const pickTool = async (id) => {
    await page.locator(`button[data-tool-id="${id}"]`).first().click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(250);
    const got = (await state()).tool;
    if (got !== id) throw new Error(`tool "${id}" did not activate (tool=${got})`);
  };
  async function zoomTo(target) {
    const s0 = await state();
    await page.mouse.move(s0.rect.left + s0.rect.w / 2, s0.rect.top + s0.rect.h / 2);
    for (let i = 0; i < 160; i++) {
      const c = await state();
      if (Math.abs(c.view.zoom - target) / target <= 0.18) break;
      await page.mouse.wheel(0, c.view.zoom < target ? -120 : 120);
      await page.waitForTimeout(22);
    }
    return (await state()).view.zoom;
  }
  const CANVAS_MARGIN = 70;
  /** True when a screen point is safely inside the drawing canvas. */
  async function onScreen(px) {
    const s = await state();
    return px.x > s.rect.left + CANVAS_MARGIN && px.x < s.rect.left + s.rect.w - CANVAS_MARGIN
      && px.y > s.rect.top + CANVAS_MARGIN && px.y < s.rect.top + s.rect.h - CANVAS_MARGIN;
  }
  /**
   * A canvas point over bare background. A middle-button press that lands on a
   * wall never reaches the SVG's pan handler (the wall element stops
   * propagation), so the pan silently does nothing.
   */
  const bareSpot = async (want) => {
    const s = await state();
    const cands = [];
    for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const p = { x: s.rect.left + s.rect.w * fx, y: s.rect.top + s.rect.h * fy };
        if (want && (want(p) === false)) continue;
        cands.push(p);
      }
    }
    for (const c of cands) {
      const bare = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return !!el && (el.tagName === "svg" || el.getAttribute("data-canvas-bg") === "1");
      }, c);
      if (bare) return c;
    }
    return null;
  };
  /**
   * Bring a model point to the middle of the canvas with middle-button pans.
   * Wheel zoom is anchored at the cursor, so it pans as well — without this the
   * probe points of one zoom level land outside the canvas at the next one.
   */
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
      // The whole drag must stay inside the canvas, so the step is clamped by
      // the room left around the chosen start point.
      const start = await bareSpot((q) => {
        const room = Math.min(
          dx >= 0 ? s.rect.left + s.rect.w - 20 - q.x : q.x - s.rect.left - 20,
          dy >= 0 ? s.rect.top + s.rect.h - 20 - q.y : q.y - s.rect.top - 20,
        );
        return room > 120;
      });
      if (!start) { console.log("  centerOn: no bare canvas spot to start a pan"); return false; }
      const room = Math.min(
        dx >= 0 ? s.rect.left + s.rect.w - 20 - start.x : start.x - s.rect.left - 20,
        dy >= 0 ? s.rect.top + s.rect.h - 20 - start.y : start.y - s.rect.top - 20,
      );
      const k = Math.min(1, room / len);
      await page.mouse.move(start.x, start.y, { steps: 2 });
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(start.x + dx * k, start.y + dy * k, { steps: 8 });
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(130);
    }
    const s = await state();
    const p = { x: s.rect.left + s.view.panX + mm.x * s.view.zoom, y: s.rect.top + s.view.panY + mm.y * s.view.zoom };
    console.log(`  centerOn(${Math.round(mm.x)},${Math.round(mm.y)}) did not converge: at ${Math.round(p.x)},${Math.round(p.y)} rect=${JSON.stringify(s.rect)}`);
    return false;
  }
  /** What the browser would actually deliver a press at this screen point to. */
  const hitAt = (px) => page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return "none";
    return `${el.tagName}#${el.id || ""}.${(el.getAttribute("class") || "").slice(0, 40)}[${el.getAttribute("data-ui") || ""}]`;
  }, px);
  /**
   * Read the resolver's answer for one model point using only the existing
   * E2E seam: press (which resolves the START point and publishes it as
   * preview.startSnap), sample, then Escape so nothing is committed.
   *
   * The cursor can only sit on whole pixels, so the point actually probed is
   * reported back and every assertion is made against that real geometry
   * rather than against the requested millimetres.
   */
  async function probe(mm) {
    const raw = await w2s(mm.x, mm.y);
    const p = { x: Math.round(raw.x), y: Math.round(raw.y) };
    if (!(await onScreen(p))) throw new Error(`probe point off canvas: model ${JSON.stringify(mm)} -> ${JSON.stringify(p)}`);
    const s1 = await state();
    const actual = {
      x: (p.x - s1.rect.left - s1.view.panX) / s1.view.zoom,
      y: (p.y - s1.rect.top - s1.view.panY) / s1.view.zoom,
    };
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await page.mouse.down();
    await page.waitForTimeout(90);
    const s = await state();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(90);
    await page.mouse.up();
    await page.waitForTimeout(90);
    return { snap: s.v2?.preview?.startSnap || null, actual, zoom: s1.view.zoom };
  }
  /** Draw one wall with hold → move → release. */
  async function draw(from, to) {
    const a = await w2s(from.x, from.y);
    const b = await w2s(to.x, to.y);
    if (!(await onScreen(a)) || !(await onScreen(b))) {
      throw new Error(`draw endpoints off canvas: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
    const hit = await hitAt(a);
    const before = await state();
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(a.x + (b.x - a.x) * 0.4, a.y + (b.y - a.y) * 0.4, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    const held = await state();
    await page.mouse.up();
    await page.waitForTimeout(260);
    const after = await state();
    return { before, held, after, hit, added: after.wallCount - before.wallCount };
  }

  /* ---- host wall geometry from the seeded fixture ---- */
  const s0 = await state();
  const host = s0.walls.find((w) => w.id === "top-left") || s0.walls[0];
  const hA = host.pts[0];
  const hB = host.pts[host.pts.length - 1];

  /**
   * A degree-2 corner plus the direction pointing away from both of its walls.
   * Probing a T-junction diagonally would be meaningless: the crossing wall's
   * body is nearer than the node itself, so wall-body legitimately wins and the
   * node bound is never exercised.
   */
  function pickCorner(s) {
    const unit = (from, to) => {
      const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: (to.x - from.x) / l, y: (to.y - from.y) / l };
    };
    for (const [id, n] of Object.entries(s.nodes)) {
      const inc = s.plan.walls.filter((w) => w.a === id || w.b === id);
      if (inc.length !== 2) continue;
      const dirs = inc.map((w) => unit(n, s.nodes[w.a === id ? w.b : w.a]));
      if (Math.abs(dirs[0].x * dirs[1].x + dirs[0].y * dirs[1].y) > 0.2) continue; // want a right angle
      const sx = dirs[0].x + dirs[1].x;
      const sy = dirs[0].y + dirs[1].y;
      const l = Math.hypot(sx, sy) || 1;
      return { id, node: n, out: { x: -sx / l, y: -sy / l }, along: dirs[0] };
    }
    throw new Error("fixture has no degree-2 right-angle corner");
  }
  const corner = pickCorner(s0);
  ok(`corner node for the bound matrix: ${corner.id} at ${Math.round(corner.node.x)},${Math.round(corner.node.y)}`);

  /* The seeded topology, so the movement regression starts from the fixture it
     was designed for instead of from whatever the drawing cases left behind. */
  const seedPlan = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dgPlanner.plan)));
  async function installFixture(nextPlan) {
    const cur = await (await fetch(`${API}${SAVE_PATH}`, { headers: { "X-Admin-Key": ADMIN_KEY } })).json();
    const res = await fetch(`${API}${SAVE_PATH}`, {
      method: "PATCH",
      headers: { "X-Admin-Key": ADMIN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: nextPlan, expectedRevision: cur.revision }),
    });
    if (!res.ok) throw new Error(`fixture reset failed: ${res.status}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(1400);
  }
  const resetFixture = () => installFixture(seedPlan);

  /* ---------- A / F: attachment freedom at overview zoom ---------- */
  console.log("[A/F] overview zoom — free attachment along one host wall");
  {
    const zoom = await zoomTo(0.055);
    await centerOn({ x: (hA.x + hB.x) / 2, y: (hA.y + hB.y) / 2 + 1200 });
    await pickTool("wall");
    const picks = [];
    for (const frac of [0.30, 0.45, 0.60, 0.75]) {
      const at = { x: hA.x + (hB.x - hA.x) * frac, y: hA.y + (hB.y - hA.y) * frac };
      const r = await draw(at, { x: at.x, y: at.y + 2500 });
      picks.push({ frac, added: r.added, startX: Math.round(r.held.v2?.preview?.start?.x ?? NaN) });
    }
    const xs = picks.map((p) => p.startX);
    ev.cases.A = { zoom: Math.round(zoom * 1000) / 1000, picks, distinctStarts: new Set(xs).size };
    if (picks.some((p) => p.added < 1)) fail(`A: some attachments created no wall: ${JSON.stringify(picks.map((p) => p.added))}`);
    else if (new Set(xs).size !== xs.length) fail(`A: attachment points collapsed onto each other: ${JSON.stringify(xs)}`);
    else ok(`A/F: ${xs.length} distinct attachment points at zoom ${ev.cases.A.zoom} (${xs.join(", ")})`);
    await shot("A-overview-attachments.png");
    // undo them
    for (let i = 0; i < picks.length; i++) { await page.keyboard.press("Control+z"); await page.waitForTimeout(220); }
    await page.waitForTimeout(SETTLE);
  }

  /* ---------- B / C / D / E: node bound across zooms ---------- */
  console.log("[B/C/D/E] node capture obeys BOTH bounds at every zoom");
  {
    const isNode = (k) => k === "node" || k === "wall-end";
    const rows = [];
    const bodyRows = [];
    for (const target of [0.055, 0.17, 0.75]) {
      const zoom = await zoomTo(target);
      if (!(await centerOn(corner.node))) throw new Error("could not centre the corner");
      for (const d of [40, 70, 110, 150, 250]) {
        const r = await probe({ x: corner.node.x + corner.out.x * d, y: corner.node.y + corner.out.y * d });
        const distMm = Math.hypot(r.actual.x - corner.node.x, r.actual.y - corner.node.y);
        rows.push({
          zoom: Math.round(r.zoom * 1000) / 1000, askedMm: d,
          actualMm: Math.round(distMm * 10) / 10, actualPx: Math.round(distMm * r.zoom * 10) / 10,
          kind: r.snap?.kind ?? null, connects: r.snap?.connects ?? null,
          eligible: distMm <= NODE_LINK_THR && distMm * r.zoom <= 12,
        });
      }
      // D: the wall body stays selectable just outside the node bound
      const b = await probe({ x: corner.node.x + corner.along.x * 130, y: corner.node.y + corner.along.y * 130 });
      bodyRows.push({
        zoom: Math.round(b.zoom * 1000) / 1000,
        fromCornerMm: Math.round(Math.hypot(b.actual.x - corner.node.x, b.actual.y - corner.node.y)),
        kind: b.snap?.kind ?? null, connects: b.snap?.connects ?? null,
      });
    }
    ev.cases.BCDE = { rows, bodyRows, contract: "node captured <=> distMm <= 85 AND distPx <= 12" };
    // The contract is a strict equivalence, so both directions are checked.
    const wrongCapture = rows.filter((r) => !r.eligible && isNode(r.kind));
    const wrongMiss = rows.filter((r) => r.eligible && !isNode(r.kind));
    if (wrongCapture.length) fail(`B/E: node captured outside its bounds: ${JSON.stringify(wrongCapture)}`);
    if (wrongMiss.length) fail(`C: node inside both bounds not captured: ${JSON.stringify(wrongMiss)}`);
    if (!rows.some((r) => r.eligible && isNode(r.kind))) fail("C: the matrix never captured a node — it proves nothing");
    if (bodyRows.some((r) => r.kind !== "wall-body")) fail(`D: wall body just outside the node bound is not selectable: ${JSON.stringify(bodyRows)}`);
    if (!ev.failures.length) {
      const cap = rows.filter((r) => isNode(r.kind)).map((r) => `${r.actualMm}mm/${r.actualPx}px@z${r.zoom}`);
      ok(`B/C/D/E: capture set == {distMm<=85 AND distPx<=12} across zooms ${[...new Set(rows.map((r) => r.zoom))].join(", ")}`);
      ok(`  captured: ${cap.join(", ") || "none"}; wall body at ~130 mm always selectable`);
    }
  }

  /* ---------- G / H / I / J / K / L: guides ---------- */
  console.log("[G/H/I/J/K/L] guide hygiene");
  {
    await pickTool("wall");
    await zoomTo(0.055);
    await centerOn({ x: (hA.x + hB.x) / 2 + 900, y: hA.y + 1100 });
    const countGuides = () => page.evaluate(() => ({
      alignment: document.querySelectorAll('g[data-ui="wall-guides"] line').length,
      angleLabels: document.querySelectorAll('g[data-ui="wall-angles"] *').length,
      dashed: [...document.querySelectorAll("line,path")].filter((el) => el.getAttribute("stroke-dasharray")).length,
    }));
    const at = { x: hA.x + (hB.x - hA.x) * 0.5, y: hA.y };
    const a = await w2s(at.x, at.y);
    const b = await w2s(at.x + 1800, at.y + 2200);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    const during1 = await countGuides();
    await page.mouse.move(b.x + 60, b.y + 40, { steps: 4 });
    const during2 = await countGuides();
    await shot("G-during-draw.png");
    await page.mouse.up();
    await page.waitForTimeout(400);
    const afterRelease = await countGuides();
    // The release commits a wall, whose autosave is debounced; let it land so
    // the Escape baseline below measures Escape and not the previous commit.
    await page.waitForTimeout(SETTLE);
    const wRelease = writes;
    // Escape during a fresh draw
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const afterEscape = await countGuides();
    await page.mouse.up();
    await page.waitForTimeout(SETTLE);
    const escapeWrites = writes - wRelease;
    await pickTool("wall");
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    const wToolSwitch = writes;
    await page.evaluate(() => document.querySelector('button[data-tool-id="select"]')?.click());
    await page.waitForTimeout(250);
    const afterToolSwitch = await countGuides();
    await page.mouse.up();
    await page.waitForTimeout(SETTLE);
    const toolSwitchWrites = writes - wToolSwitch;
    ev.cases.guides = { during1, during2, afterRelease, afterEscape, afterToolSwitch, escapeWrites, toolSwitchWrites };
    if (during1.alignment > 1) fail(`H: ${during1.alignment} alignment guides during draw (expected <= 1)`);
    if (during1.angleLabels > 0) fail(`G: ${during1.angleLabels} angle-label nodes during draw (expected 0)`);
    if (during2.alignment > 1) fail(`I: guides accumulated across pointermove (${during2.alignment})`);
    if (afterRelease.alignment !== 0) fail(`J: ${afterRelease.alignment} guides left after release`);
    if (afterEscape.alignment !== 0) fail(`K: ${afterEscape.alignment} guides left after Escape`);
    if (escapeWrites !== 0) fail(`K: Escape produced ${escapeWrites} write(s)`);
    if (afterToolSwitch.alignment !== 0) fail(`L: ${afterToolSwitch.alignment} guides left after tool switch`);
    if (toolSwitchWrites !== 0) fail(`L: tool switch produced ${toolSwitchWrites} write(s)`);
    if (!ev.failures.length) ok(`G-L: <=1 guide during draw, 0 angle labels, 0 after release/Escape/tool switch, Escape/tool-switch writes ${escapeWrites}/${toolSwitchWrites}`);
    await shot("J-after-release.png");
  }

  /* ---------- M / N / O / P: gesture + click contract ---------- */
  console.log("[M/N/O/P] gesture, Alt, single vs double click");
  {
    await pickTool("wall");
    await zoomTo(0.17);
    const anchor = { x: hA.x + 1500, y: hA.y + 4200 };
    await centerOn({ x: anchor.x + 1100, y: anchor.y });
    const before = await state();
    const wStart = writes;
    const a = await w2s(anchor.x, anchor.y);
    const b = await w2s(anchor.x + 2200, anchor.y);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    const heldN = await state();
    const holdWrites = writes - wStart;
    await page.mouse.up();
    await page.waitForTimeout(260);
    const afterN = await state();
    await page.waitForTimeout(SETTLE);
    const afterTool = (await state()).tool;
    ev.cases.N = {
      added: afterN.wallCount - before.wallCount,
      previewDuringHold: !!heldN.v2?.preview,
      toolAfter: afterTool,
      holdWrites,
      releaseWrites: writes - wStart,
    };
    if (ev.cases.N.added !== 1) fail(`N: hold+release created ${ev.cases.N.added} wall(s), expected 1`);
    if (!heldN.v2?.preview) fail("N: no preview during hold");
    if (holdWrites !== 0) fail(`N: hold produced ${holdWrites} write(s)`);
    if (ev.cases.N.releaseWrites !== 1) fail(`N: release produced ${ev.cases.N.releaseWrites} save write(s), expected 1`);
    if (afterTool !== "wall") fail(`N: wall tool no longer active (${afterTool})`);
    // Alt — a point 20 mm off the corner, i.e. well inside every magnet bound
    await centerOn(corner.node);
    await page.keyboard.down("Alt");
    const altProbe = await probe({ x: corner.node.x + corner.out.x * 20, y: corner.node.y + corner.out.y * 20 });
    await page.keyboard.up("Alt");
    ev.cases.M = { kind: altProbe.snap?.kind ?? null, connects: altProbe.snap?.connects ?? null };
    if (!altProbe.snap) fail("M: Alt probe produced no snap metadata at all");
    else if (altProbe.snap.kind !== "raw" || altProbe.snap.connects) fail(`M: Alt did not bypass magnets (kind=${altProbe.snap.kind}, connects=${altProbe.snap.connects})`);
    // Single vs double click on an existing wall, in Select tool
    await pickTool("select");
    await centerOn({ x: (hA.x + hB.x) / 2, y: (hA.y + hB.y) / 2 });
    const mid = await w2s((hA.x + hB.x) / 2, (hA.y + hB.y) / 2);
    await page.waitForTimeout(SETTLE);
    const wSingle = writes;
    const singleBefore = fingerprint((await state()).plan);
    await page.mouse.move(mid.x, mid.y, { steps: 3 });
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(350);
    const afterSingle = await page.evaluate(() => ({
      inspector: document.querySelectorAll('input[data-ui="wall-length"], [data-ui="wall-properties"]').length,
      drawerOpen: !!document.querySelector(".dg-drawer--open, [data-ui='inspector'][data-open='true']"),
    }));
    await page.waitForTimeout(SETTLE);
    const singleWrites = writes - wSingle;
    const singlePlanUnchanged = fingerprint((await state()).plan) === singleBefore;
    await page.mouse.dblclick(mid.x, mid.y);
    await page.waitForTimeout(500);
    const afterDouble = await page.evaluate(() => ({
      inspector: document.querySelectorAll('input[data-ui="wall-length"], [data-ui="wall-properties"]').length,
    }));
    ev.cases.OP = { afterSingle, afterDouble, singleWrites, singlePlanUnchanged };
    if (singleWrites !== 0) fail(`O: single click produced ${singleWrites} write(s)`);
    if (!singlePlanUnchanged) fail("O: single click changed the plan");
    ok(`M/N/O/P: hold→preview→1 wall, tool stays wall; Alt kind=${ev.cases.M.kind}; single-click inspector=${afterSingle.inspector}, double=${afterDouble.inspector}`);
    await shot("P-double-click.png");
  }

  /* ---------- Select-mode movement regression (Phase 2C3A) ---------- */
  console.log("[SELECT] wall movement regression in the Select tool");
  {
    await resetFixture();
    await pickTool("select");
    await zoomTo(0.17);
    const s = await state();
    // free wall / host half / T-branch — the three Phase 2C3A acquisition classes
    const targets = ["oblique", "top-left", "divider"].filter((id) => s.walls.some((w) => w.id === id));
    if (targets.length !== 3) fail(`SELECT: fixture lost a movement target (${targets.join(",")})`);
    const results = [];
    let undoTargetFp = null;
    for (const id of targets) {
      // Every acquisition class starts from the same canonical fixture. Using
      // coordinates captured before earlier drags made later probes press bare
      // canvas and was the last false failure of the interrupted run.
      await resetFixture();
      await pickTool("select");
      await zoomTo(0.17);
      const fresh = await state();
      const w = fresh.walls.find((x) => x.id === id);
      const a = w.pts[0];
      const b = w.pts[w.pts.length - 1];
      // 0.35 along, not the midpoint: the auto wall-length label sits at the
      // middle and would swallow the press.
      const grabMm = { x: a.x + (b.x - a.x) * 0.35, y: a.y + (b.y - a.y) * 0.35 };
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      await centerOn(grabMm);
      const from = await w2s(grabMm.x, grabMm.y);
      const to = await w2s(grabMm.x + nx * 400, grabMm.y + ny * 400);
      if (!(await onScreen(from)) || !(await onScreen(to))) {
        results.push({ id, movedByMouse: false, note: "off canvas" });
        continue;
      }
      await page.mouse.move(from.x, from.y, { steps: 3 });
      await page.mouse.down(); await page.mouse.up();       // select
      await page.waitForTimeout(260);
      const selected = (await state()).selection;
      const beforeState = await state();
      const beforeFp = fingerprint(beforeState.plan);
      const beforeApiFp = fingerprint(await apiPlan());
      const wMove = writes;
      await page.mouse.move(from.x, from.y, { steps: 2 });
      await page.mouse.down();
      await page.mouse.move(from.x + (to.x - from.x) * 0.5, from.y + (to.y - from.y) * 0.5, { steps: 5 });
      await page.waitForTimeout(180);
      const held = await state();
      const heldApiFp = fingerprint(await apiPlan());
      const holdWrites = writes - wMove;
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(SETTLE);
      const afterMove = await state();
      const afterFp = fingerprint(afterMove.plan);
      const afterApiFp = fingerprint(await apiPlan());
      const moved = afterFp !== beforeFp;
      const last = await page.evaluate(() => window.__dgPlanner.probe?.lastWallMoveResult ?? null);
      const diag = topologyDiagnostics(afterMove.plan, afterMove.walls);
      results.push({
        id, movedByMouse: moved,
        selected: JSON.stringify(selected ?? null).slice(0, 120),
        reason: last?.reason ?? null, effectiveDelta: last?.effectiveDelta ?? null,
        previewDuringHold: fingerprint(held.effectivePlan) !== fingerprint(held.plan),
        committedUnchangedDuringHold: fingerprint(held.plan) === beforeFp,
        apiUnchangedDuringHold: heldApiFp === beforeApiFp,
        holdWrites,
        releaseWrites: writes - wMove,
        apiMatchesRelease: afterApiFp === afterFp,
        topologyDefects: Object.values(diag).reduce((n, xs) => n + xs.length, 0),
      });
      undoTargetFp = beforeFp;
    }
    // Ctrl+Z exercises the real committed mouse transaction. Do it before a
    // fixture reload: resetHistory deliberately marks the next plain setPlan
    // as hydration-adjacent, so making an arrow the very first mutation after
    // reload is an artificial cold-history setup, not the manual workflow.
    await page.waitForFunction(() => window.__dgPlanner?.canUndo === true, null, { timeout: 5000 });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Control+KeyZ");
    await page.waitForTimeout(SETTLE);
    const undoFp = fingerprint((await state()).plan);
    const undoWorked = undoFp === undoTargetFp;
    const undoApiMatches = fingerprint(await apiPlan()) === undoFp;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(900);
    const undoReloadMatches = fingerprint((await state()).plan) === undoFp;
    // Arrows: grab a HORIZONTAL wall so ArrowUp is a real perpendicular nudge.
    // moveWallSegment projects the delta onto the safe direction, so ArrowUp on
    // the vertical divider is legitimately a no-op, not a defect.
    await resetFixture();
    await pickTool("select");
    await zoomTo(0.17);
    const sh = await state();
    const hw = sh.walls.find((x) => x.id === "top-left") || sh.walls[0];
    const grabH = {
      x: hw.pts[0].x + (hw.pts[1].x - hw.pts[0].x) * 0.35,
      y: hw.pts[0].y + (hw.pts[1].y - hw.pts[0].y) * 0.35,
    };
    await centerOn(grabH);
    const gp = await w2s(grabH.x, grabH.y);
    await page.mouse.move(gp.x, gp.y, { steps: 3 });
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(300);
    const beforeArrow = fingerprint((await state()).plan);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(SETTLE);
    const arrowMoved = fingerprint((await state()).plan) !== beforeArrow;
    ev.cases.arrows = {
      wallId: hw.id,
      selection: (await state()).selection,
      lastResult: await page.evaluate(() => window.__dgPlanner.probe?.lastWallMoveResult ?? null),
    };
    ev.cases.selectMove = { results, arrowMoved, undoWorked, undoApiMatches, undoReloadMatches };
    const stuck = results.filter((r) => !r.movedByMouse).map((r) => r.id);
    if (stuck.length) fail(`SELECT: wall(s) not draggable in the Select tool: ${stuck.join(", ")} — ${JSON.stringify(results)}`);
    if (!arrowMoved) fail("SELECT: arrow keys did not move the selected wall");
    if (!undoWorked) fail("SELECT: Ctrl+Z did not undo");
    if (!undoApiMatches || !undoReloadMatches) fail(`SELECT: Undo persistence mismatch (api=${undoApiMatches}, reload=${undoReloadMatches})`);
    for (const r of results) {
      if (!r.previewDuringHold) fail(`SELECT ${r.id}: no transient preview during hold`);
      if (!r.committedUnchangedDuringHold || !r.apiUnchangedDuringHold) fail(`SELECT ${r.id}: committed/API state changed during hold`);
      if (r.holdWrites !== 0) fail(`SELECT ${r.id}: hold produced ${r.holdWrites} write(s)`);
      if (r.releaseWrites !== 1) fail(`SELECT ${r.id}: release produced ${r.releaseWrites} save write(s), expected 1`);
      if (r.reason !== "WALL_SEGMENT_MOVED") fail(`SELECT ${r.id}: reason=${r.reason}`);
      if (!r.apiMatchesRelease) fail(`SELECT ${r.id}: browser/API mismatch after release`);
      if (r.topologyDefects !== 0) fail(`SELECT ${r.id}: ${r.topologyDefects} topology defect(s) after release`);
    }
    if (!stuck.length) ok(`SELECT: ${results.length}/${results.length} walls dragged (${results.map((r) => r.id).join(", ")}), arrows=${arrowMoved}, Ctrl+Z=${undoWorked}`);
    await shot("SELECT-movement.png");
  }

  /* ---------- R: five independent rectangles ---------- */
  console.log("[R] five independent drag-release rectangles");
  {
    const emptyPlan = {
      ...seedPlan,
      nodes: {}, walls: [], rooms: [], zones: [], dimensions: [],
      items: [], lines: [], links: [], structurals: [], validationWarnings: [],
    };
    await installFixture(emptyPlan);
    await pickTool("wall");
    await zoomTo(0.055);
    const OX0 = 0, OY0 = 0, OX1 = 10000, OY1 = 7000;
    await centerOn({ x: 5000, y: 3500 });
    const rect = (x0, y0, x1, y1) => [
      [{ x: x0, y: y0 }, { x: x1, y: y0 }],
      [{ x: x1, y: y0 }, { x: x1, y: y1 }],
      [{ x: x1, y: y1 }, { x: x0, y: y1 }],
      [{ x: x0, y: y1 }, { x: x0, y: y0 }],
    ];
    const all = [...rect(OX0, OY0, OX1, OY1)];
    const pad = 700, iw = 2600, ih = 1900;
    for (const [x0, y0] of [
      [OX0 + pad, OY0 + pad],
      [OX0 + pad + iw + pad, OY0 + pad],
      [OX0 + pad, OY0 + pad + ih + pad],
      [OX0 + pad + iw + pad, OY0 + pad + ih + pad],
    ]) all.push(...rect(x0, y0, x0 + iw, y0 + ih));
    const perDrag = [];
    for (let i = 0; i < all.length; i++) {
      const r = await draw(all[i][0], all[i][1]);
      perDrag.push({ index: i + 1, added: r.added, preview: !!r.held.v2?.preview, tool: r.after.tool });
    }
    await page.waitForTimeout(SETTLE);
    const final = await state();
    const diag = topologyDiagnostics(final.plan, final.walls);
    const diagonals = final.walls.filter((w) => {
      const a = w.pts?.[0], b = w.pts?.[w.pts.length - 1];
      return a && b && Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1;
    });
    ev.cases.R = {
      drags: perDrag.length,
      eachAddedOne: perDrag.every((x) => x.added === 1),
      eachPreviewed: perDrag.every((x) => x.preview),
      walls: final.wallCount,
      nodes: Object.keys(final.nodes).length,
      rooms: final.rooms.length,
      diagonals: diagonals.length,
      diagnostics: Object.fromEntries(Object.entries(diag).map(([k, v]) => [k, v.length])),
    };
    if (!ev.cases.R.eachAddedOne || !ev.cases.R.eachPreviewed) fail(`R: not every drag previewed and added exactly one wall: ${JSON.stringify(perDrag)}`);
    if (ev.cases.R.walls !== 20 || ev.cases.R.nodes !== 20 || ev.cases.R.rooms !== 5) fail(`R: expected 20/20/5, got ${ev.cases.R.walls}/${ev.cases.R.nodes}/${ev.cases.R.rooms}`);
    if (ev.cases.R.diagonals !== 0) fail(`R: ${ev.cases.R.diagonals} diagonal wall(s)`);
    if (Object.values(diag).some((xs) => xs.length)) fail(`R: topology diagnostics not clean: ${JSON.stringify(ev.cases.R.diagnostics)}`);
    if (ev.cases.R.walls === 20 && ev.cases.R.nodes === 20 && ev.cases.R.rooms === 5 && !ev.cases.R.diagonals) ok("R: 20 walls / 20 nodes / 5 rooms; 0 diagonals/orphans/duplicates/crossings");
    await shot("R-five-rectangles.png");
  }

  /* ---------- Q: reload parity + final topology ---------- */
  console.log("[Q] reload parity and topology diagnostics");
  {
    await page.waitForTimeout(SETTLE);
    const committed = await state();
    const committedFp = fingerprint(committed.plan);
    const savedFp = fingerprint(await apiPlan());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(1500);
    const reloaded = await state();
    const reloadFp = fingerprint(reloaded.plan);
    const diag = topologyDiagnostics(reloaded.plan, reloaded.walls);
    ev.cases.Q = {
      browserMatchesApi: committedFp === savedFp,
      reloadMatches: reloadFp === committedFp,
      diagnostics: Object.fromEntries(Object.entries(diag).map(([k, v]) => [k, v.length])),
      walls: reloaded.wallCount, rooms: reloaded.rooms.length,
    };
    if (!ev.cases.Q.browserMatchesApi) fail("Q: committed != saved");
    if (!ev.cases.Q.reloadMatches) fail("Q: reload != committed");
    if (Object.values(diag).some((l) => l.length)) fail(`Q: topology diagnostics not clean: ${JSON.stringify(ev.cases.Q.diagnostics)}`);
    if (ev.cases.Q.browserMatchesApi && ev.cases.Q.reloadMatches) {
      ok(`Q: browser == API == reload; diagnostics all zero; ${reloaded.wallCount} walls / ${reloaded.rooms.length} rooms`);
    }
    await shot("Q-after-reload.png");
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
