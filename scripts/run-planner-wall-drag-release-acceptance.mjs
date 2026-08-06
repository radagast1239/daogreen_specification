/**
 * B+ PHASE 2A ACCEPTANCE — single-wall drag-release drawing (V2 path).
 *
 * Draws an outer rectangle and four inner rectangles as 20 INDEPENDENT
 * drag-release gestures (pointerdown → move → pointerup), then verifies that
 * every release produced exactly one wall and left the interaction idle with
 * no pending chain, that no linking diagonal or orphan node appeared, and that
 * Enter / double-click / a plain click add nothing.
 *
 * Also proves the transaction boundary in a real browser: a >1200 ms hold
 * shows a preview while the committed plan, the saved plan and the write count
 * stay untouched, and Escape before release cancels without any write.
 *
 * Requires the V2 flag on the dev server:
 *   VITE_DG_PLANNER_E2E=1  VITE_DG_PLANNER_WALL_DRAW_V2=1
 *
 * Hardened rules (same contract as the legacy click baseline):
 * - No default admin key, project id, base or api URL — all fail closed.
 * - BASE/API must be http:// on localhost / 127.0.0.1 / ::1.
 * - EVIDENCE_DIR must be absolute and outside the repository root.
 * - The script never creates or deletes projects; it only uses the project
 *   passed in REVIEW_PROJECT_ID, which must be a disposable local project.
 * - Real browser mouse events only; the plan is never mutated from page JS.
 * - No secret is written to evidence.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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
  const allowed = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!allowed.has(u.hostname)) throw new Error(`${name} must be local, got ${u.hostname}`);
}

const BASE = requireEnv("REVIEW_BASE").replace(/\/$/, "");
const API = requireEnv("REVIEW_API").replace(/\/$/, "");
assertLocalUrl("REVIEW_BASE", BASE);
assertLocalUrl("REVIEW_API", API);
const ADMIN_KEY = requireEnv("REVIEW_ADMIN_KEY");
const PROJECT_ID = requireEnv("REVIEW_PROJECT_ID");
const EVIDENCE_DIR = requireEnv("EVIDENCE_DIR");
const ALLOWED_BROWSER_WRITE_ORIGINS = new Set([new URL(BASE).origin, new URL(API).origin]);
const PROJECT_PLAN_SAVE_PATH = `/api/projects/${encodeURIComponent(PROJECT_ID)}`;

if (!path.isAbsolute(EVIDENCE_DIR)) throw new Error("EVIDENCE_DIR must be an absolute path");
const rel = path.relative(REPO_ROOT, EVIDENCE_DIR);
if (!rel.startsWith("..") && rel !== "") throw new Error("EVIDENCE_DIR must be outside the repository root");

const SHOTS = path.join(EVIDENCE_DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const HOLD_MS = Number(process.env.HOLD_MS || 1400);
const SETTLE_MS = Number(process.env.SETTLE_MS || 2500);
const maskId = (id) => (typeof id === "string" && id.length > 4 ? `${id.slice(0, 2)}***${id.slice(-2)}` : "***");
const maskUrl = (u) => String(u).replace(PROJECT_ID, maskId(PROJECT_ID));

/**
 * Count only the canonical full-project plan save for this acceptance project.
 *
 * Browser requests can target REVIEW_API directly or use same-origin /api on
 * REVIEW_BASE and be forwarded by the Vite proxy. Playwright observes the
 * latter before proxying, so an API-origin-only check misses real autosaves.
 */
function isCurrentProjectPlanSaveRequest(request) {
  const method = request.method();
  if (method !== "PATCH" && method !== "PUT") return false;
  let url;
  try {
    url = new URL(request.url());
  } catch {
    return false;
  }
  return ALLOWED_BROWSER_WRITE_ORIGINS.has(url.origin)
    && url.pathname === PROJECT_PLAN_SAVE_PATH;
}

function verifyPlanSaveRequestClassifier() {
  const request = (method, url) => ({ method: () => method, url: () => url });
  const otherProjectPath = `/api/projects/${encodeURIComponent(`${PROJECT_ID}-other`)}`;
  const cases = [
    { name: "direct API PATCH", method: "PATCH", url: `${API}${PROJECT_PLAN_SAVE_PATH}`, expected: true },
    { name: "proxied same-origin PATCH", method: "PATCH", url: `${BASE}${PROJECT_PLAN_SAVE_PATH}`, expected: true },
    { name: "GET same endpoint", method: "GET", url: `${BASE}${PROJECT_PLAN_SAVE_PATH}`, expected: false },
    { name: "PATCH another project", method: "PATCH", url: `${BASE}${otherProjectPath}`, expected: false },
    { name: "PATCH another API endpoint", method: "PATCH", url: `${BASE}${PROJECT_PLAN_SAVE_PATH}/items/item-1`, expected: false },
  ];
  const results = cases.map((c) => {
    const actual = isCurrentProjectPlanSaveRequest(request(c.method, c.url));
    return {
      name: c.name,
      method: c.method,
      url: maskUrl(c.url),
      pathname: maskUrl(new URL(c.url).pathname),
      expected: c.expected,
      actual,
    };
  });
  const failed = results.filter((r) => r.actual !== r.expected);
  if (failed.length) {
    throw new Error(`plan-save request classifier self-check failed: ${JSON.stringify(failed)}`);
  }
  return results;
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
/** Ignores derived walls[].pts on purpose — nodes + a/b are the source of truth. */
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
  acceptanceKind: "b-plus-drag-release-v2",
  branch: "",
  head: "",
  baseUrl: BASE,
  apiUrl: API,
  projectIdMask: maskId(PROJECT_ID),
  holdMs: HOLD_MS,
  dragCount: 0,
  perDrag: [],
  wallCount: 0,
  nodeCount: 0,
  roomCount: 0,
  diagonalCount: 0,
  diagonalWallIds: [],
  orphanNodeCount: 0,
  wallToolActive: false,
  noopChecks: {},
  hold: {},
  cancel: {},
  undo: null,
  redo: null,
  reload: null,
  fingerprints: {},
  patchCount: 0,
  planSaveRequests: [],
  classifierSelfCheck: [],
  screenshots: [],
  consoleErrors: [],
  backendErrors: [],
  failures: [],
  startedAt: new Date().toISOString(),
  finishedAt: null,
  pass: false,
};
try { ev.branch = execSync("git branch --show-current", { encoding: "utf8" }).trim(); } catch {}
try { ev.head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch {}

const fail = (m) => { ev.failures.push(m); console.log(`  FAIL: ${m}`); };
const ok = (m) => console.log(`  ok: ${m}`);

async function main() {
  // Fail closed before launching a browser if direct/proxied classification or
  // any negative control does not behave exactly as declared above.
  ev.classifierSelfCheck = verifyPlanSaveRequestClassifier();
  ok("plan-save request classifier self-check passed");

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();

  page.on("console", (m) => { if (m.type() === "error") ev.consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => ev.consoleErrors.push(String(e)));
  page.on("response", (r) => {
    if (r.url().startsWith(API) && r.status() >= 400) {
      ev.backendErrors.push({ status: r.status(), method: r.request().method(), url: maskUrl(r.url()) });
    }
  });
  page.on("request", (r) => {
    if (!isCurrentProjectPlanSaveRequest(r)) return;
    const url = new URL(r.url());
    ev.patchCount += 1;
    ev.planSaveRequests.push({
      method: r.method(),
      url: maskUrl(r.url()),
      pathname: maskUrl(url.pathname),
      observedOrigin: url.origin,
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
      tool: d.tool,
      draftLen: d.draftLen,
      gesturePhase: d.gesturePhase,
      v2: d.wallDrawV2 || null,
      canUndo: d.canUndo,
      canRedo: d.canRedo,
      view: { panX: d.view.panX, panY: d.view.panY, zoom: d.view.zoom },
      rect: { left: d.svgRect.left, top: d.svgRect.top, w: d.svgRect.width, h: d.svgRect.height },
      wallCount: walls.length,
      nodes: p.nodes || {},
      walls: walls.map((w) => ({ id: w.id, a: w.a, b: w.b, pts: (w.pts || []).map((q) => ({ x: q.x, y: q.y })) })),
      plan: { nodes: p.nodes || {}, walls: (p.walls || []).map((w) => ({ id: w.id, a: w.a, b: w.b, thk: w.thk })), rooms: p.rooms || [] },
      rooms: p.rooms || [],
    };
  });

  // Fail closed: the V2 path must actually be compiled into the running app.
  const boot = await state();
  if (!boot.v2?.enabled) {
    throw new Error("VITE_DG_PLANNER_WALL_DRAW_V2=1 is not active on the dev server — refusing to run a V2 acceptance against the legacy path");
  }
  ok("V2 drag-release path is active on the dev server");

  const w2s = async (mx, my) => {
    const s = await state();
    return { x: s.rect.left + s.view.panX + mx * s.view.zoom, y: s.rect.top + s.view.panY + my * s.view.zoom };
  };
  const shot = async (n) => { await page.screenshot({ path: path.join(SHOTS, n) }); ev.screenshots.push(n); };

  await page.getByRole("button", { name: "Стены", exact: true }).first().click();
  await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 10000 });
  {
    const s = await state();
    await page.mouse.move(s.rect.left + s.rect.w / 2, s.rect.top + s.rect.h / 2);
    for (let i = 0; i < 60; i++) {
      const c = await state();
      if (12000 * c.view.zoom <= c.rect.w * 0.85 && 9000 * c.view.zoom <= c.rect.h * 0.85) break;
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(30);
    }
  }
  await shot("v2-before.png");

  /** One independent drag-release gesture. */
  async function dragWall(from, to, label) {
    const before = await state();
    const a = await w2s(from.x, from.y);
    const b = await w2s(to.x, to.y);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(a.x + (b.x - a.x) * 0.35, a.y + (b.y - a.y) * 0.35, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    // Snapped rubber band as it stands at release — the exact segment the
    // commit pipeline receives, recorded so a failure is diagnosable.
    const atRelease = await state();
    await page.mouse.up();
    await page.waitForTimeout(260);
    const after = await state();
    ev.dragCount += 1;
    const band = atRelease.v2?.preview || null;
    const round = (p) => (p ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
    const rec = {
      label,
      requested: { from: { x: Math.round(from.x), y: Math.round(from.y) }, to: { x: Math.round(to.x), y: Math.round(to.y) } },
      snapped: band ? { start: round(band.start), end: round(band.end), lengthMm: Math.round(band.lengthMm) } : null,
      wallsBefore: before.wallCount,
      wallsAfter: after.wallCount,
      addedOne: after.wallCount === before.wallCount + 1,
      idleAfterRelease: after.v2?.active === false,
      draftLen: after.draftLen,
      toolStillWall: after.tool === "wall",
    };
    ev.perDrag.push(rec);
    if (!rec.addedOne) fail(`${label}: expected exactly one new wall, ${before.wallCount} → ${after.wallCount}`);
    if (!rec.idleAfterRelease) fail(`${label}: V2 session not idle after release`);
    if (rec.draftLen !== 0) fail(`${label}: legacy draft is not empty (draftLen=${rec.draftLen})`);
    if (!rec.toolStillWall) fail(`${label}: wall tool is no longer active`);
    return after;
  }

  const s0 = await state();
  const snap50 = (v) => Math.round(v / 50) * 50;
  const OX0 = snap50((0 - s0.view.panX) / s0.view.zoom + 300);
  const OY0 = snap50((0 - s0.view.panY) / s0.view.zoom + 300);
  const OX1 = OX0 + 10000;
  const OY1 = OY0 + 7000;

  const rectDrags = (x0, y0, x1, y1, label) => ([
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, `${label}-N`],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }, `${label}-E`],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }, `${label}-S`],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }, `${label}-W`],
  ]);

  console.log("[1] outer rectangle — 4 drag-release gestures");
  for (const [from, to, label] of rectDrags(OX0, OY0, OX1, OY1, "outer")) await dragWall(from, to, label);

  console.log("[2] four inner rectangles — 16 drag-release gestures");
  const pad = 700, innerW = 2600, innerH = 1900;
  const quadrants = [
    [OX0 + pad, OY0 + pad],
    [OX0 + pad + innerW + pad, OY0 + pad],
    [OX0 + pad, OY0 + pad + innerH + pad],
    [OX0 + pad + innerW + pad, OY0 + pad + innerH + pad],
  ];
  for (let i = 0; i < quadrants.length; i++) {
    const [ix0, iy0] = quadrants[i];
    for (const [from, to, label] of rectDrags(ix0, iy0, ix0 + innerW, iy0 + innerH, `inner${i + 1}`)) {
      await dragWall(from, to, label);
    }
  }
  await shot("v2-rectangles.png");

  const final = await state();
  ev.wallCount = final.wallCount;
  ev.nodeCount = Object.keys(final.nodes).length;
  ev.roomCount = final.rooms.length;
  ev.wallToolActive = final.tool === "wall";
  const diagonals = countDiagonals(final.walls);
  ev.diagonalCount = diagonals.length;
  ev.diagonalWallIds = diagonals.map((w) => w.id);
  ev.orphanNodeCount = countOrphanNodes(final.nodes, final.walls).length;

  if (ev.dragCount !== 20) fail(`expected 20 drag gestures, ran ${ev.dragCount}`);
  if (ev.wallCount !== 20) fail(`expected 20 walls, got ${ev.wallCount}`);
  if (ev.nodeCount !== 20) fail(`expected 20 nodes, got ${ev.nodeCount}`);
  if (ev.roomCount !== 5) fail(`expected 5 rooms, got ${ev.roomCount}`);
  if (ev.diagonalCount !== 0) fail(`expected 0 diagonals, got ${ev.diagonalCount}: ${ev.diagonalWallIds.join(",")}`);
  if (ev.orphanNodeCount !== 0) fail(`expected 0 orphan nodes, got ${ev.orphanNodeCount}`);
  if (final.draftLen !== 0) fail(`expected no pending draft, draftLen=${final.draftLen}`);
  if (final.v2?.active !== false) fail("V2 session still active after the last release");
  if (!ev.wallToolActive) fail("wall tool is not active after drawing all five contours");
  if (ev.failures.length === 0) ok(`20 drags → ${ev.wallCount} walls / ${ev.nodeCount} nodes / ${ev.roomCount} rooms, 0 diagonals, 0 orphans, idle`);

  console.log("[3] Enter / double-click / plain click must add nothing");
  {
    const base = (await state()).wallCount;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const afterEnter = (await state()).wallCount;

    const mid = await w2s(OX0 + 5000, OY0 + 3500);
    await page.mouse.dblclick(mid.x, mid.y);
    await page.waitForTimeout(400);
    const afterDbl = (await state()).wallCount;

    const spot = await w2s(OX0 + 5200, OY0 + 3300);
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(400);
    const afterClick = await state();

    ev.noopChecks = {
      base,
      afterEnter,
      afterDoubleClick: afterDbl,
      afterPlainClick: afterClick.wallCount,
      draftLenAfterClick: afterClick.draftLen,
      v2ActiveAfterClick: afterClick.v2?.active,
    };
    if (afterEnter !== base) fail(`Enter created ${afterEnter - base} wall(s)`);
    if (afterDbl !== base) fail(`double-click created ${afterDbl - base} wall(s)`);
    if (afterClick.wallCount !== base) fail(`plain click created ${afterClick.wallCount - base} wall(s)`);
    if (afterClick.draftLen !== 0) fail(`plain click left a pending draft (draftLen=${afterClick.draftLen})`);
    if (afterClick.v2?.active !== false) fail("plain click left the V2 session active");
    if (ev.failures.length === 0) ok("Enter, double-click and a plain click all added nothing and left no draft");
  }

  await page.waitForTimeout(SETTLE_MS);

  console.log("[4] hold check — preview visible, nothing committed or saved");
  {
    const before = await state();
    const beforeFp = planFingerprint(before.plan);
    const beforeApiFp = planFingerprint(await apiPlan());
    const patchBefore = ev.patchCount;
    const hx = OX0 + 1200, hy = OY0 + 6200;

    const a = await w2s(hx, hy);
    const b = await w2s(hx + 2200, hy);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.waitForTimeout(HOLD_MS);

    const held = await state();
    const heldApiFp = planFingerprint(await apiPlan());
    await shot("v2-hold-preview.png");

    ev.hold = {
      heldMs: HOLD_MS,
      previewVisible: !!held.v2?.preview && held.v2.preview.lengthMm > 200,
      previewLengthMm: held.v2?.preview ? Math.round(held.v2.preview.lengthMm) : null,
      sessionActive: held.v2?.active === true,
      wallCountUnchanged: held.wallCount === before.wallCount,
      committedUnchanged: planFingerprint(held.plan) === beforeFp,
      apiUnchanged: heldApiFp === beforeApiFp,
      patchDeltaDuringHold: ev.patchCount - patchBefore,
    };
    if (!ev.hold.previewVisible) fail("no preview during hold");
    if (!ev.hold.sessionActive) fail("V2 session not active during hold");
    if (!ev.hold.wallCountUnchanged) fail("wall count changed during hold");
    if (!ev.hold.committedUnchanged) fail("committed plan changed during hold");
    if (!ev.hold.apiUnchanged) fail("saved API plan changed during hold");
    if (ev.hold.patchDeltaDuringHold !== 0) fail(`PATCH/PUT delta ${ev.hold.patchDeltaDuringHold} during hold (expected 0)`);

    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const after = await state();
    ev.hold.wallsAfterRelease = after.wallCount;
    ev.hold.addedOneOnRelease = after.wallCount === before.wallCount + 1;
    ev.hold.patchDeltaAfterRelease = ev.patchCount - patchBefore;
    ev.hold.idleAfterRelease = after.v2?.active === false;
    ev.hold.apiMatchesCommitted = planFingerprint(await apiPlan()) === planFingerprint(after.plan);
    if (!ev.hold.addedOneOnRelease) fail("hold release did not create exactly one wall");
    if (ev.hold.patchDeltaAfterRelease !== 1) fail(`expected 1 PATCH/PUT after hold release, got ${ev.hold.patchDeltaAfterRelease}`);
    if (!ev.hold.apiMatchesCommitted) fail("saved plan does not match committed plan after hold release");
    if (!ev.hold.idleAfterRelease) fail("V2 session not idle after hold release");
    if (ev.failures.length === 0) ok(`held ${HOLD_MS} ms: preview only, 0 writes; release → 1 wall, 1 write`);
  }

  console.log("[5] cancel check — Escape before release");
  {
    // Control: the tool rail owns Escape while one of its buttons still has
    // focus (PlannerToolRail's element-scoped onKeyDown → onEscape → select).
    // Probe it with NO gesture in flight so the effect is attributable to the
    // rail alone, then blur so the V2 contract below is what actually gets
    // tested rather than rail focus.
    const railToolBefore = (await state()).tool;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const railToolAfter = (await state()).tool;
    ev.railEscapePreexisting = {
      gestureInFlight: false,
      toolBefore: railToolBefore,
      toolAfter: railToolAfter,
      railOwnsEscapeWhenFocused: railToolBefore === "wall" && railToolAfter !== "wall",
    };
    await page.evaluate(() => document.activeElement?.blur?.());
    if (railToolAfter !== "wall") {
      await page.getByRole("button", { name: "Стены", exact: true }).first().click();
      await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 10000 });
      await page.evaluate(() => document.activeElement?.blur?.());
    }

    const before = await state();
    const beforeFp = planFingerprint(before.plan);
    const beforeApiFp = planFingerprint(await apiPlan());
    const patchBefore = ev.patchCount;
    const cx = OX0 + 6200, cy = OY0 + 6200;

    const a = await w2s(cx, cy);
    const b = await w2s(cx + 2400, cy);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.waitForTimeout(400);
    const previewed = await state();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const escaped = await state();
    await shot("v2-escape.png");
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const after = await state();

    ev.cancel = {
      toolBeforeDrag: before.tool,
      toolBeforeEscape: previewed.tool,
      v2ActiveBeforeEscape: previewed.v2?.active,
      toolAfterEscape: escaped.tool,
      toolAfterRelease: after.tool,
      previewShown: !!previewed.v2?.preview,
      previewCleared: !escaped.v2?.preview,
      sessionIdle: escaped.v2?.active === false,
      wallCountUnchanged: after.wallCount === before.wallCount,
      committedUnchanged: planFingerprint(after.plan) === beforeFp,
      apiUnchanged: planFingerprint(await apiPlan()) === beforeApiFp,
      patchDelta: ev.patchCount - patchBefore,
      toolStillWall: after.tool === "wall",
    };
    if (!ev.cancel.previewShown) fail("no preview before Escape");
    if (!ev.cancel.previewCleared) fail("preview survived Escape");
    if (!ev.cancel.sessionIdle) fail("V2 session not idle after Escape");
    if (!ev.cancel.wallCountUnchanged) fail("Escape changed the wall count");
    if (!ev.cancel.committedUnchanged) fail("Escape changed the committed plan");
    if (!ev.cancel.apiUnchanged) fail("Escape changed the saved plan");
    if (ev.cancel.patchDelta !== 0) fail(`Escape produced ${ev.cancel.patchDelta} write(s)`);
    if (!ev.cancel.toolStillWall) fail("wall tool is no longer active after Escape");
    if (ev.failures.length === 0) ok("Escape before release: preview dropped, 0 writes, tool still active");
  }

  console.log("[6] undo / redo / reload");
  {
    const before = await state();
    const beforeFp = planFingerprint(before.plan);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(1000);
    const undone = await state();
    await shot("v2-after-undo.png");
    ev.undo = {
      wallsBefore: before.wallCount,
      wallsAfter: undone.wallCount,
      removedOne: undone.wallCount === before.wallCount - 1,
      diagonals: countDiagonals(undone.walls).length,
    };
    if (!ev.undo.removedOne) fail(`Undo removed ${before.wallCount - undone.wallCount} wall(s), expected 1`);
    if (ev.undo.diagonals !== 0) fail(`Undo produced ${ev.undo.diagonals} diagonal(s)`);

    await page.keyboard.press("Control+y");
    await page.waitForTimeout(1000);
    const redone = await state();
    await shot("v2-after-redo.png");
    ev.redo = {
      wallsAfter: redone.wallCount,
      restored: planFingerprint(redone.plan) === beforeFp,
    };
    if (!ev.redo.restored) fail("Redo did not restore the pre-undo fingerprint");

    await page.waitForTimeout(SETTLE_MS);
    const committed = await state();
    const committedFp = planFingerprint(committed.plan);
    const savedFp = planFingerprint(await apiPlan());
    ev.fingerprints.committedBrowser = committedFp.length;
    ev.fingerprints.savedApi = savedFp.length;
    ev.fingerprints.browserMatchesApi = committedFp === savedFp;
    if (!ev.fingerprints.browserMatchesApi) fail("committed browser fingerprint != saved API fingerprint");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
    await page.waitForTimeout(1500);
    const reloaded = await state();
    const reloadedFp = planFingerprint(reloaded.plan);
    await shot("v2-after-reload.png");
    ev.reload = {
      wallCount: reloaded.wallCount,
      matchesCommitted: reloadedFp === committedFp,
    };
    ev.fingerprints.afterReload = reloadedFp.length;
    if (!ev.reload.matchesCommitted) fail("fingerprint after reload does not match the committed fingerprint");
    if (ev.failures.length === 0) ok("undo/redo/reload all consistent; browser == API == reload");
  }

  ev.finishedAt = new Date().toISOString();
  ev.pass = ev.failures.length === 0;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "evidence.json"), JSON.stringify(ev, null, 2));
  await ctx.close();
  await browser.close();
  console.log(`\nRESULT: ${ev.pass ? "PASS" : "FAIL"}  drags=${ev.dragCount} walls=${ev.wallCount} rooms=${ev.roomCount} failures=${ev.failures.length}`);
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
