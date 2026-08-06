/**
 * B+ PHASE 2B2 ACCEPTANCE — bounded snap resolver on the V2 wall path.
 *
 * Matrix A-L: zoom stability, node / wall-endpoint / wall-body snapping,
 * far-node and high-zoom rejection, close-wall-beats-far-node, near miss,
 * Alt bypass, Shift angle, transaction boundary, and the 20-gesture
 * regression. Every case records the raw pointer point, the resolved point,
 * the resolver metadata, and the committed geometry, so a failure is
 * diagnosable from evidence alone.
 *
 * Requires the dev server to expose the seam and the V2 path:
 *   VITE_DG_PLANNER_E2E=1  VITE_DG_PLANNER_WALL_DRAW_V2=1
 *
 * Hardened rules (same contract as the other tracked acceptance scripts):
 * - No default admin key, project id, base or api URL — all fail closed.
 * - BASE/API must be http:// on localhost / 127.0.0.1 / ::1.
 * - EVIDENCE_DIR must be absolute and outside the repository root.
 * - The script never creates or deletes projects; it uses REVIEW_PROJECT_ID,
 *   which must be a disposable local project.
 * - Real browser mouse events only; the plan is never mutated from page JS.
 * - No secret is written to evidence.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function assertLocalUrl(name, value) {
  const u = new URL(value);
  if (u.protocol !== "http:") throw new Error(`${name} must use http:, got ${u.protocol}`);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(u.hostname)) {
    throw new Error(`${name} must be local, got ${u.hostname}`);
  }
}

const BASE = requireEnv("REVIEW_BASE").replace(/\/$/, "");
const API = requireEnv("REVIEW_API").replace(/\/$/, "");
assertLocalUrl("REVIEW_BASE", BASE);
assertLocalUrl("REVIEW_API", API);
const ADMIN_KEY = requireEnv("REVIEW_ADMIN_KEY");
const PROJECT_ID = requireEnv("REVIEW_PROJECT_ID");
const EVIDENCE_DIR = requireEnv("EVIDENCE_DIR");
if (!path.isAbsolute(EVIDENCE_DIR)) throw new Error("EVIDENCE_DIR must be an absolute path");
const rel = path.relative(REPO_ROOT, EVIDENCE_DIR);
if (!rel.startsWith("..") && rel !== "") throw new Error("EVIDENCE_DIR must be outside the repository root");

const SHOTS = path.join(EVIDENCE_DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const HOLD_MS = Number(process.env.HOLD_MS || 1400);
const SETTLE_MS = Number(process.env.SETTLE_MS || 2500);
const MAX_DISTANCE_PX = Number(process.env.WALL_POINT_MAX_DISTANCE_PX || 12);

const maskId = (id) => (typeof id === "string" && id.length > 4 ? `${id.slice(0, 2)}***${id.slice(-2)}` : "***");
const maskTopologyMeta = (meta) => (meta ? {
  ...meta,
  nodeId: meta.nodeId ? maskId(meta.nodeId) : null,
  wallId: meta.wallId ? maskId(meta.wallId) : null,
  hostWallId: meta.hostWallId ? maskId(meta.hostWallId) : null,
} : null);
const PLAN_SAVE_PATH = `/api/projects/${encodeURIComponent(PROJECT_ID)}`;
const WRITE_ORIGINS = new Set([new URL(BASE).origin, new URL(API).origin]);
const maskUrl = (u) => String(u).replace(PROJECT_ID, maskId(PROJECT_ID));

/** Counts only the canonical plan save for this project (direct or proxied). */
function isPlanSave(request) {
  const m = request.method();
  if (m !== "PATCH" && m !== "PUT") return false;
  let url;
  try { url = new URL(request.url()); } catch { return false; }
  return WRITE_ORIGINS.has(url.origin) && url.pathname === PLAN_SAVE_PATH;
}

/* ------------------------- canonical fingerprint ------------------------- */
function polygonArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a) / 2;
}
function normalizePolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return [];
  const r = poly.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  if (r.length > 1 && r[0].x === r[r.length - 1].x && r[0].y === r[r.length - 1].y) r.pop();
  if (r.length < 3) return r;
  let s = 0;
  for (let i = 1; i < r.length; i++) {
    if (r[i].y < r[s].y || (r[i].y === r[s].y && r[i].x < r[s].x)) s = i;
  }
  const rot = [...r.slice(s), ...r.slice(0, s)];
  let signed = 0;
  for (let i = 0; i < rot.length; i++) {
    const j = (i + 1) % rot.length;
    signed += rot[i].x * rot[j].y - rot[j].x * rot[i].y;
  }
  if (signed < 0) rot.reverse();
  return rot;
}
/** Geometry only, relative to the shape's own origin — comparable across runs. */
function shapeFingerprint(plan, origin = { x: 0, y: 0 }) {
  const nodes = Object.values(plan?.nodes || {})
    .map((n) => ({ x: Math.round(n.x - origin.x), y: Math.round(n.y - origin.y) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const walls = (plan?.walls || [])
    .filter((w) => w.a && w.b && plan.nodes?.[w.a] && plan.nodes?.[w.b])
    .map((w) => {
      const a = plan.nodes[w.a];
      const b = plan.nodes[w.b];
      const p = [
        { x: Math.round(a.x - origin.x), y: Math.round(a.y - origin.y) },
        { x: Math.round(b.x - origin.x), y: Math.round(b.y - origin.y) },
      ].sort((m, n) => m.x - n.x || m.y - n.y);
      return { a: p[0], b: p[1], thk: w.thk ?? 100 };
    })
    .sort((m, n) => m.a.x - n.a.x || m.a.y - n.a.y || m.b.x - n.b.x || m.b.y - n.b.y);
  const rooms = (plan?.rooms || [])
    .map((r) => Math.round(r.area != null ? r.area : polygonArea(r.polygon)))
    .sort((a, b) => a - b);
  return JSON.stringify({ nodes, walls, rooms });
}
function planFingerprint(plan) {
  const nodes = Object.entries(plan?.nodes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => ({ id, x: Math.round(n.x), y: Math.round(n.y) }));
  const walls = (plan?.walls || [])
    .filter((w) => w.a && w.b)
    .map((w) => ({ id: w.id, a: w.a, b: w.b, thk: w.thk ?? 100 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const rooms = (plan?.rooms || [])
    .map((r) => ({ area: Math.round(r.area != null ? r.area : polygonArea(r.polygon)), polygon: normalizePolygon(r.polygon) }))
    .filter((r) => r.polygon.length >= 3)
    .sort((a, b) => a.area - b.area);
  return JSON.stringify({ nodes, walls, rooms });
}
const fingerprintDigest = (fingerprint) => createHash("sha256").update(fingerprint).digest("hex");
function countDiagonals(walls) {
  const EPS = 3;
  return (walls || []).filter((w) => {
    if (!w.pts || w.pts.length < 2) return false;
    const a = w.pts[0];
    const b = w.pts[w.pts.length - 1];
    return Math.abs(b.x - a.x) > EPS && Math.abs(b.y - a.y) > EPS;
  });
}
function countOrphanNodes(nodes, walls) {
  return Object.keys(nodes || {}).filter((id) => (walls || []).every((w) => w.a !== id && w.b !== id));
}

async function apiPlan() {
  const res = await fetch(`${API}/api/projects/${PROJECT_ID}`, { headers: { "X-Admin-Key": ADMIN_KEY } });
  if (!res.ok) throw new Error(`GET project failed: ${res.status}`);
  const d = await res.json();
  return d.plan || d.project?.plan || {};
}

const ev = {
  acceptanceKind: "b-plus-wall-snap-v2",
  branch: "", head: "",
  baseUrl: BASE, apiUrl: API, projectIdMask: maskId(PROJECT_ID),
  maxDistancePx: MAX_DISTANCE_PX, holdMs: HOLD_MS,
  cases: {}, screenshots: [], networkWrites: [], isolations: [],
  consoleErrors: [], backendErrors: [], failures: [],
  startedAt: new Date().toISOString(), finishedAt: null, pass: false,
};
try { ev.branch = execSync("git branch --show-current", { encoding: "utf8" }).trim(); } catch {}
try { ev.head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch {}

let writeCount = 0;
const fail = (m) => { ev.failures.push(m); console.log(`  FAIL: ${m}`); };
const ok = (m) => console.log(`  ok: ${m}`);
const round = (p) => (p ? { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 } : null);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();

  page.on("console", (m) => { if (m.type() === "error") ev.consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => ev.consoleErrors.push(String(e)));
  page.on("response", (r) => {
    if (WRITE_ORIGINS.has(new URL(r.url()).origin) && r.status() >= 400) {
      ev.backendErrors.push({ status: r.status(), method: r.request().method(), url: maskUrl(r.url()) });
    }
  });
  page.on("request", (r) => {
    if (isPlanSave(r)) {
      writeCount += 1;
      ev.networkWrites.push({ at: Date.now(), method: r.method(), url: maskUrl(r.url()) });
    }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(ADMIN_KEY);
  const loginAccepted = page.waitForResponse((r) => {
    try { return new URL(r.url()).pathname === "/api/admin/settings" && r.status() === 200; } catch { return false; }
  }, { timeout: 20000 });
  await page.locator("form button").first().click();
  await loginAccepted;
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  // LoginPage navigates and then calls location.reload(); wait until that
  // second navigation has fully settled before starting the project goto.
  await page.waitForTimeout(500);
  await page.waitForLoadState("networkidle", { timeout: 20000 });
  await page.goto(`${BASE}/project/${PROJECT_ID}/plan`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });

  const state = () => page.evaluate(() => {
    const d = window.__dgPlanner;
    const p = d.plan || {};
    const walls = d.resolvedWalls?.length ? d.resolvedWalls : (p.walls || []);
    return {
      tool: d.tool, draftLen: d.draftLen, v2: d.wallDrawV2 || null,
      canUndo: d.canUndo, canRedo: d.canRedo,
      view: { panX: d.view.panX, panY: d.view.panY, zoom: d.view.zoom },
      rect: { left: d.svgRect.left, top: d.svgRect.top, w: d.svgRect.width, h: d.svgRect.height },
      wallCount: walls.length,
      nodes: p.nodes || {},
      walls: walls.map((w) => ({ id: w.id, a: w.a, b: w.b, pts: (w.pts || []).map((q) => ({ x: q.x, y: q.y })) })),
      plan: { nodes: p.nodes || {}, walls: (p.walls || []).map((w) => ({ id: w.id, a: w.a, b: w.b, thk: w.thk })), rooms: p.rooms || [] },
      rooms: p.rooms || [],
    };
  });

  const boot = await state();
  if (!boot.v2?.enabled) {
    throw new Error("VITE_DG_PLANNER_WALL_DRAW_V2=1 is not active — refusing to run a V2 snap acceptance against the legacy path");
  }
  ok("V2 drag-release path is active");

  const w2s = async (mx, my) => {
    const s = await state();
    return { x: s.rect.left + s.view.panX + mx * s.view.zoom, y: s.rect.top + s.view.panY + my * s.view.zoom };
  };
  const shot = async (n) => { await page.screenshot({ path: path.join(SHOTS, n) }); ev.screenshots.push(n); };

  await page.getByRole("button", { name: "Стены", exact: true }).first().click();
  await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 10000 });
  await page.evaluate(() => document.activeElement?.blur?.());

  /** Wheel to a target zoom band and report the zoom actually reached. */
  async function zoomTo(target) {
    const s0 = await state();
    await page.mouse.move(s0.rect.left + s0.rect.w / 2, s0.rect.top + s0.rect.h / 2);
    for (let i = 0; i < 160; i++) {
      const c = await state();
      const tolerance = target >= 2.5 ? 0.03 : 0.15;
      if (Math.abs(c.view.zoom - target) / target <= tolerance) break;
      await page.mouse.wheel(0, c.view.zoom < target ? -120 : 120);
      await page.waitForTimeout(25);
    }
    return (await state()).view.zoom;
  }

  /**
   * World point that currently sits `px` from the canvas top-left. Every case
   * derives its geometry from the CURRENT view, because zooming also pans:
   * reusing world coordinates picked at another zoom puts them off-screen and
   * the gesture silently misses the canvas.
   */
  async function visibleOrigin(px = 260) {
    const s = await state();
    const snap = (v) => Math.round(v / 50) * 50;
    return {
      x: snap((px - s.view.panX) / s.view.zoom),
      y: snap((px - s.view.panY) / s.view.zoom),
      zoom: s.view.zoom,
      rect: s.rect,
    };
  }

  /** Guard: a gesture that lands outside the canvas proves nothing. */
  async function assertOnScreen(worldPts, label) {
    const s = await state();
    for (const p of worldPts) {
      const sp = { x: s.rect.left + s.view.panX + p.x * s.view.zoom, y: s.rect.top + s.view.panY + p.y * s.view.zoom };
      const inside = sp.x >= s.rect.left + 4 && sp.x <= s.rect.left + s.rect.w - 4
        && sp.y >= s.rect.top + 4 && sp.y <= s.rect.top + s.rect.h - 4;
      if (!inside) {
        fail(`${label}: point (${Math.round(p.x)},${Math.round(p.y)}) is off-canvas at zoom ${s.view.zoom.toFixed(3)}`);
        return false;
      }
    }
    return true;
  }

  /** Prove browser and persisted state are empty before the next isolated case. */
  async function clearAll() {
    const empty = (s) => s.wallCount === 0
      && Object.keys(s.nodes).length === 0
      && s.rooms.length === 0;
    const record = { startedAt: Date.now(), attempts: [] };

    for (let attempt = 1; attempt <= 3; attempt++) {
      // Prefer history: it is the same user-visible mechanism used by K.
      for (let i = 0; i < 80; i++) {
        const s = await state();
        if (empty(s) || !s.canUndo) break;
        await page.keyboard.press("Control+z");
        await page.waitForTimeout(160);
      }

      // Reload resets local history. In that state, use the supported erase UI
      // against each remaining wall instead of silently accepting dirty state.
      let current = await state();
      if (!empty(current) && current.wallCount > 0 && !current.canUndo) {
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press("Delete");
        await page.waitForFunction(() => window.__dgPlanner?.tool === "erase", null, { timeout: 10000 });
        for (let i = 0; i < 80; i++) {
          current = await state();
          const wall = current.walls[0];
          if (!wall) break;
          const a = wall.pts?.[0], b = wall.pts?.[wall.pts.length - 1];
          if (!a || !b) break;
          const mid = await w2s((a.x + b.x) / 2, (a.y + b.y) / 2);
          await page.mouse.click(mid.x, mid.y);
          await page.waitForTimeout(180);
        }
      }

      await page.waitForTimeout(SETTLE_MS);
      current = await state();
      const api = await apiPlan();
      const browserFp = planFingerprint(current.plan);
      const apiFp = planFingerprint(api);
      record.attempts.push({
        attempt, walls: current.wallCount, nodes: Object.keys(current.nodes).length,
        rooms: current.rooms.length, browserApiMatch: browserFp === apiFp,
      });
      if (empty(current) && browserFp === apiFp) {
        record.finishedAt = Date.now();
        record.pass = true;
        ev.isolations.push(record);
        await page.getByRole("button", { name: "Стены", exact: true }).first().click().catch(() => {});
        await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 10000 });
        await page.evaluate(() => document.activeElement?.blur?.());
        return current.wallCount;
      }
    }

    record.finishedAt = Date.now();
    record.pass = false;
    ev.isolations.push(record);
    throw new Error(`clearAll failed closed: ${JSON.stringify(record.attempts)}`);
  }

  /** One drag-release; samples the resolver metadata at press and at release. */
  async function drag(from, to, label, { expectedWallDelta = null } = {}) {
    const before = await state();
    const a = await w2s(from.x, from.y);
    const b = await w2s(to.x, to.y);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    const atPress = await state();
    await page.mouse.move(a.x + (b.x - a.x) * 0.4, a.y + (b.y - a.y) * 0.4, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    const atRelease = await state();
    await page.mouse.up();
    await page.waitForTimeout(260);
    const after = await state();
    const band = atRelease.v2?.preview || null;
    return {
      label,
      requested: { from: round(from), to: round(to) },
      startSnap: maskTopologyMeta(band?.startSnap || atPress.v2?.preview?.startSnap || null),
      endSnap: maskTopologyMeta(band?.endSnap || null),
      startIntent: maskTopologyMeta(atRelease.v2?.intents?.start || null),
      endIntent: maskTopologyMeta(atRelease.v2?.intents?.end || null),
      previewStart: round(band?.start),
      previewEnd: round(band?.end),
      wallsBefore: before.wallCount,
      wallsAfter: after.wallCount,
      expectedWallDelta,
      wallDelta: after.wallCount - before.wallCount,
      addedOne: after.wallCount === before.wallCount + 1,
      idle: after.v2?.active === false,
      toolStillWall: after.tool === "wall",
      after,
    };
  }

  const dragEvidence = (g) => ({
    label: g.label, requested: g.requested,
    previewStart: g.previewStart, previewEnd: g.previewEnd,
    startSnap: g.startSnap, endSnap: g.endSnap,
    startIntent: g.startIntent, endIntent: g.endIntent,
    expectedWallDelta: g.expectedWallDelta, wallDelta: g.wallDelta,
    wallsBefore: g.wallsBefore, wallsAfter: g.wallsAfter,
    idle: g.idle, toolStillWall: g.toolStillWall,
  });

  /** Press, move, sample the live preview, then Escape without committing. */
  async function probe(from, to, label, { modifier = null } = {}) {
    const a = await w2s(from.x, from.y);
    const b = await w2s(to.x, to.y);
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    const atPress = await state();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    const atMove = await state();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    await page.waitForTimeout(200);
    return {
      label,
      raw: { from: round(from), to: round(to) },
      startSnap: maskTopologyMeta(atPress.v2?.preview?.startSnap || null),
      endSnap: maskTopologyMeta(atMove.v2?.preview?.endSnap || null),
      startIntent: maskTopologyMeta(atPress.v2?.intents?.start || null),
      endIntent: maskTopologyMeta(atMove.v2?.intents?.end || null),
      previewEnd: round(atMove.v2?.preview?.end),
    };
  }

  const undoTimes = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(220);
    }
  };

  /* ---------------- A. same gestures at three zooms ---------------- */
  console.log("[A] same gestures at three zoom levels");
  {
    const runs = [];
    // World size chosen so the shape fits the viewport at the highest zoom.
    const W = 1200, H = 800;
    for (const target of [0.08, 0.25, 0.6]) {
      await clearAll();
      const zoom = await zoomTo(target);
      const o = await visibleOrigin(300);
      const corners = [{ x: o.x, y: o.y }, { x: o.x + W, y: o.y }, { x: o.x + W, y: o.y + H }, { x: o.x, y: o.y + H }];
      if (!await assertOnScreen(corners, `A-z${zoom.toFixed(2)}`)) break;
      const gestures = [];
      for (let i = 0; i < 4; i++) {
        gestures.push(await drag(corners[i], corners[(i + 1) % 4], `A-z${zoom.toFixed(2)}-${i}`, { expectedWallDelta: 1 }));
      }
      const after = await state();
      await page.waitForTimeout(SETTLE_MS);
      const apiFingerprint = shapeFingerprint(await apiPlan(), { x: o.x, y: o.y });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
      await page.waitForTimeout(500);
      const reloadFingerprint = shapeFingerprint((await state()).plan, { x: o.x, y: o.y });
      const maxJumpPx = Math.max(0, ...gestures.map((g) => (Number.isFinite(g.endSnap?.distancePx) ? g.endSnap.distancePx : 0)));
      const previewCommitOk = gestures.every((g) => g.wallDelta === g.expectedWallDelta && g.previewEnd);
      runs.push({
        zoom: Math.round(zoom * 1000) / 1000,
        origin: { x: o.x, y: o.y },
        // Topology fingerprint: nodes + walls + thickness, origin-relative.
        // This is the contract PHASE 2B2 owns.
        fingerprint: shapeFingerprint(after.plan, { x: o.x, y: o.y }),
        apiFingerprint,
        reloadFingerprint,
        apiMatches: apiFingerprint === shapeFingerprint(after.plan, { x: o.x, y: o.y }),
        reloadMatches: reloadFingerprint === shapeFingerprint(after.plan, { x: o.x, y: o.y }),
        // Derived room geometry recorded separately (room engine is denylisted
        // for this phase, so a difference here is reported, not silently kept).
        roomPolygons: (after.rooms || []).map((r) => (r.polygon || []).map(
          (p) => ({ x: Math.round(p.x - o.x), y: Math.round(p.y - o.y) }),
        )),
        wallsCreated: after.wallCount,
        rooms: after.rooms.length,
        maxJumpPx: Math.round(maxJumpPx * 100) / 100,
        previewCommitOk,
        endKinds: gestures.map((g) => g.endSnap?.kind || null),
        gestures: gestures.map(dragEvidence),
      });
      await shot(`A-zoom-${zoom.toFixed(2)}.png`);
    }
    const topoSame = runs.length === 3 && new Set(runs.map((r) => r.fingerprint)).size === 1;
    const roomsSame = runs.length === 3 && new Set(runs.map((r) => JSON.stringify(r.roomPolygons))).size === 1;
    ev.cases.A = { runs, sameFingerprint: topoSame, sameRoomPolygons: roomsSame };
    if (runs.length !== 3) fail("A: could not run all three zoom levels");
    if (!topoSame) fail(`A: wall topology differs across zooms ${runs.map((r) => r.zoom).join(", ")}`);
    if (!roomsSame) fail(`A: derived room polygons differ across zooms ${runs.map((r) => r.zoom).join(", ")}`);
    if (runs.some((r) => r.wallsCreated !== 4)) fail(`A: not 4 walls at every zoom: ${runs.map((r) => r.wallsCreated).join(",")}`);
    if (runs.some((r) => r.rooms !== 1)) fail(`A: not 1 room at every zoom: ${runs.map((r) => r.rooms).join(",")}`);
    if (runs.some((r) => r.maxJumpPx > MAX_DISTANCE_PX + 0.5)) fail(`A: jump beyond eligibility: ${runs.map((r) => r.maxJumpPx).join(",")} px`);
    if (runs.some((r) => !r.previewCommitOk)) fail("A: preview/commit mismatch");
    if (runs.some((r) => !r.apiMatches || !r.reloadMatches)) fail("A: browser/API/reload fingerprint mismatch");
    if (topoSame && roomsSame) {
      ok(`A: identical fingerprint at zooms ${runs.map((r) => r.zoom).join(", ")}, max jump ${Math.max(...runs.map((r) => r.maxJumpPx))} px`);
    } else if (topoSame) {
      ok(`A: wall topology identical at zooms ${runs.map((r) => r.zoom).join(", ")} (room polygons differ — see evidence)`);
    }
  }

  /**
   * Build a fresh reference wall in the currently visible area.
   * Every case derives its own geometry, because zoom changes also pan.
   */
  async function reference(zoomTarget, lengthMm, marginPx = 300) {
    await clearAll();
    const zoom = await zoomTo(zoomTarget);
    const o = await visibleOrigin(marginPx);
    const from = { x: o.x, y: o.y };
    const to = { x: o.x + lengthMm, y: o.y };
    if (!await assertOnScreen([from, to], `reference@${zoom.toFixed(2)}`)) return null;
    const g = await drag(from, to, `reference@${zoom.toFixed(2)}`, { expectedWallDelta: 1 });
    if (g.wallDelta !== 1) { fail(`reference wall delta ${g.wallDelta}, expected 1 at zoom ${zoom.toFixed(2)}`); return null; }
    return { zoom, ox: o.x, oy: o.y, from, to, lengthMm };
  }

  /* ---------------- B. node snap ---------------- */
  console.log("[B] node snap");
  {
    const r = await reference(0.12, 4000);
    if (r) {
      const start = { x: r.ox + 4000 + 20, y: r.oy + 20 };
      const end = { x: r.ox + 4000, y: r.oy + 2000 };
      if (await assertOnScreen([start, end], "B")) {
        const g = await drag(start, end, "B-node", { expectedWallDelta: 1 });
        const nodes = Object.keys(g.after.nodes).length;
        ev.cases.B = {
          zoom: r.zoom, startSnap: g.startSnap, previewStart: g.previewStart,
          startIntent: g.startIntent, kind: g.startSnap?.kind,
          connects: g.startSnap?.connects, nodeCount: nodes, wallDelta: g.wallDelta,
        };
        if (!g.addedOne) fail("B: no wall created");
        else if (!["node", "wall-end"].includes(g.startSnap?.kind)) fail(`B: expected node/wall-end, got ${g.startSnap?.kind}`);
        else if (g.startSnap?.connects !== true) fail("B: start reported no topology connection");
        else if (nodes !== 3) fail(`B: expected 3 nodes (shared endpoint), got ${nodes}`);
        else ok(`B: kind=${g.startSnap.kind}, ${nodes} nodes (endpoint shared, no duplicate)`);
        await shot("B-node-snap.png");
      }
    }
  }

  /* ---------------- C. wall endpoint snap ---------------- */
  console.log("[C] wall endpoint snap");
  {
    const r = await reference(0.12, 4000);
    if (r) {
      const start = { x: r.ox - 15, y: r.oy - 15 };
      const end = { x: r.ox, y: r.oy + 2000 };
      if (await assertOnScreen([start, end], "C")) {
        const g = await drag(start, end, "C-endpoint", { expectedWallDelta: 1 });
        const nodes = Object.keys(g.after.nodes).length;
        ev.cases.C = {
          zoom: r.zoom, startSnap: g.startSnap, startIntent: g.startIntent,
          kind: g.startSnap?.kind, nodeCount: nodes, wallDelta: g.wallDelta,
        };
        if (!g.addedOne) fail("C: no wall created");
        else if (!["node", "wall-end"].includes(g.startSnap?.kind)) fail(`C: expected node/wall-end, got ${g.startSnap?.kind}`);
        else if (nodes !== 3) fail(`C: expected 3 nodes (endpoint reused), got ${nodes}`);
        else ok(`C: kind=${g.startSnap.kind}, endpoint reused (${nodes} nodes)`);
        await shot("C-endpoint-snap.png");
      }
    }
  }

  /* ---------------- D. wall body snap ---------------- */
  console.log("[D] wall body snap");
  {
    const r = await reference(0.12, 4000);
    if (r) {
      const before = await state();
      const start = { x: r.ox + 2000, y: r.oy + 30 };
      const end = { x: r.ox + 2000, y: r.oy + 2000 };
      if (await assertOnScreen([start, end], "D")) {
        const g = await drag(start, end, "D-body", { expectedWallDelta: 2 });
        const onCenterline = Math.abs((g.previewStart?.y ?? 1e9) - r.oy) < 0.001;
        const orphans = countOrphanNodes(g.after.nodes, g.after.walls).length;
        ev.cases.D = {
          zoom: r.zoom, startSnap: g.startSnap, kind: g.startSnap?.kind,
          startIntent: g.startIntent, previewStart: g.previewStart,
          hostWallId: g.startSnap?.hostWallId ? "masked-set" : null,
          wallsBefore: before.wallCount, wallsAfter: g.after.wallCount, onCenterline, orphans,
        };
        if (g.startSnap?.kind !== "wall-body") fail(`D: expected wall-body, got ${g.startSnap?.kind}`);
        else if (!g.startSnap?.hostWallId) fail("D: wall-body reported no hostWallId");
        else if (!onCenterline) fail("D: preview start is not exactly on the host centerline");
        else if (g.after.wallCount !== before.wallCount + 2) fail(`D: expected split+branch (+2), got +${g.after.wallCount - before.wallCount}`);
        else if (orphans) fail(`D: ${orphans} orphan node(s) after split`);
        else ok(`D: wall-body on centerline, host split (+${g.after.wallCount - before.wallCount} walls), 0 orphans`);
        await shot("D-body-snap.png");
      }
    }
  }

  /* ---------------- E. far node rejection at overview zoom ---------------- */
  console.log("[E] far node rejection at overview zoom");
  {
    const r = await reference(0.08, 4000);
    if (r) {
      const start = { x: r.ox + 4000, y: r.oy + 1400 };
      const end = { x: r.ox + 5500, y: r.oy + 1400 };
      if (await assertOnScreen([start, end], "E")) {
        const p = await probe(start, end, "E-far-node");
        const k = p.startSnap?.kind;
        ev.cases.E = { zoom: r.zoom, startSnap: p.startSnap, distanceMm: p.startSnap?.distanceMm, distancePx: p.startSnap?.distancePx };
        if (k === "node" || k === "wall-end") fail(`E: a node 1400 mm away captured the start (kind=${k})`);
        else if (Number.isFinite(p.startSnap?.distancePx) && p.startSnap.distancePx > MAX_DISTANCE_PX + 0.5) {
          fail(`E: displacement ${p.startSnap.distancePx} px exceeds the resolver contract`);
        } else ok(`E: kind=${k}, displacement ${Math.round((p.startSnap?.distancePx ?? 0) * 100) / 100} px at zoom ${r.zoom.toFixed(3)}`);
        await shot("E-far-node.png");
      }
    }
  }

  /* ---------------- F. high zoom rejection ---------------- */
  console.log("[F] high zoom rejection");
  {
    const r = await reference(3, 180, 320);
    if (r) {
      // Exactly 25 mm beyond the endpoint along the wall extension: about
      // 75 screen px at zoom 3, while both pointer positions remain in-canvas.
      const start = { x: r.ox - 25, y: r.oy };
      const end = { x: r.ox - 25, y: r.oy + 100 };
      if (await assertOnScreen([start, end], "F")) {
        const screenStart = await w2s(start.x, start.y);
        const screenEnd = await w2s(end.x, end.y);
        const p = await probe(start, end, "F-high-zoom");
        const k = p.startSnap?.kind;
        const candidateDistanceMm = 25;
        const candidateDistancePx = candidateDistanceMm * r.zoom;
        ev.cases.F = {
          zoom: r.zoom, startSnap: p.startSnap, startIntent: p.startIntent,
          candidateDistanceMm, candidateDistancePx,
          world: { start, end }, screen: { start: round(screenStart), end: round(screenEnd) },
          canvas: (await state()).rect,
        };
        if (["node", "wall-end", "wall-body"].includes(k)) {
          fail(`F: a 25 mm / ${candidateDistancePx.toFixed(1)} px candidate captured the start at zoom ${r.zoom.toFixed(2)} (kind=${k})`);
        } else if (r.zoom < 2.55) fail(`F: zoom ${r.zoom.toFixed(2)} is not around 3`);
        else ok(`F: 25 mm / ${candidateDistancePx.toFixed(1)} px rejected in-canvas at zoom ${r.zoom.toFixed(2)} (kind=${k})`);
        await shot("F-high-zoom.png");
      }
    }
  }

  /* ---------------- G. close wall body beats a farther node ---------------- */
  console.log("[G] close wall body beats a farther node");
  {
    const r = await reference(0.02, 6000, 200);
    if (r) {
      const start = { x: r.ox + 200, y: r.oy + 5 };
      const end = { x: r.ox + 200, y: r.oy + 4000 };
      if (await assertOnScreen([start, end], "G")) {
        const p = await probe(start, end, "G-close-wall");
        ev.cases.G = { zoom: r.zoom, startSnap: p.startSnap };
        if (p.startSnap?.kind !== "wall-body") fail(`G: expected wall-body, got ${p.startSnap?.kind}`);
        else ok(`G: wall-body (5 mm) beat the node (200 mm) at zoom ${r.zoom.toFixed(3)}`);
        await shot("G-close-wall.png");
      }
    }
  }

  /* ---------------- H. near miss stays independent ---------------- */
  console.log("[H] near miss keeps walls independent");
  {
    const r = await reference(0.12, 4000);
    if (r) {
      const offset = Math.round(50 + (MAX_DISTANCE_PX + 8) / r.zoom); // clear of mass and band
      const before = await state();
      const start = { x: r.ox + 500, y: r.oy + offset };
      const end = { x: r.ox + 3500, y: r.oy + offset };
      if (await assertOnScreen([start, end], "H")) {
        const g = await drag(start, end, "H-near-miss", { expectedWallDelta: 1 });
        const nodesBefore = Object.keys(before.nodes).length;
        const nodesAfter = Object.keys(g.after.nodes).length;
        ev.cases.H = {
          zoom: r.zoom, offsetMm: offset, startSnap: g.startSnap, kind: g.startSnap?.kind,
          startIntent: g.startIntent, connects: g.startSnap?.connects,
          nodesBefore, nodesAfter, wallDelta: g.wallDelta,
        };
        if (!g.addedOne) fail("H: no wall created");
        else if (g.startSnap?.kind === "wall-body") fail(`H: a ${offset} mm clearance was captured as wall-body`);
        else if (g.startSnap?.connects === true) fail("H: near miss reported a topology connection");
        else if (nodesAfter !== nodesBefore + 2) fail(`H: expected 2 fresh nodes, got ${nodesAfter - nodesBefore}`);
        else ok(`H: ${offset} mm clearance stayed independent (kind=${g.startSnap?.kind}, +2 nodes)`);
        await shot("H-near-miss.png");
      }
    }
  }

  /* ---------------- I. Alt bypass ---------------- */
  console.log("[I] Alt bypass");
  {
    const r = await reference(0.12, 4000);
    if (r) {
      const start = { x: r.ox + 4000 + 8, y: r.oy + 8 };
      const end = { x: r.ox + 4600, y: r.oy + 900 };
      if (await assertOnScreen([start, end], "I")) {
        const alt = await probe(start, end, "I-alt", { modifier: "Alt" });
        const back = await probe(start, end, "I-alt-released");
        ev.cases.I = {
          zoom: r.zoom, withAlt: alt.startSnap, withAltIntent: alt.startIntent,
          afterRelease: back.startSnap, afterReleaseIntent: back.startIntent,
        };
        if (alt.startSnap?.kind !== "raw") fail(`I: Alt did not bypass magnets (kind=${alt.startSnap?.kind})`);
        else if (alt.startSnap?.nodeId || alt.startSnap?.hostWallId) fail("I: Alt produced topology ids");
        else if (alt.startSnap?.connects === true) fail("I: Alt reported a topology connection");
        else if (back.startSnap?.kind === "raw") fail("I: magnets did not return after releasing Alt");
        else ok(`I: Alt kind=raw (no ids), after release kind=${back.startSnap?.kind}`);
        await shot("I-alt.png");
      }
    }
  }

  /* ---------------- J. Shift / angle vs topology ---------------- */
  console.log("[J] Shift angle vs topology");
  {
    const r = await reference(0.12, 4000);
    if (r) {
      const base = { x: r.ox + 500, y: r.oy + 2500 };
      const freeEnd = { x: r.ox + 3000, y: r.oy + 2620 };
      const nodeEnd = { x: r.ox + 4000 + 10, y: r.oy + 10 };
      if (await assertOnScreen([base, freeEnd, nodeEnd], "J")) {
        const free = await probe(base, freeEnd, "J-angle-free", { modifier: "Shift" });
        const near = await probe(base, nodeEnd, "J-angle-topology", { modifier: "Shift" });
        ev.cases.J = {
          zoom: r.zoom, freeEnd: free.endSnap, freeEndIntent: free.endIntent,
          nearNodeEnd: near.endSnap, nearNodeEndIntent: near.endIntent,
        };
        if (free.endSnap?.connects === true) fail("J: free-space end unexpectedly connected");
        else if (!["node", "wall-end", "wall-body"].includes(near.endSnap?.kind)) {
          fail(`J: Shift angle overwrote an eligible topology candidate (kind=${near.endSnap?.kind})`);
        } else ok(`J: free kind=${free.endSnap?.kind}, near-node kind=${near.endSnap?.kind} (topology wins)`);
        await shot("J-angle.png");
      }
    }
  }

  /* ---------------- K. transaction boundary ---------------- */
  console.log("[K] hold / release / Escape / undo / redo / reload");
  {
    await clearAll();
    const zoom = await zoomTo(0.12);
    const o = await visibleOrigin(300);
    await page.waitForTimeout(SETTLE_MS);
    const before = await state();
    const beforeFp = planFingerprint(before.plan);
    const beforeApi = planFingerprint(await apiPlan());
    const w0 = writeCount;

    const a = await w2s(o.x, o.y);
    const b = await w2s(o.x + 3000, o.y);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.waitForTimeout(HOLD_MS);
    const held = await state();
    await shot("K-hold.png");
    const holdRelease = {
      zoom: Math.round(zoom * 1000) / 1000,
      previewVisible: !!held.v2?.preview,
      committedUnchanged: planFingerprint(held.plan) === beforeFp,
      apiUnchanged: planFingerprint(await apiPlan()) === beforeApi,
      writesDuringHold: writeCount - w0,
    };
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const after = await state();
    holdRelease.addedOne = after.wallCount === before.wallCount + 1;
    holdRelease.writesAfterRelease = writeCount - w0;
    holdRelease.apiMatchesCommitted = planFingerprint(await apiPlan()) === planFingerprint(after.plan);
    holdRelease.idle = after.v2?.active === false;
    if (!holdRelease.previewVisible) fail("K: no preview during hold");
    if (!holdRelease.committedUnchanged) fail("K: committed plan changed during hold");
    if (!holdRelease.apiUnchanged) fail("K: saved plan changed during hold");
    if (holdRelease.writesDuringHold !== 0) fail(`K: ${holdRelease.writesDuringHold} write(s) during hold`);
    if (!holdRelease.addedOne) fail("K: release did not create exactly one wall");
    if (holdRelease.writesAfterRelease !== 1) fail(`K: expected 1 write after release, got ${holdRelease.writesAfterRelease}`);
    if (!holdRelease.apiMatchesCommitted) fail("K: saved plan does not match committed after release");

    const escBefore = await state();
    const escFp = planFingerprint(escBefore.plan);
    const w1 = writeCount;
    const c = await w2s(o.x, o.y + 2000);
    const d = await w2s(o.x + 3000, o.y + 2000);
    await page.mouse.move(c.x, c.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(d.x, d.y, { steps: 6 });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const escAfter = await state();
    const escape = {
      wallCountUnchanged: escAfter.wallCount === escBefore.wallCount,
      committedUnchanged: planFingerprint(escAfter.plan) === escFp,
      apiUnchanged: planFingerprint(await apiPlan()) === escFp,
      writes: writeCount - w1,
      idle: escAfter.v2?.active === false,
      toolStillWall: escAfter.tool === "wall",
    };
    if (!escape.wallCountUnchanged) fail("K: Escape changed the wall count");
    if (!escape.committedUnchanged) fail("K: Escape changed the committed plan");
    if (escape.writes !== 0) fail(`K: Escape produced ${escape.writes} write(s)`);
    await shot("K-escape.png");

    const preUndo = await state();
    const preUndoFp = planFingerprint(preUndo.plan);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(900);
    const undone = await state();
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(900);
    const redone = await state();
    await page.waitForTimeout(SETTLE_MS);
    const committedFp = planFingerprint((await state()).plan);
    const savedFp = planFingerprint(await apiPlan());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(1500);
    const reloadedFp = planFingerprint((await state()).plan);
    await shot("K-after-reload.png");
    const undoRedo = {
      undoRemovedOne: undone.wallCount === preUndo.wallCount - 1,
      redoRestored: planFingerprint(redone.plan) === preUndoFp,
      browserMatchesApi: committedFp === savedFp,
      reloadMatches: reloadedFp === committedFp,
    };
    if (!undoRedo.undoRemovedOne) fail(`K: Undo removed ${preUndo.wallCount - undone.wallCount} wall(s), expected 1`);
    if (!undoRedo.redoRestored) fail("K: Redo did not restore the pre-undo fingerprint");
    if (!undoRedo.browserMatchesApi) fail("K: committed != saved");
    if (!undoRedo.reloadMatches) fail("K: reload != committed");
    ev.cases.K = { holdRelease, escape, undoRedo };
    if (holdRelease.writesDuringHold === 0 && holdRelease.writesAfterRelease === 1 && escape.writes === 0) {
      ok("K: hold 0 writes, release 1 write, Escape 0 writes, undo/redo/reload consistent");
    }
  }

  /* ---------------- L. 20-gesture regression ---------------- */
  console.log("[L] 20 drag-release regression");
  {
    const cleared = await clearAll();
    await page.getByRole("button", { name: "Стены", exact: true }).first().click().catch(() => {});
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 10000 });
    const zoom = await zoomTo(0.08);
    const o = await visibleOrigin(300);
    // Keep every edge clear of the bottom toolbar's overlay while still
    // enclosing the same four independent inner rectangles.
    const OX1 = o.x + 8000, OY1 = o.y + 5500;
    const rectDrags = (x0, y0, x1, y1, label) => ([
      [{ x: x0, y: y0 }, { x: x1, y: y0 }, `${label}-N`],
      [{ x: x1, y: y0 }, { x: x1, y: y1 }, `${label}-E`],
      [{ x: x1, y: y1 }, { x: x0, y: y1 }, `${label}-S`],
      [{ x: x0, y: y1 }, { x: x0, y: y0 }, `${label}-W`],
    ]);
    const onScreen = await assertOnScreen([{ x: o.x, y: o.y }, { x: OX1, y: OY1 }], "L");
    let dragCount = 0;
    const perDrag = [];
    if (onScreen) {
      const pad = 700, iw = 2600, ih = 1900;
      const shapes = [
        rectDrags(o.x, o.y, OX1, OY1, "outer"),
        rectDrags(o.x + pad, o.y + pad, o.x + pad + iw, o.y + pad + ih, "inner1"),
        rectDrags(o.x + pad + iw + pad, o.y + pad, o.x + pad + iw + pad + iw, o.y + pad + ih, "inner2"),
        rectDrags(o.x + pad, o.y + pad + ih + pad, o.x + pad + iw, o.y + pad + ih + pad + ih, "inner3"),
        rectDrags(o.x + pad + iw + pad, o.y + pad + ih + pad, o.x + pad + iw + pad + iw, o.y + pad + ih + pad + ih, "inner4"),
      ];
      for (const shape of shapes) {
        for (const [f, t, l] of shape) {
          const g = await drag(f, t, l);
          dragCount += 1;
          perDrag.push({
            label: l,
            addedOne: g.addedOne,
            expectedWallDelta: null,
            wallDelta: g.wallDelta,
            wallsBefore: g.wallsBefore,
            wallsAfter: g.wallsAfter,
            idle: g.idle,
            toolStillWall: g.toolStillWall,
            startKind: g.startSnap?.kind || null,
            endKind: g.endSnap?.kind || null,
            requested: g.requested,
            previewStart: g.previewStart,
            previewEnd: g.previewEnd,
          });
          if (!g.idle) fail(`L ${l}: session not idle after release`);
          if (!g.toolStillWall) fail(`L ${l}: Wall tool did not remain active`);
        }
      }
    }
    await shot("L-regression.png");
    const final = await state();
    const diagonals = countDiagonals(final.walls);
    const orphans = countOrphanNodes(final.nodes, final.walls);
    ev.cases.L = {
      zoom: Math.round(zoom * 1000) / 1000, startedFromWalls: cleared, dragCount,
      wallCount: final.wallCount, nodeCount: Object.keys(final.nodes).length, roomCount: final.rooms.length,
      diagonalCount: diagonals.length, orphanNodeCount: orphans.length,
      idle: final.v2?.active === false, draftLen: final.draftLen, toolStillWall: final.tool === "wall",
      allIdle: perDrag.every((d) => d.idle), perDrag,
    };
    if (dragCount !== 20) fail(`L: ran ${dragCount} gestures, expected 20`);
    if (final.wallCount !== 20) fail(`L: expected 20 walls, got ${final.wallCount}`);
    if (Object.keys(final.nodes).length !== 20) fail(`L: expected 20 nodes, got ${Object.keys(final.nodes).length}`);
    if (final.rooms.length !== 5) fail(`L: expected 5 rooms, got ${final.rooms.length}`);
    if (diagonals.length !== 0) fail(`L: ${diagonals.length} false diagonal(s)`);
    if (orphans.length !== 0) fail(`L: ${orphans.length} orphan node(s)`);
    if (final.draftLen !== 0) fail(`L: pending draft (draftLen=${final.draftLen})`);
    if (!ev.cases.L.idle) fail("L: session not idle");
    if (!ev.cases.L.toolStillWall) fail("L: wall tool no longer active");
    if (!ev.cases.L.allIdle) fail("L: at least one release did not return to idle");
    await page.waitForTimeout(SETTLE_MS);
    const finalFp = planFingerprint(final.plan);
    const apiFp = planFingerprint(await apiPlan());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(800);
    const reloadFp = planFingerprint((await state()).plan);
    ev.cases.L.browserFingerprintSha256 = fingerprintDigest(finalFp);
    ev.cases.L.apiFingerprintSha256 = fingerprintDigest(apiFp);
    ev.cases.L.reloadFingerprintSha256 = fingerprintDigest(reloadFp);
    ev.cases.L.browserApiMatch = finalFp === apiFp;
    ev.cases.L.reloadMatch = finalFp === reloadFp;
    if (!ev.cases.L.browserApiMatch) fail("L: browser/API fingerprint mismatch");
    if (!ev.cases.L.reloadMatch) fail("L: browser/reload fingerprint mismatch");
    if (final.wallCount === 20 && final.rooms.length === 5 && !diagonals.length && !orphans.length) {
      ok("L: 20 drags → 20 walls / 20 nodes / 5 rooms, 0 diagonals, 0 orphans, idle");
    }
  }

  ev.finishedAt = new Date().toISOString();
  ev.planSaveWrites = writeCount;
  ev.pass = ev.failures.length === 0;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "evidence.json"), JSON.stringify(ev, null, 2));
  await ctx.close();
  await browser.close();
  console.log(`\nRESULT: ${ev.pass ? "PASS" : "FAIL"}  failures=${ev.failures.length}`);
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
