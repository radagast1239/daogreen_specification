/**
 * LEGACY CLICK-CLICK BASELINE — preserved for before/after comparison.
 *
 * - This is the legacy click-click baseline for HEAD 2d3a6f3.
 * - It is kept so we can compare behaviour before and after the B+ drag-release
 *   acceptance test is introduced.
 * - It does NOT define the target UX.
 * - The target drag-release acceptance test will be a separate test.
 *
 * Hardened rules:
 * - No default admin key or project id.
 * - BASE/API must be http:// localhost / 127.0.0.1 / ::1.
 * - EVIDENCE_DIR must be absolute and outside the repository root.
 * - The script never creates or deletes projects; it only reads/writes the
 *   project passed in REVIEW_PROJECT_ID.
 * - Real browser mouse events are used; plan is never mutated directly from
 *   browser JavaScript.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function selfCheck() {
  const n = (id, x, y) => ({ id, x, y });
  const w = (id, a, b, pts) => ({ id, a, b, thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, ...(pts ? { pts } : {}) });
  const r = (id, polygon, area) => ({ id, name: "room", polygon, area });

  const planA = {
    nodes: { n1: n("n1", 0, 0), n2: n("n2", 1000, 0), n3: n("n3", 1000, 1000), n4: n("n4", 0, 1000) },
    walls: [w("w1", "n1", "n2", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]), w("w2", "n2", "n3"), w("w3", "n3", "n4"), w("w4", "n4", "n1")],
    rooms: [r("r1", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], 1000000)],
  };
  const planB = {
    nodes: { n1: n("n1", 0, 0), n2: n("n2", 1000, 0), n3: n("n3", 1000, 1000), n4: n("n4", 0, 1000) },
    walls: [w("w1", "n1", "n2"), w("w2", "n2", "n3"), w("w3", "n3", "n4"), w("w4", "n4", "n1")],
    rooms: [r("r1", [{ x: 1000, y: 1000 }, { x: 0, y: 1000 }, { x: 0, y: 0 }, { x: 1000, y: 0 }], 1000000)],
  };

  const fpA = planFingerprint(planA);
  const fpB = planFingerprint(planB);
  const checks = [];
  checks.push({ name: "pts-ignored", pass: fpA.hash === fpB.hash });

  const planC = { ...planA, nodes: { ...planA.nodes, n2: n("n2", 1001, 0) } };
  checks.push({ name: "node-change-detected", pass: fpA.hash !== planFingerprint(planC).hash });

  const planD = { ...planA, walls: [w("w1", "n1", "n3"), w("w2", "n3", "n4"), w("w3", "n4", "n1")] };
  checks.push({ name: "topology-change-detected", pass: fpA.hash !== planFingerprint(planD).hash });

  const planE = { ...planA, rooms: [r("r1", [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }], 2000000)] };
  checks.push({ name: "room-change-detected", pass: fpA.hash !== planFingerprint(planE).hash });

  console.log("SELF_CHECK:", JSON.stringify(checks, null, 2));
  if (checks.some((c) => !c.pass)) {
    console.error("SELF CHECK FAILED");
    process.exit(1);
  }
}

if (process.env.SELF_CHECK_FINGERPRINT === "1") {
  selfCheck();
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertLocalUrl(name, value) {
  if (!value) throw new Error(`${name} is required`);
  const u = new URL(value);
  if (u.protocol !== "http:") {
    throw new Error(`${name} must use http: protocol, got ${u.protocol}`);
  }
  const allowed = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!allowed.has(u.hostname)) {
    throw new Error(`${name} hostname must be 127.0.0.1, localhost or ::1, got ${u.hostname}`);
  }
}

const BASE = requireEnv("REVIEW_BASE").replace(/\/$/, "");
const API = requireEnv("REVIEW_API").replace(/\/$/, "");
assertLocalUrl("REVIEW_BASE", BASE);
assertLocalUrl("REVIEW_API", API);

const ADMIN_KEY = requireEnv("REVIEW_ADMIN_KEY");
const PROJECT_ID = requireEnv("REVIEW_PROJECT_ID");
const EVIDENCE_DIR = requireEnv("EVIDENCE_DIR");

if (!path.isAbsolute(EVIDENCE_DIR)) {
  throw new Error("EVIDENCE_DIR must be an absolute path");
}
const relativeToRepo = path.relative(REPO_ROOT, EVIDENCE_DIR);
if (!relativeToRepo.startsWith("..") && relativeToRepo !== "") {
  throw new Error("EVIDENCE_DIR must be outside the repository root");
}

const CLICK_GAP_MS = Number(process.env.CLICK_GAP_MS || 200);
const TEMPO_LABEL = process.env.TEMPO_LABEL || `${CLICK_GAP_MS}ms`;

const SHOTS = path.join(EVIDENCE_DIR, "shots");
const TRACE = path.join(EVIDENCE_DIR, "trace");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TRACE, { recursive: true });

function maskProjectId(id) {
  if (typeof id !== "string" || id.length < 4) return "***";
  return id.slice(0, 2) + "***" + id.slice(-2);
}

function maskUrl(url) {
  if (typeof url !== "string") return url;
  return url.replace(/(\/api\/projects\/)([^/?]+)/g, (_m, p1, p2) => `${p1}${maskProjectId(p2)}`);
}

function polygonArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(area) / 2;
}

function normalizePolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return [];
  const rounded = poly.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  // Drop duplicate closing vertex.
  if (rounded.length > 1
    && rounded[0].x === rounded[rounded.length - 1].x
    && rounded[0].y === rounded[rounded.length - 1].y) {
    rounded.pop();
  }
  if (rounded.length < 3) return rounded;

  // Canonical start: lowest y, then lowest x.
  let startIdx = 0;
  for (let i = 1; i < rounded.length; i++) {
    const a = rounded[startIdx], b = rounded[i];
    if (b.y < a.y || (b.y === a.y && b.x < a.x)) startIdx = i;
  }
  const rotated = [...rounded.slice(startIdx), ...rounded.slice(0, startIdx)];

  // Ensure counter-clockwise orientation.
  let signed = 0;
  for (let i = 0; i < rotated.length; i++) {
    const j = (i + 1) % rotated.length;
    signed += rotated[i].x * rotated[j].y - rotated[j].x * rotated[i].y;
  }
  if (signed < 0) rotated.reverse();
  return rotated;
}

function canonicalNodes(plan) {
  return Object.entries(plan.nodes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => ({ id, x: Math.round(n.x), y: Math.round(n.y) }));
}

function canonicalWalls(plan) {
  const nodes = plan.nodes || {};
  const out = [];
  let fallbackCount = 0;
  for (const w of plan.walls || []) {
    if (w.a && w.b && nodes[w.a] && nodes[w.b]) {
      out.push({
        id: w.id,
        a: w.a,
        b: w.b,
        thk: w.thk ?? 100,
        thicknessSide: w.thicknessSide || "center",
        height: w.height ?? 3000,
      });
      continue;
    }
    // Fallback for legacy pt-only walls: derive deterministic pseudo endpoints.
    const pts = (w.pts || []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    if (pts.length >= 2) {
      fallbackCount += 1;
      out.push({
        id: w.id,
        a: `pt_${pts[0].x}_${pts[0].y}`,
        b: `pt_${pts[pts.length - 1].x}_${pts[pts.length - 1].y}`,
        thk: w.thk ?? 100,
        thicknessSide: w.thicknessSide || "center",
        height: w.height ?? 3000,
        fallback: true,
      });
    }
  }
  return { walls: out.sort((a, b) => a.id.localeCompare(b.id)), fallbackCount };
}

function canonicalRooms(plan) {
  const rooms = (plan.rooms || [])
    .map((r) => {
      const polygon = normalizePolygon(r.polygon);
      return {
        area: Math.round(r.area != null ? r.area : polygonArea(r.polygon)),
        polygon,
        name: r.name,
      };
    })
    .filter((r) => r.polygon.length >= 3)
    .sort((a, b) => {
      if (a.area !== b.area) return a.area - b.area;
      const ap = a.polygon[0], bp = b.polygon[0];
      if (ap.x !== bp.x) return ap.x - bp.x;
      return ap.y - bp.y;
    });
  return rooms;
}

function planFingerprint(plan) {
  const nodes = canonicalNodes(plan);
  const { walls, fallbackCount } = canonicalWalls(plan);
  const rooms = canonicalRooms(plan);
  return {
    hash: JSON.stringify({ nodes, walls, rooms }),
    nodes,
    walls,
    rooms,
    fallbackCount,
  };
}

function countPts(walls) {
  return (walls || []).filter((w) => Array.isArray(w.pts) && w.pts.length > 0).length;
}

function countDiagonals(walls) {
  const AXIS_EPS_MM = 3;
  return walls.filter((w) => {
    if (!w.pts || w.pts.length < 2) return false;
    const dx = Math.abs(w.pts[1].x - w.pts[0].x);
    const dy = Math.abs(w.pts[1].y - w.pts[0].y);
    return dx > AXIS_EPS_MM && dy > AXIS_EPS_MM;
  });
}

function countOrphanNodes(nodes, walls) {
  const nodeIds = Object.keys(nodes || {});
  return nodeIds.filter((id) => walls.every((w) => w.a !== id && w.b !== id));
}

async function apiGetProject() {
  const res = await fetch(`${API}/api/projects/${PROJECT_ID}`, {
    headers: { "X-Admin-Key": ADMIN_KEY },
  });
  if (!res.ok) throw new Error(`GET project failed: ${res.status}`);
  const data = await res.json();
  return data.plan || data.project?.plan || {};
}

const ev = {
  baselineKind: "legacy-click-click",
  branch: "",
  head: "",
  baseUrl: BASE,
  apiUrl: API,
  projectIdMask: maskProjectId(PROJECT_ID),
  clickGapMs: CLICK_GAP_MS,
  tempoLabel: TEMPO_LABEL,
  timeline: [],
  screenshots: [],
  failures: [],
  consoleErrors: [],
  backendErrors: [],
  patchCount: 0,
  navigationRetries: 0,
  geometryFingerprints: {},
  canonicalFingerprintVersion: 2,
  ignoredDerivedFields: ["walls[].pts"],
  runtimePtsPresentCount: 0,
  persistedPtsPresentCount: 0,
  wallCount: 0,
  roomCount: 0,
  diagonalCount: 0,
  diagonalWallIds: [],
  orphanNodeCount: 0,
  draftLen: null,
  gesturePhase: null,
  wallToolActive: false,
  undo: null,
  redo: null,
  reload: null,
  autosave: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  pass: false,
};

try {
  ev.branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
} catch {}
try {
  ev.head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {}

let browser = null;
let context = null;
let page = null;

async function navigateToProjectPlan() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      ev.navigationRetries += 1;
      console.log(`[${TEMPO_LABEL}] navigation retry ${attempt - 1}`);
      await page.waitForTimeout(1000);
    }
    try {
      await page.goto(`${BASE}/project/${PROJECT_ID}/plan`, { waitUntil: "domcontentloaded" });
      await page.waitForURL((u) => u.pathname === `/project/${PROJECT_ID}/plan`, { timeout: 15000 });
      await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

async function main() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: TRACE, size: { width: 1600, height: 1000 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  page = await context.newPage();

  page.on("console", (m) => { if (m.type() === "error") ev.consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => ev.consoleErrors.push(String(e)));
  page.on("response", (r) => {
    if (r.url().startsWith(API) && r.status() >= 400) {
      ev.backendErrors.push({ url: maskUrl(r.url()), status: r.status() });
    }
  });
  page.on("request", (r) => {
    if (r.url().startsWith(API) && (r.method() === "PATCH" || r.method() === "PUT")) {
      ev.patchCount += 1;
    }
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(ADMIN_KEY);
  await page.locator("form button").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});

  await navigateToProjectPlan();

  const state = () => page.evaluate(() => {
    const d = window.__dgPlanner;
    const p = d.plan || {};
    const walls = d.resolvedWalls?.length ? d.resolvedWalls : (p.walls || []);
    return {
      tool: d.tool,
      draftLen: d.draftLen,
      gesturePhase: d.gesturePhase,
      view: { panX: d.view.panX, panY: d.view.panY, zoom: d.view.zoom },
      rect: { left: d.svgRect.left, top: d.svgRect.top, w: d.svgRect.width, h: d.svgRect.height },
      wallCount: walls.length,
      nodeCount: Object.keys(p.nodes || {}).length,
      rooms: (p.rooms || []).map((r) => ({ id: r.id, name: r.name, area: r.area, polygon: r.polygon })),
      selection: d.selection,
      walls: walls.map((w) => ({ id: w.id, a: w.a, b: w.b, pts: (w.pts || []).map((q) => ({ x: q.x, y: q.y })) })),
      nodes: p.nodes || {},
    };
  });

  async function w2s(mx, my) {
    const s = await state();
    return { x: s.rect.left + s.view.panX + mx * s.view.zoom, y: s.rect.top + s.view.panY + my * s.view.zoom };
  }

  async function shot(name) {
    const full = name;
    await page.screenshot({ path: path.join(SHOTS, full) });
    ev.screenshots.push(full);
  }

  async function click(mx, my, label) {
    const p = await w2s(mx, my);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(CLICK_GAP_MS);
    const s = await state();
    ev.timeline.push({
      label, worldPoint: { x: mx, y: my },
      tool: s.tool, draftLen: s.draftLen, gesturePhase: s.gesturePhase,
      wallCount: s.wallCount, nodeCount: s.nodeCount, roomCount: s.rooms.length,
    });
    return s;
  }

  async function drawClosedRect(x0, y0, x1, y1, label) {
    await click(x0, y0, `${label}-A`);
    await click(x1, y0, `${label}-B`);
    await click(x1, y1, `${label}-C`);
    await click(x0, y1, `${label}-D`);
    return click(x0, y0, `${label}-CLOSE`);
  }

  await page.getByRole("button", { name: "Стены", exact: true }).first().click();
  await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 10000 });

  // Zoom to fit a 12x9 m sheet.
  {
    const s = await state();
    await page.mouse.move(s.rect.left + s.rect.w / 2, s.rect.top + s.rect.h / 2);
    for (let i = 0; i < 60; i++) {
      const cur = await state();
      if (12000 * cur.view.zoom <= cur.rect.w * 0.85 && 9000 * cur.view.zoom <= cur.rect.h * 0.85) break;
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(30);
    }
  }

  const s0 = await state();
  const snap50 = (v) => Math.round(v / 50) * 50;
  const visX0 = (0 - s0.view.panX) / s0.view.zoom;
  const visY0 = (0 - s0.view.panY) / s0.view.zoom;
  const OX0 = snap50(visX0 + 300);
  const OY0 = snap50(visY0 + 300);
  const OX1 = OX0 + 10000;
  const OY1 = OY0 + 7000;

  // Outer rectangle.
  const afterOuter = await drawClosedRect(OX0, OY0, OX1, OY1, "outer");
  if (afterOuter.wallCount !== 4 || afterOuter.draftLen !== 0) {
    ev.failures.push(`outer rectangle did not close cleanly: walls=${afterOuter.wallCount} draftLen=${afterOuter.draftLen}`);
  }

  // Four inner rectangles, non-touching, one per quadrant.
  const pad = 700, innerW = 2600, innerH = 1900;
  const quadrants = [
    [OX0 + pad, OY0 + pad],
    [OX0 + pad + innerW + pad, OY0 + pad],
    [OX0 + pad, OY0 + pad + innerH + pad],
    [OX0 + pad + innerW + pad, OY0 + pad + innerH + pad],
  ];
  for (let i = 0; i < 4; i++) {
    const [ix0, iy0] = quadrants[i];
    const before = await state();
    const after = await drawClosedRect(ix0, iy0, ix0 + innerW, iy0 + innerH, `inner${i + 1}`);
    if (after.wallCount !== before.wallCount + 4 || after.draftLen !== 0) {
      ev.failures.push(`inner${i + 1} did not close as its own independent 4-wall shape: before=${before.wallCount} after=${after.wallCount} draftLen=${after.draftLen}`);
    }
  }

  await shot("rectangles.png");
  const cn = await w2s(OX0, OY0);
  await page.screenshot({
    path: path.join(SHOTS, "closeup.png"),
    clip: { x: Math.max(0, cn.x - 150), y: Math.max(0, cn.y - 150), width: 400, height: 400 },
  });
  ev.screenshots.push("closeup.png");

  const final = await state();
  ev.wallCount = final.wallCount;
  ev.roomCount = final.rooms.length;
  ev.draftLen = final.draftLen;
  ev.gesturePhase = final.gesturePhase;
  ev.wallToolActive = final.tool === "wall";
  ev.runtimePtsPresentCount = countPts(final.walls);

  if (final.wallCount !== 20) ev.failures.push(`expected 20 walls total, got ${final.wallCount}`);
  if (final.rooms.length !== 5) ev.failures.push(`expected 5 rooms, got ${final.rooms.length}`);
  if (final.draftLen !== 0) ev.failures.push(`expected draftLen=0, got ${final.draftLen}`);
  if (final.gesturePhase !== "idle") ev.failures.push(`expected gesturePhase=idle, got ${final.gesturePhase}`);
  if (!ev.wallToolActive) ev.failures.push("Wall tool is not active after drawing all five contours");

  const diagonals = countDiagonals(final.walls);
  ev.diagonalCount = diagonals.length;
  ev.diagonalWallIds = diagonals.map((w) => w.id);
  if (diagonals.length !== 0) ev.failures.push(`expected 0 diagonal walls, got ${diagonals.length}: ${ev.diagonalWallIds.join(",")}`);

  const orphans = countOrphanNodes(final.nodes, final.walls);
  ev.orphanNodeCount = orphans.length;
  if (orphans.length !== 0) ev.failures.push(`expected 0 orphan nodes, got ${orphans.length}`);

  const browserFp = planFingerprint(final);
  ev.geometryFingerprints.committedBrowser = browserFp.hash;

  // Wait for autosave, then verify persisted plan via API.
  await page.waitForTimeout(3000);

  let savedPlan = null;
  try {
    savedPlan = await apiGetProject();
    const savedFp = planFingerprint(savedPlan);
    ev.persistedPtsPresentCount = countPts(savedPlan.walls);
    ev.geometryFingerprints.savedApi = savedFp.hash;
    ev.autosave = {
      patchCount: ev.patchCount,
      browserSavedMatch: browserFp.hash === savedFp.hash,
      runtimeFallbackCount: browserFp.fallbackCount,
      savedFallbackCount: savedFp.fallbackCount,
    };
    if (ev.patchCount === 0) ev.failures.push("expected at least one autosave PATCH/PUT, got 0");
    if (!ev.autosave.browserSavedMatch) {
      ev.failures.push("saved API plan fingerprint does not match committed browser plan");
    }
  } catch (e) {
    ev.failures.push(`autosave API check failed: ${e.message}`);
    ev.autosave = { error: e.message, patchCount: ev.patchCount };
  }

  // Undo / Redo.
  const beforeUndo = await state();
  const beforeUndoFp = planFingerprint(beforeUndo);
  await page.locator("body").click({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    (want) => (window.__dgPlanner?.plan?.walls || []).length !== want,
    beforeUndo.wallCount, { timeout: 15000 },
  ).catch(() => {});
  const undoState = await state();
  await shot("after-undo.png");
  ev.undo = {
    before: beforeUndo.wallCount,
    after: undoState.wallCount,
    changed: undoState.wallCount !== beforeUndo.wallCount,
    diagonalCount: countDiagonals(undoState.walls).length,
    orphanNodeCount: countOrphanNodes(undoState.nodes, undoState.walls).length,
  };
  if (!ev.undo.changed) ev.failures.push("Undo did not change the plan");
  if (ev.undo.diagonalCount !== 0) ev.failures.push(`Undo produced ${ev.undo.diagonalCount} diagonal walls`);

  await page.keyboard.press("Control+y");
  await page.waitForFunction(
    (want) => (window.__dgPlanner?.plan?.walls || []).length === want,
    beforeUndo.wallCount, { timeout: 15000 },
  ).catch(() => {});
  const redoState = await state();
  await shot("after-redo.png");
  const redoFp = planFingerprint(redoState);
  ev.redo = {
    restored: redoState.wallCount === beforeUndo.wallCount,
    fingerprintMatch: redoFp.hash === beforeUndoFp.hash,
    diagonalCount: countDiagonals(redoState.walls).length,
    orphanNodeCount: countOrphanNodes(redoState.nodes, redoState.walls).length,
  };
  if (!ev.redo.restored) ev.failures.push("Redo did not restore the 20-wall plan");
  if (!ev.redo.fingerprintMatch) ev.failures.push("Redo plan fingerprint does not match pre-Undo fingerprint");
  if (ev.redo.diagonalCount !== 0) ev.failures.push(`Redo produced ${ev.redo.diagonalCount} diagonal walls`);

  // Reload.
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
  await page.waitForFunction(
    (want) => (window.__dgPlanner?.plan?.walls || []).length === want,
    redoState.wallCount, { timeout: 25000 },
  ).catch(() => {});
  const reloadState = await state();
  await shot("after-reload.png");
  const reloadFp = planFingerprint(reloadState);
  ev.reload = {
    before: redoState.wallCount,
    after: reloadState.wallCount,
    wallCountMatch: reloadState.wallCount === redoState.wallCount,
    fingerprintMatch: reloadFp.hash === beforeUndoFp.hash,
    diagonalCount: countDiagonals(reloadState.walls).length,
    orphanNodeCount: countOrphanNodes(reloadState.nodes, reloadState.walls).length,
  };
  if (!ev.reload.wallCountMatch) ev.failures.push("reload changed the wall count");
  if (!ev.reload.fingerprintMatch) ev.failures.push("reload plan fingerprint does not match committed plan");
  if (ev.reload.diagonalCount !== 0) ev.failures.push(`reload produced ${ev.reload.diagonalCount} diagonal walls`);
  if (ev.reload.orphanNodeCount !== 0) ev.failures.push(`reload produced ${ev.reload.orphanNodeCount} orphan nodes`);

  await context.tracing.stop({ path: path.join(TRACE, `trace-${TEMPO_LABEL}.zip`) });
}

function finalize() {
  ev.finishedAt = new Date().toISOString();
  ev.pass = ev.failures.length === 0;
  const outFile = path.join(EVIDENCE_DIR, `evidence-${TEMPO_LABEL}.json`);
  fs.writeFileSync(outFile, JSON.stringify(ev, null, 2));
  console.log(`[${TEMPO_LABEL}] walls=${ev.wallCount} rooms=${ev.roomCount} diagonals=${ev.diagonalCount} orphans=${ev.orphanNodeCount} failures=${JSON.stringify(ev.failures)}`);
  console.log("-> " + outFile);
}

main()
  .catch((e) => {
    ev.failures.push(`fatal: ${e?.message || e}`);
    console.error(e);
  })
  .finally(async () => {
    try { if (context) await context.tracing.stop({ path: path.join(TRACE, `trace-${TEMPO_LABEL}.zip`) }); } catch {}
    try { if (browser) await browser.close(); } catch {}
    finalize();
    if (ev.failures.length) process.exitCode = 1;
  });
