/**
 * PHASE 2C3A localhost-only browser gate for reliable wall movement.
 *
 * The caller owns an isolated backend/frontend and one disposable project.
 * This script seeds that project with the tracked topology-valid fixture, but
 * never creates/deletes projects and never writes evidence inside the repo.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLEAN_WALL_FIXTURE,
  cleanWallPlan,
} from "../tests/fixtures/planner/cleanWallTopology.js";

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
const HOLD_MS = Number(process.env.HOLD_MS || 1400);
const SETTLE_MS = Number(process.env.SETTLE_MS || 2200);
const MOVE_MM = Number(process.env.MOVE_DY_MM || 100);
const SAVE_PATH = `/api/projects/${encodeURIComponent(PROJECT_ID)}`;
const WRITE_ORIGINS = new Set([new URL(BASE).origin, new URL(API).origin]);

if (!path.isAbsolute(EVIDENCE_DIR)) throw new Error("EVIDENCE_DIR must be absolute");
const evidenceRel = path.relative(REPO_ROOT, EVIDENCE_DIR);
if (!evidenceRel.startsWith("..") && evidenceRel !== "") throw new Error("EVIDENCE_DIR must be outside repo");
const SHOTS = path.join(EVIDENCE_DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

function isPlanSave(request) {
  if (request.method() !== "PATCH" && request.method() !== "PUT") return false;
  try {
    const url = new URL(request.url());
    return WRITE_ORIGINS.has(url.origin) && url.pathname === SAVE_PATH;
  } catch {
    return false;
  }
}

function fixturePlan() {
  return cleanWallPlan();
}

function resolveFixtureWalls(plan) {
  return (plan?.walls || []).map((wall) => {
    if (Array.isArray(wall.pts) && wall.pts.length >= 2) return { ...wall, pts: wall.pts.map((point) => ({ ...point })) };
    const a = plan?.nodes?.[wall.a];
    const b = plan?.nodes?.[wall.b];
    return { ...wall, pts: a && b ? [{ ...a }, { ...b }] : [] };
  });
}

function canonical(plan, includeRooms = true) {
  const nodes = Object.entries(plan?.nodes || {})
    .map(([id, point]) => ({ id, x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const walls = (plan?.walls || []).map((wall) => ({
    id: wall.id, a: wall.a, b: wall.b, thk: wall.thk ?? 100, chainId: wall.chainId || wall.id,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const rooms = includeRooms ? (plan?.rooms || []).map((room) => ({
    id: room.id,
    polygon: (room.polygon || []).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })),
  })).sort((a, b) => String(a.id).localeCompare(String(b.id))) : [];
  return JSON.stringify({ nodes, walls, rooms });
}

/** Canonical geometry intentionally ignores generated topology ids. */
function topologyGeometryFingerprint(plan) {
  return JSON.stringify(resolveFixtureWalls(plan).map((wall) => {
    const endpoints = [wall.pts[0], wall.pts.at(-1)]
      .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
      .sort();
    return `${wall.chainId || wall.id}:${wall.thk ?? 100}:${endpoints.join("|")}`;
  }).sort());
}

function topologyDiagnostics(plan, resolvedWalls = resolveFixtureWalls(plan), { ignoredHostWallIds = [] } = {}) {
  const ignored = new Set(ignoredHostWallIds);
  const used = new Set((plan.walls || []).flatMap((wall) => [wall.a, wall.b]));
  const edgeKeys = new Set();
  const duplicateEdges = [];
  const zeroLength = [];
  for (const wall of plan.walls || []) {
    const edge = [wall.a, wall.b].sort().join("|");
    if (edgeKeys.has(edge)) duplicateEdges.push(wall.id);
    edgeKeys.add(edge);
    const a = plan.nodes?.[wall.a];
    const b = plan.nodes?.[wall.b];
    if (!a || !b || wall.a === wall.b || Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0)) < 50) {
      zeroLength.push(wall.id);
    }
  }

  const intersections = [];
  const cross = (a, b, c, d) => {
    const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (!(o1 * o2 < -1e-6 && o3 * o4 < -1e-6)) return null;
    const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(den) < 1e-9) return null;
    const det1 = a.x * b.y - a.y * b.x;
    const det2 = c.x * d.y - c.y * d.x;
    return {
      x: (det1 * (c.x - d.x) - (a.x - b.x) * det2) / den,
      y: (det1 * (c.y - d.y) - (a.y - b.y) * det2) / den,
    };
  };
  for (let i = 0; i < resolvedWalls.length; i += 1) {
    for (let j = i + 1; j < resolvedWalls.length; j += 1) {
      const a = resolvedWalls[i].pts?.[0], b = resolvedWalls[i].pts?.at(-1);
      const c = resolvedWalls[j].pts?.[0], d = resolvedWalls[j].pts?.at(-1);
      if (!a || !b || !c || !d) continue;
      const point = cross(a, b, c, d);
      if (!point) continue;
      const hasNode = Object.values(plan.nodes || {}).some((node) => Math.hypot(node.x - point.x, node.y - point.y) <= 1);
      if (!hasNode) intersections.push({ wallA: resolvedWalls[i].id, wallB: resolvedWalls[j].id, point });
    }
  }

  const hostBent = [];
  for (const host of CLEAN_WALL_FIXTURE.hostChains) {
    const members = resolvedWalls.filter(
      (wall) => wall.chainId === host.chainId && !ignored.has(wall.id),
    );
    for (const wall of members) {
      if (wall.pts.some((point) => Math.abs(point[host.axis] - host.coordinate) > 1e-4)) hostBent.push(wall.id);
    }
  }
  return {
    orphanNodes: Object.keys(plan.nodes || {}).filter((id) => !used.has(id)),
    duplicateEdges,
    zeroLength,
    unnodedCrossings: intersections,
    hostBent,
  };
}

function diagnosticsEmpty(value) {
  return Object.values(value).every((items) => items.length === 0);
}

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

const evidence = {
  phase: "2C3A",
  projectId: "masked",
  fixture: CLEAN_WALL_FIXTURE,
  base: {},
  mouse: {},
  arrows: {},
  parity: {},
  holdRelease: {},
  shortcuts: {},
  toolbar: {},
  reload: {},
  ambiguous: {},
  writes: [],
  screenshots: [],
  failures: [],
  startedAt: new Date().toISOString(),
  pass: false,
};
const fail = (message) => evidence.failures.push(message);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => {
    if (isPlanSave(request)) {
      evidence.writes.push({ method: request.method(), pathname: new URL(request.url()).pathname.replace(PROJECT_ID, "***") });
    }
  });

  const state = () => page.evaluate(() => {
    const probe = window.__dgPlanner;
    const plan = probe.plan || {};
    const effectivePlan = probe.effectivePlan || plan;
    return {
      tool: probe.tool,
      probe: JSON.parse(JSON.stringify(probe.probe || null)),
      selection: probe.selection,
      canUndo: probe.canUndo,
      canRedo: probe.canRedo,
      rect: { left: probe.svgRect.left, top: probe.svgRect.top },
      view: probe.view,
      plan,
      effectivePlan,
      resolvedWalls: (probe.resolvedWalls || []).map((wall) => ({
        id: wall.id, a: wall.a, b: wall.b, chainId: wall.chainId || wall.id, thk: wall.thk,
        pts: (wall.pts || []).map((point) => ({ x: point.x, y: point.y })),
      })),
    };
  });
  const screen = (point, snapshot) => ({
    x: snapshot.rect.left + snapshot.view.panX + point.x * snapshot.view.zoom,
    y: snapshot.rect.top + snapshot.view.panY + point.y * snapshot.view.zoom,
  });
  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
    evidence.screenshots.push(name);
  };
  const waitForApiMatch = async (expected, timeoutMs = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const api = await apiProject();
      if (canonical(api.plan || {}) === canonical(expected)) return api;
      await page.waitForTimeout(150);
    }
    throw new Error("browser/API fingerprints did not converge");
  };

  await seedFixture();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(ADMIN_KEY);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }),
    page.locator("form button").first().click(),
  ]);
  await page.goto(`${BASE}/project/${PROJECT_ID}/plan`, { waitUntil: "domcontentloaded" });

  const waitReady = async () => {
    await page.waitForFunction(() => !!window.__dgPlanner?.svgRect && !!window.__dgPlanner?.resolvedWalls, null, { timeout: 45000 });
    await page.getByRole("button", { name: "Выбор", exact: true }).first().click();
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(SETTLE_MS);
  };
  await waitReady();

  const reset = async () => {
    await seedFixture();
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitReady();
    const snapshot = await state();
    await waitForApiMatch(snapshot.plan);
    await page.evaluate(() => {
      if (window.__dgPlanner?.probe) window.__dgPlanner.probe.lastWallMoveResult = null;
      document.activeElement?.blur?.();
    });
    return state();
  };

  const selectWall = async (wallId) => {
    const before = await state();
    const wall = before.resolvedWalls.find((candidate) => candidate.id === wallId);
    if (!wall) throw new Error(`wall ${wallId} not found`);
    const midpoint = {
      x: (wall.pts[0].x + wall.pts.at(-1).x) / 2,
      y: (wall.pts[0].y + wall.pts.at(-1).y) / 2,
    };
    const point = screen(midpoint, before);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction((id) => window.__dgPlanner?.selection?.ids?.includes(id), wallId, { timeout: 5000 });
    await page.waitForTimeout(100);
    return state();
  };

  const dragWall = async (wallId, dyMm, { holdMs = 200, label, expectChanged = true } = {}) => {
    const before = await selectWall(wallId);
    const wall = before.resolvedWalls.find((candidate) => candidate.id === wallId);
    const midpoint = {
      x: (wall.pts[0].x + wall.pts.at(-1).x) / 2,
      y: (wall.pts[0].y + wall.pts.at(-1).y) / 2,
    };
    const handles = page.locator(`circle[cx="${midpoint.x}"][cy="${midpoint.y}"][fill="transparent"]`);
    const handleCount = await handles.count();
    if (handleCount !== 1) throw new Error(`${label}: expected one move handle, found ${handleCount}`);
    const box = await handles.first().boundingBox();
    if (!box) throw new Error(`${label}: move handle has no box`);
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const to = { x: from.x, y: from.y + dyMm * before.view.zoom };
    const writesBefore = evidence.writes.length;
    const beforeFp = canonical(before.plan);
    const beforeTopology = canonical(before.plan, false);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + (to.y - from.y) * 0.4, { steps: 5 });
    await page.waitForTimeout(50);
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.waitForTimeout(holdMs);
    const held = await state();
    const ignoredHostWallIds = wallId === CLEAN_WALL_FIXTURE.wallIds.hostHalf ? [wallId] : [];
    const heldDiagnostics = topologyDiagnostics(held.effectivePlan, held.resolvedWalls, { ignoredHostWallIds });
    const hold = {
      previewMoved: topologyGeometryFingerprint(held.effectivePlan) !== topologyGeometryFingerprint(before.plan),
      committedUnchanged: canonical(held.plan) === beforeFp,
      apiUnchanged: canonical((await apiProject()).plan || {}) === beforeFp,
      writes: evidence.writes.length - writesBefore,
      diagnostics: heldDiagnostics,
      command: held.probe?.lastWallMoveResult || null,
    };
    await shot(`${label}-hold.png`);
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const released = await state();
    const api = await apiProject();
    const release = {
      changed: canonical(released.plan) !== beforeFp,
      writes: evidence.writes.length - writesBefore,
      apiMatches: canonical(api.plan || {}) === canonical(released.plan),
      diagnostics: topologyDiagnostics(released.plan, released.resolvedWalls, { ignoredHostWallIds }),
      command: released.probe?.lastWallMoveResult || held.probe?.lastWallMoveResult || null,
      fingerprint: canonical(released.plan),
      topologyFingerprint: canonical(released.plan, false),
      geometryFingerprint: topologyGeometryFingerprint(released.plan),
    };
    await shot(`${label}-release.png`);
    if (hold.writes !== 0 || !hold.committedUnchanged || !hold.apiUnchanged) fail(`${label}: hold changed committed/API state or wrote`);
    if (expectChanged && (!hold.previewMoved || !release.changed || release.writes !== 1 || !release.apiMatches)) {
      fail(`${label}: expected preview and one-write release`);
    }
    if (!expectChanged && (release.changed || release.writes !== 0)) fail(`${label}: fail-closed move changed or wrote`);
    if (!diagnosticsEmpty(heldDiagnostics) || !diagnosticsEmpty(release.diagnostics)) fail(`${label}: topology diagnostics failed`);
    return { before, beforeFp, beforeTopology, hold, release };
  };

  const arrowWall = async (wallId, label) => {
    const before = await selectWall(wallId);
    const beforeFp = canonical(before.plan);
    const writesBefore = evidence.writes.length;
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(SETTLE_MS);
    const after = await state();
    const api = await apiProject();
    const ignoredHostWallIds = wallId === CLEAN_WALL_FIXTURE.wallIds.hostHalf ? [wallId] : [];
    const result = {
      changed: canonical(after.plan) !== beforeFp,
      writes: evidence.writes.length - writesBefore,
      apiMatches: canonical(api.plan || {}) === canonical(after.plan),
      diagnostics: topologyDiagnostics(after.plan, after.resolvedWalls, { ignoredHostWallIds }),
      command: after.probe?.lastWallMoveResult || null,
      fingerprint: canonical(after.plan),
      geometryFingerprint: topologyGeometryFingerprint(after.plan),
    };
    await shot(`${label}.png`);
    if (!result.changed || result.writes !== 1 || !result.apiMatches || !diagnosticsEmpty(result.diagnostics)) {
      fail(`${label}: arrow move failed or produced invalid topology`);
    }
    return result;
  };

  const initial = await state();
  const initialDiagnostics = topologyDiagnostics(initial.plan, initial.resolvedWalls);
  evidence.base = {
    walls: initial.plan.walls?.length || 0,
    nodes: Object.keys(initial.plan.nodes || {}).length,
    rooms: initial.plan.rooms?.length || 0,
    diagnostics: initialDiagnostics,
    fingerprint: canonical(initial.plan),
    deterministic: canonical(fixturePlan()) === canonical(fixturePlan()),
  };
  await shot("base-fixture.png");
  if (!diagnosticsEmpty(initialDiagnostics) || evidence.base.rooms !== 2 || !evidence.base.deterministic) {
    fail("base fixture is not topology-valid, room-valid, and deterministic");
  }

  const ids = CLEAN_WALL_FIXTURE.wallIds;

  await reset();
  const freeMouse = await dragWall(ids.free, MOVE_MM, { label: "A-free-mouse" });
  evidence.mouse.free = freeMouse;

  await reset();
  const teeMouse = await dragWall(ids.teeBranch, MOVE_MM, { label: "B-tee-mouse", holdMs: HOLD_MS });
  evidence.mouse.teeBranch = teeMouse;
  evidence.holdRelease = { hold: teeMouse.hold, release: teeMouse.release };

  await reset();
  const hostMouse = await dragWall(ids.hostHalf, MOVE_MM, { label: "C-host-half-mouse" });
  evidence.mouse.hostHalf = hostMouse;

  await reset();
  const teeArrow = await arrowWall(ids.teeBranch, "D-tee-arrow");
  evidence.arrows.teeBranch = teeArrow;

  await reset();
  const hostArrow = await arrowWall(ids.hostHalf, "D-host-half-arrow");
  evidence.arrows.hostHalf = hostArrow;

  evidence.parity = {
    teeBranch: teeMouse.release.geometryFingerprint === teeArrow.geometryFingerprint,
    hostHalf: hostMouse.release.geometryFingerprint === hostArrow.geometryFingerprint,
    teeMouse: teeMouse.release.geometryFingerprint,
    teeArrow: teeArrow.geometryFingerprint,
    hostMouse: hostMouse.release.geometryFingerprint,
    hostArrow: hostArrow.geometryFingerprint,
  };
  if (!evidence.parity.teeBranch || !evidence.parity.hostHalf) fail("mouse/arrow topology fingerprint parity failed");

  // H/I/K/J all use one real mouse commit, then the exact history paths.
  await reset();
  const historyMove = await dragWall(ids.teeBranch, MOVE_MM, { label: "history-source" });
  const historyBefore = historyMove.beforeTopology;
  const historyAfter = historyMove.release.fingerprint;

  const shortcut = async (name, init, expectedFingerprint) => {
    const writesBefore = evidence.writes.length;
    await page.evaluate((eventInit) => {
      document.activeElement?.blur?.();
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...eventInit }));
    }, init);
    await page.waitForTimeout(SETTLE_MS);
    const snapshot = await state();
    const result = {
      matches: (init.shiftKey || init.code === "KeyY")
        ? canonical(snapshot.plan) === expectedFingerprint
        : canonical(snapshot.plan, false) === expectedFingerprint,
      writes: evidence.writes.length - writesBefore,
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo,
    };
    evidence.shortcuts[name] = result;
    return result;
  };

  const ruUndo = await shortcut("ctrlPhysicalZRussian", { key: "я", code: "KeyZ", ctrlKey: true }, historyBefore);
  const shiftRedo = await shortcut("ctrlShiftZ", { key: "я", code: "KeyZ", ctrlKey: true, shiftKey: true }, historyAfter);
  const ruUndoAgain = await shortcut("ctrlPhysicalZRussianSecond", { key: "я", code: "KeyZ", ctrlKey: true }, historyBefore);
  const yRedo = await shortcut("ctrlY", { key: "н", code: "KeyY", ctrlKey: true }, historyAfter);
  if (![ruUndo, shiftRedo, ruUndoAgain, yRedo].every((result) => result.matches && result.writes === 1)) {
    fail("physical-layout Undo/Redo shortcut contract failed");
  }

  const toolbarAction = async (name, buttonName, expected, includeRooms) => {
    const writesBefore = evidence.writes.length;
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    await page.waitForTimeout(SETTLE_MS);
    const snapshot = await state();
    const matches = canonical(snapshot.plan, includeRooms) === expected;
    evidence.toolbar[name] = { matches, writes: evidence.writes.length - writesBefore };
    return evidence.toolbar[name];
  };
  const toolbarUndo = await toolbarAction("undo", "↶", historyBefore, false);
  const toolbarRedo = await toolbarAction("redo", "↷", historyAfter, true);
  if (!toolbarUndo.matches || toolbarUndo.writes !== 1 || !toolbarRedo.matches || toolbarRedo.writes !== 1) {
    fail("toolbar Undo/Redo failed");
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitReady();
  const reloaded = await state();
  const reloadedApi = await apiProject();
  evidence.reload = {
    browserMatches: canonical(reloaded.plan) === historyAfter,
    apiMatches: canonical(reloadedApi.plan || {}) === historyAfter,
    browserApiMatch: canonical(reloaded.plan) === canonical(reloadedApi.plan || {}),
    diagnostics: topologyDiagnostics(reloaded.plan, reloaded.resolvedWalls),
  };
  await shot("J-after-reload.png");
  if (!evidence.reload.browserMatches || !evidence.reload.apiMatches || !evidence.reload.browserApiMatch || !diagnosticsEmpty(evidence.reload.diagnostics)) {
    fail("reload/browser/API fingerprint contract failed");
  }

  await reset();
  const ambiguousBefore = await state();
  const historyFlagsBefore = { canUndo: ambiguousBefore.canUndo, canRedo: ambiguousBefore.canRedo };
  const ambiguous = await dragWall(ids.ambiguous, MOVE_MM, {
    label: "ambiguous-degree4",
    expectChanged: false,
  });
  const ambiguousAfter = await state();
  evidence.ambiguous = {
    changed: ambiguous.release.changed,
    reason: ambiguous.release.command?.reason || ambiguous.hold.command?.reason || null,
    planUnchanged: canonical(ambiguousAfter.plan) === canonical(ambiguousBefore.plan),
    historyUnchanged: ambiguousAfter.canUndo === historyFlagsBefore.canUndo && ambiguousAfter.canRedo === historyFlagsBefore.canRedo,
    writes: ambiguous.release.writes,
    diagnostics: ambiguous.release.diagnostics,
  };
  if (
    evidence.ambiguous.changed
    || evidence.ambiguous.reason !== "WALL_MOVE_UNSAFE_MULTI_JUNCTION"
    || !evidence.ambiguous.planUnchanged
    || !evidence.ambiguous.historyUnchanged
    || evidence.ambiguous.writes !== 0
  ) fail("degree-4 ambiguous move did not fail closed deterministically");

  evidence.consoleErrors = errors;
  evidence.finishedAt = new Date().toISOString();
  evidence.pass = evidence.failures.length === 0;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "evidence.json"), JSON.stringify(evidence, null, 2));
  await context.close();
  await browser.close();
  if (!evidence.pass) throw new Error(evidence.failures.join("; "));
  console.log(`PASS: A-K, base=${evidence.base.walls} walls/${evidence.base.nodes} nodes/${evidence.base.rooms} rooms, writes=${evidence.writes.length}`);
}

main().catch((error) => {
  evidence.failures.push(error?.message || String(error));
  evidence.finishedAt = new Date().toISOString();
  evidence.pass = false;
  try { fs.writeFileSync(path.join(EVIDENCE_DIR, "evidence.json"), JSON.stringify(evidence, null, 2)); } catch {}
  console.error(error);
  process.exit(1);
});
