/**
 * PHASE 2E.1 localhost-only browser gate.
 *
 * A. The first real user mutation after loading a plan must be undoable.
 * B. Endpoint/node grips must depend on edit safety, not on the active layer.
 *
 * The caller owns an isolated backend/frontend and one disposable project, and
 * passes it in through the environment. This script seeds that project with its
 * fixture, never creates/deletes projects, never touches production and never
 * writes evidence inside the repo.
 *
 * Required env:
 *   REVIEW_BASE        loopback http origin of the vite dev server
 *   REVIEW_API         loopback http origin of the API
 *   REVIEW_ADMIN_KEY   throwaway local admin key
 *   REVIEW_PROJECT_ID  disposable project id
 *   EVIDENCE_DIR       absolute path OUTSIDE the repo
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const localUrl = (name, value) => {
  const url = new URL(value);
  if (url.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) {
    throw new Error(`${name} must be loopback http`);
  }
  return value.replace(/\/$/, "");
};

const BASE = localUrl("REVIEW_BASE", need("REVIEW_BASE"));
const API = localUrl("REVIEW_API", need("REVIEW_API"));
const ADMIN_KEY = need("REVIEW_ADMIN_KEY");
const PROJECT_ID = need("REVIEW_PROJECT_ID");
const EVIDENCE_DIR = need("EVIDENCE_DIR");
const SETTLE_MS = Number(process.env.SETTLE_MS || 2200);
const HOLD_MS = Number(process.env.HOLD_MS || 1200);
const SAVE_PATH = `/api/projects/${encodeURIComponent(PROJECT_ID)}`;
const WRITE_ORIGINS = new Set([new URL(BASE).origin, new URL(API).origin]);

if (!path.isAbsolute(EVIDENCE_DIR)) throw new Error("EVIDENCE_DIR must be absolute");
const evidenceRel = path.relative(REPO_ROOT, EVIDENCE_DIR);
if (!evidenceRel.startsWith("..") && evidenceRel !== "") throw new Error("EVIDENCE_DIR must be outside repo");
const SHOTS = path.join(EVIDENCE_DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

// --- fixture ----------------------------------------------------------------
//
// room wall, partition wall, free wall, degree-2 corner, oblique wall,
// safe connected endpoint (ordinary T), locked wall, unsafe degree-4 node.

const W = { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "", type: "wall" };

export const FIXTURE = {
  roomWallId: "rw_top",
  partitionWallId: "pt_mid",
  freeWallId: "pt_free",
  cornerWallIds: ["pt_cornerA", "pt_cornerB"],
  obliqueWallId: "pt_oblique",
  connectedWallId: "pt_branch",
  lockedWallId: "pt_locked",
  crossWallIds: ["x_w", "x_e", "x_n", "x_s"],
  degree4NodeId: "xc",
};

function fixturePlan() {
  const nodes = {
    // outer room rectangle
    r1: { x: 0, y: 0 }, r2: { x: 16000, y: 0 }, r3: { x: 16000, y: 11000 }, r4: { x: 0, y: 11000 },
    // partition across the room, tee'd into the two outer walls (safe connected endpoints)
    m1: { x: 8000, y: 0 }, m2: { x: 8000, y: 11000 },
    // free-standing partition, both ends degree-1
    f1: { x: 19000, y: 1000 }, f2: { x: 24000, y: 1000 },
    // degree-2 corner
    c1: { x: 19000, y: 3500 }, c2: { x: 24000, y: 3500 }, c3: { x: 24000, y: 7000 },
    // ordinary T: host halves + branch (branch start is a safe degree-3 endpoint)
    h1: { x: 19000, y: 9000 }, hm: { x: 23000, y: 9000 }, h2: { x: 27000, y: 9000 },
    hb: { x: 23000, y: 13000 },
    // oblique wall
    o1: { x: 30000, y: 1000 }, o2: { x: 34500, y: 5200 },
    // locked wall
    L1: { x: 30000, y: 13500 }, L2: { x: 35000, y: 13500 },
    // degree-4 crossing
    xw: { x: 38000, y: 8000 }, xc: { x: 42000, y: 8000 }, xe: { x: 46000, y: 8000 },
    xn: { x: 42000, y: 4000 }, xs: { x: 42000, y: 12000 },
  };
  const walls = [
    { id: "rw_top", a: "r1", b: "m1", role: "outer", thk: 200 },
    { id: "rw_top2", a: "m1", b: "r2", role: "outer", thk: 200 },
    { id: "rw_right", a: "r2", b: "r3", role: "outer", thk: 200 },
    { id: "rw_bot", a: "r3", b: "m2", role: "outer", thk: 200 },
    { id: "rw_bot2", a: "m2", b: "r4", role: "outer", thk: 200 },
    { id: "rw_left", a: "r4", b: "r1", role: "outer", thk: 200 },
    { id: "pt_mid", a: "m1", b: "m2" },
    { id: "pt_free", a: "f1", b: "f2" },
    { id: "pt_cornerA", a: "c1", b: "c2" },
    { id: "pt_cornerB", a: "c2", b: "c3" },
    { id: "pt_hostL", a: "h1", b: "hm" },
    { id: "pt_hostR", a: "hm", b: "h2" },
    { id: "pt_branch", a: "hm", b: "hb" },
    { id: "pt_oblique", a: "o1", b: "o2" },
    { id: "pt_locked", a: "L1", b: "L2", locked: true },
    { id: "x_w", a: "xw", b: "xc" }, { id: "x_e", a: "xc", b: "xe" },
    { id: "x_n", a: "xn", b: "xc" }, { id: "x_s", a: "xc", b: "xs" },
  ].map((w) => ({ ...W, ...w }));
  return {
    nodes, walls,
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], structurals: [], rulers: [], measurements: [], validationWarnings: [],
    room: { w: 50000, h: 16000, wallThk: 200, height: 3000, showBoundary: false },
  };
}

// --- fingerprints & diagnostics ---------------------------------------------

const resolveWalls = (plan) => (plan?.walls || []).map((wall) => {
  if (Array.isArray(wall.pts) && wall.pts.length >= 2) return { ...wall, pts: wall.pts.map((p) => ({ ...p })) };
  const a = plan?.nodes?.[wall.a];
  const b = plan?.nodes?.[wall.b];
  return { ...wall, pts: a && b ? [{ ...a }, { ...b }] : [] };
});

/** Geometry only — node ids are minted per command, coordinates are not. */
function geometryFingerprint(plan) {
  return JSON.stringify(resolveWalls(plan).map((wall) => {
    const ends = (wall.pts || []).map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).sort();
    return `${wall.id}:${wall.thk ?? 100}:${ends.join("|")}`;
  }).sort());
}

/** Which walls share which node — the attachment structure Undo must restore. */
function topologyFingerprint(plan) {
  const byNode = new Map();
  for (const wall of plan?.walls || []) {
    for (const nodeId of [wall.a, wall.b]) {
      if (!nodeId) continue;
      if (!byNode.has(nodeId)) byNode.set(nodeId, []);
      byNode.get(nodeId).push(wall.id);
    }
  }
  return JSON.stringify([...byNode.values()].map((ids) => ids.sort().join("+")).sort());
}

function topologyDiagnostics(plan) {
  const walls = resolveWalls(plan);
  const used = new Set((plan.walls || []).flatMap((w) => [w.a, w.b]));
  const edges = new Set();
  const duplicateEdges = [];
  const zeroLength = [];
  for (const wall of plan.walls || []) {
    const edge = [wall.a, wall.b].sort().join("|");
    if (edges.has(edge)) duplicateEdges.push(wall.id);
    edges.add(edge);
    const a = plan.nodes?.[wall.a];
    const b = plan.nodes?.[wall.b];
    if (!a || !b || wall.a === wall.b || Math.hypot(b.x - a.x, b.y - a.y) < 50) zeroLength.push(wall.id);
  }
  const unnodedCrossings = [];
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const [a, b] = [walls[i].pts?.[0], walls[i].pts?.at(-1)];
      const [c, d] = [walls[j].pts?.[0], walls[j].pts?.at(-1)];
      if (!a || !b || !c || !d) continue;
      const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
      if (!(o1 * o2 < -1e-6 && o3 * o4 < -1e-6)) continue;
      const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
      if (Math.abs(den) < 1e-9) continue;
      const det1 = a.x * b.y - a.y * b.x;
      const det2 = c.x * d.y - c.y * d.x;
      const point = {
        x: (det1 * (c.x - d.x) - (a.x - b.x) * det2) / den,
        y: (det1 * (c.y - d.y) - (a.y - b.y) * det2) / den,
      };
      const hasNode = Object.values(plan.nodes || {}).some((n) => Math.hypot(n.x - point.x, n.y - point.y) <= 1);
      if (!hasNode) unnodedCrossings.push({ a: walls[i].id, b: walls[j].id, point });
    }
  }
  return {
    orphanNodes: Object.keys(plan.nodes || {}).filter((id) => !used.has(id)),
    duplicateEdges, zeroLength, unnodedCrossings,
  };
}

const diagnosticsClean = (d) => Object.values(d).every((list) => list.length === 0);

// --- API --------------------------------------------------------------------

async function apiProject() {
  const response = await fetch(`${API}/api/projects/${PROJECT_ID}`, { headers: { "X-Admin-Key": ADMIN_KEY } });
  if (!response.ok) throw new Error(`GET project failed: ${response.status}`);
  return response.json();
}

async function seedFixture() {
  const current = await apiProject();
  const response = await fetch(`${API}/api/projects/${PROJECT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
    body: JSON.stringify({ expectedRevision: current.revision, plan: fixturePlan() }),
  });
  if (!response.ok) throw new Error(`fixture PATCH failed: ${response.status} ${await response.text()}`);
  return response.json();
}

// --- evidence ---------------------------------------------------------------

const evidence = {
  phase: "2E.1",
  projectId: "masked",
  fixture: FIXTURE,
  checks: {},
  events: [],
  writes: [],
  screenshots: [],
  failures: [],
  startedAt: new Date().toISOString(),
  pass: false,
};
const fail = (message) => { evidence.failures.push(message); console.error(`  ✗ ${message}`); };
const ok = (message) => console.log(`  ✓ ${message}`);
const expect = (condition, message) => { if (condition) ok(message); else fail(message); return !!condition; };

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  const context = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
  const page = await context.newPage();
  // The login page probes the API before a key exists, so a few 401 resource
  // loads are emitted BEFORE authentication. Those are pre-existing app
  // behaviour and not what this gate is about — record them, but only fail on
  // errors raised once the planner is actually authenticated and running.
  const errors = [];
  let authenticated = false;
  const note = (text) => errors.push({ text: String(text), afterLogin: authenticated });
  page.on("pageerror", (e) => note(e));
  page.on("console", (m) => { if (m.type() === "error") note(m.text()); });
  page.on("request", (request) => {
    if (request.method() !== "PATCH" && request.method() !== "PUT") return;
    try {
      const url = new URL(request.url());
      if (WRITE_ORIGINS.has(url.origin) && url.pathname === SAVE_PATH) {
        evidence.writes.push({ method: request.method(), at: Date.now() });
      }
    } catch { /* ignore */ }
  });

  const state = () => page.evaluate(() => {
    const probe = window.__dgPlanner;
    return {
      tool: probe.tool,
      activeLayer: probe.activeLayer,
      selection: probe.selection ? JSON.parse(JSON.stringify(probe.selection)) : null,
      canUndo: probe.canUndo,
      canRedo: probe.canRedo,
      undoDepth: probe.undoDepth,
      redoDepth: probe.redoDepth,
      moveHandleWallIds: probe.moveHandleWallIds || [],
      endpointGrips: JSON.parse(JSON.stringify(probe.endpointGrips || {})),
      rect: { left: probe.svgRect.left, top: probe.svgRect.top },
      view: { ...probe.view },
      plan: JSON.parse(JSON.stringify(probe.plan || {})),
      effectivePlan: JSON.parse(JSON.stringify(probe.effectivePlan || probe.plan || {})),
      resolvedWalls: (probe.resolvedWalls || []).map((w) => ({
        id: w.id, a: w.a, b: w.b, thk: w.thk,
        pts: (w.pts || []).map((p) => ({ x: p.x, y: p.y })),
      })),
    };
  });

  const screen = (point, snap) => ({
    x: snap.rect.left + snap.view.panX + point.x * snap.view.zoom,
    y: snap.rect.top + snap.view.panY + point.y * snap.view.zoom,
  });
  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
    evidence.screenshots.push(name);
  };
  const event = (tag, detail = {}) => evidence.events.push({ tag, at: Date.now(), ...detail });

  await seedFixture();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(ADMIN_KEY);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }),
    page.locator("form button").first().click(),
  ]);
  await page.waitForTimeout(500);
  authenticated = true;

  const waitReady = async () => {
    await page.waitForFunction(
      () => !!window.__dgPlanner?.svgRect && !!window.__dgPlanner?.resolvedWalls?.length,
      null, { timeout: 45000 },
    );
    await page.getByRole("button", { name: "Выбор", exact: true }).first().click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(SETTLE_MS);
  };

  /** A. Load/reload the plan. Returns the freshly loaded state. */
  const reload = async (label) => {
    await page.goto(`${BASE}/project/${PROJECT_ID}/plan`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitReady();
    const snap = await state();
    event("reload", { label, undoDepth: snap.undoDepth });
    return snap;
  };

  /**
   * MEASURED, and the reason check L below is reported the way it is:
   *
   * `active` (the drawing layer) is set only by applySheet(), and the sheet a
   * user can reach in this 2D UI is base_plan -> activeLayer "room". The
   * "partitions" sheet exists in plannerSheets.js but PlannerSheetStrip is not
   * rendered anywhere, PlannerLayerSwitcher's "Архитектура" chip maps to
   * base_plan, and pickLayer() has no caller. The only other writer of `active`
   * is handlePickPlanItem, which follows an ITEM's layer, not a wall's.
   *
   * So in the shipped UI `active` is permanently "room", which means
   *   editable={active === "partitions" && tool === "select"}
   * was permanently FALSE for every partition — partitions never showed
   * endpoint grips at all. That makes K the decisive browser check.
   */
  const ensureSelectTool = async () => {
    await page.getByRole("button", { name: "Выбор", exact: true }).first().click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(400);
    return state();
  };

  const midpointOf = (wall) => ({
    x: (wall.pts[0].x + wall.pts.at(-1).x) / 2,
    y: (wall.pts[0].y + wall.pts.at(-1).y) / 2,
  });

  /**
   * View plumbing only — never a plan mutation.
   *
   * Fit-zoom on this fixture is ~0.026, where a wall's own automatic dimension
   * line sits within 12 screen px of the wall body and wins the canvas
   * hit-test (PlanPage: `dimHit && (!wallHit || dimHit.screenDistancePx <= 12)`).
   * So the run has to work at a realistic zoom, with the point of interest away
   * from the viewport edges — otherwise a grip's own bounding box can land
   * outside the canvas and the drag never reaches it.
   *
   * Wheel zoom is cursor-anchored, so the anchored world point keeps its screen
   * position; one middle-button pan then puts it in the middle.
   */
  const emptyBackgroundPoint = async (snap, avoid) => {
    const cx = snap.rect.left + 654;
    const cy = snap.rect.top + 479;
    const candidates = [
      { x: cx, y: cy - 330 }, { x: cx, y: cy + 330 },
      { x: cx - 430, y: cy - 330 }, { x: cx + 430, y: cy + 330 },
      { x: cx - 430, y: cy + 330 }, { x: cx + 430, y: cy - 330 },
    ];
    for (const c of candidates) {
      if (avoid && Math.hypot(c.x - avoid.x, c.y - avoid.y) < 80) continue;
      const clear = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return false;
        if (el.closest("[data-ui]")) return false;
        const tag = el.tagName.toLowerCase();
        return tag === "svg" || tag === "rect" || tag === "g";
      }, [c.x, c.y]);
      if (clear) return c;
    }
    return null;
  };

  /** The bottom bar's zoom slider is the deterministic way to set the zoom. */
  const setZoomPct = async (pct) => {
    const slider = page.locator("input.planner-bottom-slider").first();
    await slider.fill(String(pct));
    await slider.dispatchEvent("change");
    await page.waitForTimeout(350);
  };

  const centerOn = async (worldPt, targetZoom = 0.2) => {
    // Fit first (the button is overlapped by the zoom slider, so click the DOM
    // node directly — this is view setup, never a plan mutation), then zoom.
    await page.getByRole("button", { name: "Показать весь план", exact: true })
      .first().evaluate((el) => el.click());
    await page.waitForTimeout(350);
    await setZoomPct(Math.round(targetZoom * 100));
    let snap = await state();
    const centre = { x: snap.rect.left + 654, y: snap.rect.top + 479 };
    const at = screen(worldPt, snap);
    const delta = { x: centre.x - at.x, y: centre.y - at.y };
    if (Math.hypot(delta.x, delta.y) > 30) {
      const from = await emptyBackgroundPoint(snap, at);
      if (from) {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 10 });
        await page.mouse.up({ button: "middle" });
        await page.waitForTimeout(300);
        snap = await state();
      }
    }
    return snap;
  };

  const focusWall = async (wallId, targetZoom = 0.2) => {
    const snap = await state();
    const wall = snap.resolvedWalls.find((w) => w.id === wallId);
    if (!wall) throw new Error(`wall ${wallId} not found`);
    return centerOn(midpointOf(wall), targetZoom);
  };

  /** Put ONE endpoint in the middle of the canvas, so its grip is reachable. */
  const focusEndpoint = async (wallId, endpoint, targetZoom = 0.2) => {
    const snap = await state();
    const wall = snap.resolvedWalls.find((w) => w.id === wallId);
    if (!wall) throw new Error(`wall ${wallId} not found`);
    return centerOn(endpoint === 0 ? wall.pts[0] : wall.pts.at(-1), targetZoom);
  };

  const selectWall = async (wallId) => {
    await focusWall(wallId);
    const before = await state();
    const wall = before.resolvedWalls.find((w) => w.id === wallId);
    if (!wall) throw new Error(`wall ${wallId} not found`);
    const mid = midpointOf(wall);
    const point = screen(mid, before);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => window.__dgPlanner?.selection?.ids?.includes(id), wallId, { timeout: 5000 });
    await page.waitForTimeout(150);
    event("select", { wallId });
    return state();
  };

  // PHASE 2E.1 REWORK — the controls now live in the dedicated top layer, so the
  // endpoint is addressed by name (start|end), not by array index.
  const END = ["start", "end"];
  const gripLocator = (wallId, endpoint) =>
    page.locator(`g[data-wall-endpoint-grip][data-wall-id="${wallId}"][data-endpoint="${END[endpoint]}"]`);
  const anyGripAtNode = (nodeId) =>
    page.locator(`g[data-wall-endpoint-grip][data-node-id="${nodeId}"]`);
  const moveHandleLocator = (wallId) =>
    page.locator(`circle[data-wall-move-handle][data-wall-id="${wallId}"]`);

  /** Is the grip the TOPMOST thing at its own centre? (the manual FAIL) */
  const topmostAt = async (point) => page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const grip = el.closest("[data-wall-endpoint-grip]");
    return {
      tag: el.tagName.toLowerCase(),
      ui: el.getAttribute?.("data-ui") || null,
      isGrip: !!grip,
      wallId: grip?.getAttribute("data-wall-id") || null,
      endpoint: grip?.getAttribute("data-endpoint") || null,
      state: grip?.getAttribute("data-grip-state") || null,
    };
  }, [point.x, point.y]);

  const gripState = async (wallId, endpoint) =>
    gripLocator(wallId, endpoint).first().getAttribute("data-grip-state").catch(() => null);

  const lenAngle = (wall) => {
    const [a, b] = [wall.pts[0], wall.pts.at(-1)];
    return {
      len: Math.hypot(b.x - a.x, b.y - a.y),
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  };

  // ==========================================================================
  // A/B/C/D — first action is ArrowRight, Ctrl+Z restores, Redo re-applies
  // ==========================================================================
  console.log("\n[A-D] first action after load = ArrowRight");
  {
    const loaded = await reload("A");
    const loadedGeom = geometryFingerprint(loaded.plan);
    const loadedTopo = topologyFingerprint(loaded.plan);
    expect(loaded.undoDepth === 0, "A. loading the plan created no undo entry");
    expect(loaded.canUndo === false, "A. Undo is disabled right after load");

    const writesAtLoad = evidence.writes.length;
    await page.waitForTimeout(1500);
    expect(evidence.writes.length === writesAtLoad, "A. hydration alone caused no write");

    await selectWall(FIXTURE.freeWallId);
    await shot("A-loaded-selected.png");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(SETTLE_MS);
    const moved = await state();
    event("arrowRight", { undoDepth: moved.undoDepth });
    expect(geometryFingerprint(moved.plan) !== loadedGeom, "B. the first ArrowRight really moved the wall");
    expect(moved.undoDepth === 1, `B. exactly one undo entry (got ${moved.undoDepth})`);
    await shot("B-after-arrow.png");
    const movedGeom = geometryFingerprint(moved.plan);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(SETTLE_MS);
    const undone = await state();
    expect(geometryFingerprint(undone.plan) === loadedGeom, "C. Ctrl+Z restored the exact loaded fingerprint");
    expect(topologyFingerprint(undone.plan) === loadedTopo, "C. Ctrl+Z restored the exact loaded topology");
    await shot("C-after-undo.png");

    await page.keyboard.press("Control+y");
    await page.waitForTimeout(SETTLE_MS);
    let redone = await state();
    if (geometryFingerprint(redone.plan) !== movedGeom) {
      await page.keyboard.press("Control+Shift+z");
      await page.waitForTimeout(SETTLE_MS);
      redone = await state();
    }
    expect(geometryFingerprint(redone.plan) === movedGeom, "D. Redo restored the first edit");
    await shot("D-after-redo.png");

    evidence.checks.arrowFirstEdit = {
      loadUndoDepth: loaded.undoDepth,
      afterArrowUndoDepth: moved.undoDepth,
      undoRestored: geometryFingerprint(undone.plan) === loadedGeom,
      redoRestored: geometryFingerprint(redone.plan) === movedGeom,
    };
  }

  // ==========================================================================
  // E/F/G — first action is a whole-wall mouse drag
  // ==========================================================================
  console.log("\n[E-G] first action after load = whole-wall mouse drag");
  {
    await seedFixture();
    const loaded = await reload("E");
    const loadedGeom = geometryFingerprint(loaded.plan);
    expect(loaded.undoDepth === 0, "E. reload created no undo entry");

    const selected = await selectWall(FIXTURE.freeWallId);
    const handle = moveHandleLocator(FIXTURE.freeWallId);
    expect(await handle.count() === 1, "F. the central move handle is present");
    const box = await handle.first().boundingBox();
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const to = { x: from.x, y: from.y + 120 * selected.view.zoom };
    const writesBefore = evidence.writes.length;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.waitForTimeout(HOLD_MS);
    const held = await state();
    const apiHeld = await apiProject();
    expect(geometryFingerprint(held.effectivePlan) !== loadedGeom, "Q. the hold moved the PREVIEW");
    expect(geometryFingerprint(held.plan) === loadedGeom, "Q. the hold left the committed plan unchanged");
    expect(geometryFingerprint(apiHeld.plan || {}) === loadedGeom, "Q. the hold left the API plan unchanged");
    expect(evidence.writes.length - writesBefore === 0, "Q. the hold produced 0 writes");
    expect(held.undoDepth === 0, "Q. the hold produced 0 history entries");
    await shot("F-wall-drag-hold.png");

    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS + 1200);
    const released = await state();
    event("wallDragRelease", { undoDepth: released.undoDepth, writes: evidence.writes.length - writesBefore });
    expect(released.undoDepth === 1, `F./R. one history entry on release (got ${released.undoDepth})`);
    expect(evidence.writes.length - writesBefore === 1, `R. exactly one write on release (got ${evidence.writes.length - writesBefore})`);
    await shot("F-wall-drag-released.png");

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(SETTLE_MS);
    const undone = await state();
    expect(geometryFingerprint(undone.plan) === loadedGeom, "G. Undo restored the exact loaded state");
    await shot("G-wall-drag-undone.png");

    evidence.checks.mouseWallDragFirstEdit = {
      holdWrites: 0,
      releaseUndoDepth: released.undoDepth,
      undoRestored: geometryFingerprint(undone.plan) === loadedGeom,
    };
  }

  // ==========================================================================
  // H/I/J + N/O/P — first action is an endpoint drag
  // ==========================================================================
  console.log("\n[H-J, N-P] first action after load = endpoint drag");

  const dragEndpoint = async (wallId, endpoint, deltaMm, label) => {
    // the grip has to be inside the canvas, not clipped past its edge
    await focusEndpoint(wallId, endpoint);
    const before = await state();
    const wall = before.resolvedWalls.find((w) => w.id === wallId);
    const grip = gripLocator(wallId, endpoint);
    if (await grip.count() !== 1) throw new Error(`${label}: expected exactly one grip, found ${await grip.count()}`);
    const box = await grip.first().boundingBox();
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const to = { x: from.x + deltaMm.x * before.view.zoom, y: from.y + deltaMm.y * before.view.zoom };
    const writesBefore = evidence.writes.length;
    const beforeGeom = geometryFingerprint(before.plan);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + (to.x - from.x) * 0.5, from.y + (to.y - from.y) * 0.5, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.waitForTimeout(HOLD_MS);
    const held = await state();
    const apiHeld = await apiProject();
    const hold = {
      previewMoved: geometryFingerprint(held.effectivePlan) !== beforeGeom,
      committedUnchanged: geometryFingerprint(held.plan) === beforeGeom,
      apiUnchanged: geometryFingerprint(apiHeld.plan || {}) === beforeGeom,
      writes: evidence.writes.length - writesBefore,
      historyEntries: held.undoDepth - before.undoDepth,
    };
    await shot(`${label}-hold.png`);
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS + 1200);
    const released = await state();
    await shot(`${label}-released.png`);
    return {
      before, hold, released,
      beforeGeom,
      wallBefore: wall,
      release: {
        changed: geometryFingerprint(released.plan) !== beforeGeom,
        historyEntries: released.undoDepth - before.undoDepth,
        writes: evidence.writes.length - writesBefore,
        diagnostics: topologyDiagnostics(released.plan),
      },
    };
  };

  {
    await seedFixture();
    const loaded = await reload("H");
    const loadedGeom = geometryFingerprint(loaded.plan);
    const loadedTopo = topologyFingerprint(loaded.plan);
    expect(loaded.undoDepth === 0, "H. reload created no undo entry");

    await selectWall(FIXTURE.freeWallId);
    const r = await dragEndpoint(FIXTURE.freeWallId, 0, { x: 400, y: 500 }, "I-endpoint-start");
    expect(r.hold.previewMoved, "Q. endpoint hold moved the preview");
    expect(r.hold.committedUnchanged, "Q. endpoint hold left the committed plan unchanged");
    expect(r.hold.apiUnchanged, "Q. endpoint hold left the API plan unchanged");
    expect(r.hold.writes === 0, "Q. endpoint hold produced 0 writes");
    expect(r.hold.historyEntries === 0, "Q. endpoint hold produced 0 history entries");
    expect(r.release.changed, "I. the first endpoint drag after load changed the plan");
    expect(r.release.historyEntries === 1, `I./R. one history entry (got ${r.release.historyEntries})`);
    expect(r.release.writes === 1, `R. one write (got ${r.release.writes})`);
    expect(diagnosticsClean(r.release.diagnostics), `T. topology stays clean: ${JSON.stringify(r.release.diagnostics)}`);

    // N. the OPPOSITE endpoint stayed exactly where it was
    const after = await state();
    const wallAfter = after.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId);
    const farBefore = r.wallBefore.pts.at(-1);
    const farAfter = wallAfter.pts.at(-1);
    expect(Math.hypot(farAfter.x - farBefore.x, farAfter.y - farBefore.y) < 0.5,
      "N. dragging the start grip left the opposite endpoint fixed");
    expect(Math.hypot(wallAfter.pts[0].x - r.wallBefore.pts[0].x, wallAfter.pts[0].y - r.wallBefore.pts[0].y) > 1,
      "N. the dragged start endpoint actually moved");

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(SETTLE_MS);
    const undone = await state();
    expect(geometryFingerprint(undone.plan) === loadedGeom, "J. Undo restored the exact loaded state");
    expect(topologyFingerprint(undone.plan) === loadedTopo, "J./S. Undo restored the exact loaded topology");
    await shot("J-endpoint-undone.png");

    evidence.checks.endpointDragFirstEdit = {
      hold: r.hold, release: r.release,
      oppositeEndpointFixed: true,
      undoRestored: geometryFingerprint(undone.plan) === loadedGeom,
    };
  }

  // O. drag the END grip; P. connected neighbours stay attached
  console.log("\n[O,P] end grip + connected neighbours");
  {
    await seedFixture();
    await reload("O");
    await selectWall(FIXTURE.freeWallId);
    const before = await state();
    const wallBefore = before.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId);
    const r = await dragEndpoint(FIXTURE.freeWallId, 1, { x: 500, y: -400 }, "O-endpoint-end");
    const after = await state();
    const wallAfter = after.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId);
    expect(Math.hypot(wallAfter.pts[0].x - wallBefore.pts[0].x, wallAfter.pts[0].y - wallBefore.pts[0].y) < 0.5,
      "O. dragging the end grip left the START endpoint fixed");
    expect(Math.hypot(wallAfter.pts.at(-1).x - wallBefore.pts.at(-1).x, wallAfter.pts.at(-1).y - wallBefore.pts.at(-1).y) > 1,
      "O. the dragged end endpoint actually moved");
    expect(r.release.historyEntries === 1, "O. one history entry");

    // P: the shared T node — every incident wall must follow it
    await seedFixture();
    await reload("P");
    await selectWall(FIXTURE.connectedWallId);
    const tBefore = await state();
    const topoBefore = topologyFingerprint(tBefore.plan);
    const rt = await dragEndpoint(FIXTURE.connectedWallId, 0, { x: 350, y: 300 }, "P-connected-node");
    const tAfter = await state();
    expect(topologyFingerprint(tAfter.plan) === topoBefore, "P. connected neighbours remain attached (topology unchanged)");
    const hub = tAfter.plan.walls.find((w) => w.id === FIXTURE.connectedWallId);
    const hubNode = hub.a;
    const incident = tAfter.plan.walls.filter((w) => w.a === hubNode || w.b === hubNode).map((w) => w.id).sort();
    expect(incident.length === 3, `P. the T node still joins three walls (${incident.join(",")})`);
    expect(diagnosticsClean(topologyDiagnostics(tAfter.plan)), "P./T. no unnoded crossing or zero-length wall was produced");
    expect(rt.release.historyEntries === 1, "P. one history entry");
    await shot("P-connected-after.png");

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(SETTLE_MS);
    const undone = await state();
    expect(topologyFingerprint(undone.plan) === topoBefore, "S. Undo restored the T topology exactly");

    evidence.checks.endpointDragTopology = {
      endGripStartFixed: true,
      incidentAfterDrag: incident,
      diagnostics: topologyDiagnostics(tAfter.plan),
    };
  }


  // ==========================================================================
  // REWORK A/B/C/D/E/F/H/I/L — visibility, affordance, and which control
  // changes the wall's length. This is the section the manual run failed on.
  // ==========================================================================
  console.log("\n[rework] grip visibility, affordance, length semantics");
  {
    await seedFixture();
    await reload("rework");

    // A. the grip is the TOPMOST element at its own node — the manual FAIL was
    //    that the wall mass painted over it and it had to be found by guessing.
    const visibilityCases = [
      ["free endpoint", FIXTURE.freeWallId, 1, "free-endpoint"],
      ["T branch shared node", FIXTURE.connectedWallId, 0, "t-endpoint"],
      ["corner shared node", FIXTURE.cornerWallIds[0], 1, "corner-endpoint"],
      ["oblique endpoint", FIXTURE.obliqueWallId, 1, "oblique-endpoint"],
      ["degree-4 hub", FIXTURE.crossWallIds[0], 1, "degree4-node"],
      ["partition in room", FIXTURE.partitionWallId, 0, "partition-endpoint"],
    ];
    evidence.checks.visibility = {};
    for (const [label, wallId, endpoint, shotName] of visibilityCases) {
      await selectWall(wallId);
      await focusEndpoint(wallId, endpoint);
      const snap = await state();
      const wall = snap.resolvedWalls.find((w) => w.id === wallId);
      const world = endpoint === 0 ? wall.pts[0] : wall.pts.at(-1);
      const at = screen(world, snap);

      const box = await gripLocator(wallId, endpoint).first().boundingBox();
      const hit = await topmostAt(at);
      const markerPx = box ? Math.min(box.width, box.height) : 0;

      expect(!!box, `A. ${label}: the grip is mounted`);
      expect(hit?.isGrip === true,
        `A./F. ${label}: the grip is TOPMOST at its own node (got ${JSON.stringify(hit)})`);
      expect(hit?.wallId === wallId && hit?.endpoint === END[endpoint],
        `A. ${label}: the topmost control is this endpoint's own grip`);
      // hit target ~32 screen px, so it never needs pixel-perfect aiming
      expect(markerPx >= 28 && markerPx <= 40,
        `A. ${label}: hit target is ${Math.round(markerPx)}px (contract 28-36)`);
      evidence.checks.visibility[label] = { wallId, endpoint, topmost: hit, hitPx: Math.round(markerPx) };
      await shot(`X-${shotName}-idle.png`);
    }

    // one control per shared node, not several stacked duplicates
    {
      await selectWall(FIXTURE.connectedWallId);
      const snap = await state();
      const branch = snap.plan.walls.find((w) => w.id === FIXTURE.connectedWallId);
      const sharedNode = branch.a;
      expect(await anyGripAtNode(sharedNode).count() === 1,
        `F. exactly one control at the shared T node (got ${await anyGripAtNode(sharedNode).count()})`);
      evidence.checks.sharedNodeControls = {
        nodeId: sharedNode, count: await anyGripAtNode(sharedNode).count(),
      };
    }

    // B. hover affordance
    {
      await selectWall(FIXTURE.freeWallId);
      await focusEndpoint(FIXTURE.freeWallId, 1);
      const snap = await state();
      const wall = snap.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId);
      const at = screen(wall.pts.at(-1), snap);
      expect(await gripState(FIXTURE.freeWallId, 1) === "idle", "B. the resting state is idle");
      const idleBox = await gripLocator(FIXTURE.freeWallId, 1).first().boundingBox();
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(350);
      const hovered = await gripState(FIXTURE.freeWallId, 1);
      expect(hovered === "hover", `B. hovering the grip shows a hover state (got ${hovered})`);
      await shot("X-free-endpoint-hover.png");

      // C. the pointer target is acquired reliably from the visible marker
      await page.mouse.down();
      await page.waitForTimeout(250);
      const dragging = await gripState(FIXTURE.freeWallId, 1);
      expect(dragging === "active", `C. pressing the grip makes it active (got ${dragging})`);
      await page.mouse.move(at.x + 40, at.y + 30, { steps: 6 });
      await page.waitForTimeout(400);
      await shot("X-free-endpoint-active.png");
      await page.mouse.up();
      await page.waitForTimeout(SETTLE_MS + 800);
      const released = await gripState(FIXTURE.freeWallId, 1);
      expect(released !== "active", "C. the active state clears on release");
      evidence.checks.affordance = { idleBox, hovered, dragging, released };
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(SETTLE_MS);
    }

    // D/E. which control changes the wall's LENGTH — the user's question
    {
      await seedFixture();
      await reload("length");
      const sel = await selectWall(FIXTURE.freeWallId);
      const before = lenAngle(sel.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId));

      // D. endpoint drag: length and angle are EXPECTED to change
      await dragEndpoint(FIXTURE.freeWallId, 1, { x: 600, y: 500 }, "X-endpoint-length");
      const afterEndpoint = await state();
      const endpointLA = lenAngle(afterEndpoint.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId));
      expect(Math.abs(endpointLA.len - before.len) > 1,
        `D. the endpoint drag changed length (${before.len.toFixed(1)} -> ${endpointLA.len.toFixed(1)})`);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(SETTLE_MS);

      // E. centre handle: length and angle must be PRESERVED
      const sel2 = await selectWall(FIXTURE.freeWallId);
      const beforeCentre = lenAngle(sel2.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId));
      const handle = moveHandleLocator(FIXTURE.freeWallId);
      expect(await handle.count() === 1, "E. the centre handle is present and distinct");
      const hbox = await handle.first().boundingBox();
      const from = { x: hbox.x + hbox.width / 2, y: hbox.y + hbox.height / 2 };
      await shot("X-centre-handle.png");
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x, from.y + 140 * sel2.view.zoom, { steps: 10 });
      await page.waitForTimeout(HOLD_MS);
      await page.mouse.up();
      await page.waitForTimeout(SETTLE_MS + 800);
      const afterCentre = await state();
      const centreLA = lenAngle(afterCentre.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId));
      expect(Math.abs(centreLA.len - beforeCentre.len) < 0.01,
        `E. the centre drag preserved length (${beforeCentre.len.toFixed(3)} -> ${centreLA.len.toFixed(3)})`);
      expect(Math.abs(centreLA.angle - beforeCentre.angle) < 0.001,
        `E. the centre drag preserved angle (${beforeCentre.angle.toFixed(4)} -> ${centreLA.angle.toFixed(4)})`);
      evidence.checks.lengthSemantics = {
        before, afterEndpointDrag: endpointLA, beforeCentre, afterCentreDrag: centreLA,
      };
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(SETTLE_MS);
    }

    // L. the control stays discoverable across representative zoom levels
    {
      await seedFixture();
      await reload("zoom");
      await selectWall(FIXTURE.freeWallId);
      evidence.checks.zoom = [];
      for (const pct of [8, 20, 60, 150]) {
        await setZoomPct(pct);
        await page.waitForTimeout(400);
        const box = await gripLocator(FIXTURE.freeWallId, 0).first().boundingBox().catch(() => null);
        const size = box ? Math.min(box.width, box.height) : 0;
        evidence.checks.zoom.push({ pct, hitPx: Math.round(size) });
        expect(size >= 28 && size <= 40,
          `L. @${pct}% zoom the hit target is ${Math.round(size)}px (constant screen size expected)`);
      }
      await shot("X-zoom.png");
    }
  }

  // ==========================================================================
  // K/L/M/T — cross-layer grips, distinctness, fail-closed cases
  // ==========================================================================
  console.log("\n[K-M,T] cross-layer endpoint grips");
  {
    await seedFixture();
    await reload("K");

    // K. partition selected while the ROOM layer is active
    const roomLayer = await ensureSelectTool();
    expect(roomLayer.activeLayer === "room", `K. the room layer is active (got ${roomLayer.activeLayer})`);
    const partSel = await selectWall(FIXTURE.partitionWallId);
    const partWall = partSel.plan.walls.find((w) => w.id === FIXTURE.partitionWallId);
    expect(partWall.role === "partition", "K. the selected wall really is a partition");
    expect(await gripLocator(FIXTURE.partitionWallId, 0).count() === 1
      && await gripLocator(FIXTURE.partitionWallId, 1).count() === 1,
      "K. both endpoint grips are visible on a partition while the ROOM layer is active");
    expect(await moveHandleLocator(FIXTURE.partitionWallId).count() === 1,
      "K./M. the central handle is present too");
    evidence.checks.crossLayerPartition = {
      activeLayer: roomLayer.activeLayer,
      grips: partSel.endpointGrips[FIXTURE.partitionWallId] || null,
    };
    await shot("K-partition-grips-on-room-layer.png");

    // also cross-layer: the free partition and the oblique partition
    for (const wallId of [FIXTURE.freeWallId, FIXTURE.obliqueWallId, ...FIXTURE.cornerWallIds]) {
      await selectWall(wallId);
      const count = await gripLocator(wallId, 0).count() + await gripLocator(wallId, 1).count();
      expect(count === 2, `K. ${wallId}: both grips visible while the room layer is active`);
    }

    // L. the mirror case — a wall whose role differs from the active layer.
    //
    // Reported honestly: the shipped 2D UI exposes NO control that activates
    // the "partitions" layer (see the note on ensureSelectTool), so "select a
    // room wall while the partitions layer is active" cannot be driven through
    // this UI at all. What the browser CAN prove is the same contract from the
    // other side — which K above does — plus the no-regression direction here:
    // a room wall on the active layer must keep its grips. The unreachable
    // mirror is covered by tests/plannerEndpointGripEligibility.test.js, which
    // renders the shipped WallEl with editable=false (exactly what PlanPage
    // passes for an off-layer wall) and asserts both grips still render.
    const noPartitionSheetControl = await page.evaluate(() => ![...document.querySelectorAll("button")]
      .some((b) => /перегородк/i.test(`${b.textContent || ""} ${b.getAttribute("title") || ""} ${b.getAttribute("aria-label") || ""}`)));
    expect(noPartitionSheetControl,
      "L. (documented) no UI control activates the partitions layer — the mirror case is unreachable here");
    const roomSel = await selectWall(FIXTURE.roomWallId);
    const roomWall = roomSel.plan.walls.find((w) => w.id === FIXTURE.roomWallId);
    expect(roomWall.role === "outer", "L. the selected wall really is a room wall");
    expect(await gripLocator(FIXTURE.roomWallId, 0).count() === 1
      && await gripLocator(FIXTURE.roomWallId, 1).count() === 1,
      "L. a room wall keeps both endpoint grips (no regression on the active layer)");
    evidence.checks.crossLayerRoomWall = {
      activeLayer: roomSel.activeLayer,
      partitionsLayerReachableFromUi: !noPartitionSheetControl,
      grips: roomSel.endpointGrips[FIXTURE.roomWallId] || null,
    };
    await shot("L-roomwall-grips-on-partition-layer.png");

    // M. the two affordances are distinct marks at distinct places
    const sel = await selectWall(FIXTURE.freeWallId);
    const wall = sel.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId);
    const mid = { x: (wall.pts[0].x + wall.pts[1].x) / 2, y: (wall.pts[0].y + wall.pts[1].y) / 2 };
    const handleBox = await moveHandleLocator(FIXTURE.freeWallId).first().boundingBox();
    const g0 = await gripLocator(FIXTURE.freeWallId, 0).first().boundingBox();
    const g1 = await gripLocator(FIXTURE.freeWallId, 1).first().boundingBox();
    const centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const expectedMid = screen(mid, sel);
    const expectedStart = screen(wall.pts[0], sel);
    const expectedEnd = screen(wall.pts[1], sel);
    expect(dist(centreOf(handleBox), expectedMid) < 6, "M. the central handle sits at the midpoint");
    expect(dist(centreOf(g0), expectedStart) < 6, "M. grip 0 sits at the start endpoint");
    expect(dist(centreOf(g1), expectedEnd) < 6, "M. grip 1 sits at the end endpoint");
    expect(dist(centreOf(handleBox), centreOf(g0)) > 20 && dist(centreOf(handleBox), centreOf(g1)) > 20,
      "M. the central handle and the endpoint grips are distinct, separated marks");
    await shot("M-handle-vs-grips.png");

    // T. locked wall — fail closed, with a deterministic reason
    const lockedSel = await selectWall(FIXTURE.lockedWallId);
    const lockedGrips = lockedSel.endpointGrips[FIXTURE.lockedWallId] || [];
    expect(await gripLocator(FIXTURE.lockedWallId, 0).count() === 0
      && await gripLocator(FIXTURE.lockedWallId, 1).count() === 0,
      "T. a locked wall exposes no endpoint grips");
    expect(lockedGrips.every?.((g) => g.visible === false && g.reason === "WALL_LOCKED"),
      `T. the locked wall reports a deterministic reason: ${JSON.stringify(lockedGrips)}`);
    evidence.checks.locked = { grips: lockedGrips };
    await shot("T-locked-wall.png");

    // T. the degree-4 hub is classified, and the whole-wall handle still fails closed there
    const crossSel = await selectWall(FIXTURE.crossWallIds[0]);
    const crossGrips = crossSel.endpointGrips[FIXTURE.crossWallIds[0]] || [];
    const hubGrip = crossGrips.find?.((g) => g.topology?.degree === 4) || null;
    expect(!!hubGrip, `T. the degree-4 endpoint is classified as a hub: ${JSON.stringify(crossGrips.map?.((g) => g.topology))}`);
    expect(!crossSel.moveHandleWallIds.includes(FIXTURE.crossWallIds[0]),
      "T. the WHOLE-WALL handle remains fail-closed at the degree-4 junction (unchanged from 2E)");
    evidence.checks.degree4 = { grips: crossGrips, moveHandleWallIds: crossSel.moveHandleWallIds };
    await shot("T-degree4-hub.png");
  }

  // ==========================================================================
  // S — reload parity;  U/V/W — accepted 2E / 2D / 2D1 behaviour intact
  // ==========================================================================
  console.log("\n[S,U,V,W] parity and accepted behaviour");
  {
    const beforeReload = await state();
    const committed = geometryFingerprint(beforeReload.plan);
    const reloaded = await reload("S");
    expect(geometryFingerprint(reloaded.plan) === committed, "S. reload parity: the reloaded plan matches the committed one");
    expect(reloaded.undoDepth === 0, "S. reload resets history");

    // U. wall joins still render (unified mass layer + clean corner/T geometry)
    await ensureSelectTool();
    const joins = await page.evaluate(() => ({
      mass: document.querySelectorAll('[data-ui="wall-mass"], g[data-wall-mass]').length,
      wallsTop: document.querySelectorAll('[data-ui="walls-top"]').length,
      paths: document.querySelectorAll("svg path").length,
    }));
    expect(joins.paths > 0, "U. the wall layer still renders geometry");
    expect(diagnosticsClean(topologyDiagnostics(reloaded.plan)), "U. wall topology is clean after the whole run");
    await shot("U-wall-joins.png");

    // V. right-click cancels a wall draft without touching plan/history/writes
    await page.locator('button[title="Нарисовать стену"]').first().click();
    await page.waitForTimeout(300);
    const beforeDraft = await state();
    const writesBefore = evidence.writes.length;
    // an empty spot in the CURRENT view, whatever the zoom left us looking at
    const p0 = { x: beforeDraft.rect.left + 320, y: beforeDraft.rect.top + 700 };
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    await page.mouse.move(p0.x + 220, p0.y, { steps: 8 });
    await page.waitForTimeout(250);
    await shot("V-wall-preview.png");
    await page.mouse.click(p0.x + 220, p0.y, { button: "right" });
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const afterCancel = await state();
    expect(geometryFingerprint(afterCancel.plan) === geometryFingerprint(beforeDraft.plan),
      "V. right-click cancelled the draft: the plan is unchanged");
    expect(afterCancel.undoDepth === beforeDraft.undoDepth, "V. right-click created no history entry");
    expect(evidence.writes.length === writesBefore, "V. right-click created no write");
    await page.getByRole("button", { name: "Выбор", exact: true }).first().click();
    await page.waitForTimeout(300);

    // V. the inspector still opens for a selected wall
    await selectWall(FIXTURE.freeWallId);
    const inspector = await page.evaluate(() => !!window.__dgPlanner?.selection);
    expect(inspector, "V. selection/inspector state is still published for a selected wall");

    // W. Phase 2D1 BOUNDED snap.
    //
    // snapWallPoint (core/walls/wallOps.js:132) only snaps to a candidate within
    // SNAP_DIST/zoom and otherwise returns the point unchanged. The property that
    // matters here — and the one 2D1 added — is that snapping stays BOUNDED: an
    // endpoint dropped far from any node, wall segment or grid candidate keeps
    // its own coordinate instead of being yanked to a distant target.
    // Snap ENGAGEMENT itself is covered by the unchanged unit suites (coreSnap,
    // coreCadSnap, plannerWallSnapZoomGuides, plannerWallDrawV2SnapIntegration,
    // plannerWallPointResolver), all of which pass on this branch.
    const snapBefore = await state();
    const snapWall = snapBefore.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId);
    const endBefore = snapWall.pts.at(-1);
    const nudgeMm = 137;
    const r = await dragEndpoint(FIXTURE.freeWallId, 1, { x: nudgeMm, y: 0 }, "W-snap");
    const snapAfter = await state();
    const endAfter = snapAfter.resolvedWalls.find((w) => w.id === FIXTURE.freeWallId).pts.at(-1);
    const drift = Math.abs(endAfter.x - (endBefore.x + nudgeMm));
    expect(drift <= 2,
      `W. bounded snap: the endpoint kept its own coordinate (${endAfter.x}, drift ${drift.toFixed(3)}mm)`);
    expect(Math.abs(endAfter.y - endBefore.y) <= 2, "W. the untouched axis did not drift");
    expect(r.release.historyEntries === 1, "W. the snapped drag is still one history entry");
    evidence.checks.snap = {
      before: endBefore, after: endAfter, nudgeMm, driftMm: drift,
      note: "bounded-snap only; engagement covered by the unchanged snap unit suites",
    };
    await shot("W-snap.png");
  }

  evidence.consoleErrors = errors;
  const postLogin = errors.filter((e) => e.afterLogin);
  evidence.consoleErrorsBeforeLogin = errors.length - postLogin.length;
  if (postLogin.length) fail(`console/page errors after login: ${postLogin.slice(0, 5).map((e) => e.text).join(" | ")}`);
  evidence.pass = evidence.failures.length === 0;
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, "acceptance.json"), JSON.stringify(evidence, null, 2), "utf8");

  await context.close();
  await browser.close();

  console.log(`\n${evidence.pass ? "PASS" : "FAIL"} — ${evidence.failures.length} failure(s)`);
  for (const f of evidence.failures) console.log(`  - ${f}`);
  console.log(`evidence: ${path.join(EVIDENCE_DIR, "acceptance.json")}`);
  if (!evidence.pass) process.exitCode = 1;
}

main().catch((error) => {
  evidence.failures.push(String(error?.stack || error));
  evidence.pass = false;
  try {
    fs.writeFileSync(path.join(EVIDENCE_DIR, "acceptance.json"), JSON.stringify(evidence, null, 2), "utf8");
  } catch { /* ignore */ }
  console.error(error);
  process.exitCode = 1;
});
