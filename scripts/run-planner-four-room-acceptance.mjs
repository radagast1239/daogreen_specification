/**
 * Real-browser acceptance for consecutive wall drawing in PlanPage.
 *
 * Drives the actual Planner route with real mouse/pointer events only.
 * Never calls commitDrawnWall, never imports a finished plan, never mutates
 * plan state from browser JS — window.__dgPlanner is read-only observation.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const OUT = process.env.EVIDENCE_DIR
  || path.join(process.env.TEMP || process.env.TMPDIR || ".", "daogreen-planner-wall-final-claude");
const SHOTS = path.join(OUT, "shots");
const TRACE = path.join(OUT, "trace");
const ADMIN_KEY = process.env.REVIEW_ADMIN_KEY || "local-planner-review-key";
const BASE = (process.env.REVIEW_BASE || "http://127.0.0.1:5311").replace(/\/$/, "");
const API = (process.env.REVIEW_API || "http://127.0.0.1:3311").replace(/\/$/, "");
const PROJECT_ID = process.env.REVIEW_PROJECT_ID || "";

// Rectangle + partition geometry (world mm). Derived from the real visible
// viewport after zooming out through the toolbar, so every click lands on canvas.
const RECT_W = 8000, RECT_H = 6000;
let X0 = 0, Y0 = 0, X1 = RECT_W, Y1 = RECT_H;
let MIDX = RECT_W / 2, MIDY = RECT_H / 2;

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TRACE, { recursive: true });

const ev = {
  finalHEAD: (() => {
    try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; }
  })(),
  baseUrl: BASE,
  projectId: PROJECT_ID,
  browserActions: [],
  steps: [],
  hostBeforeAfter: [],
  probe: null,
  invalidCrossings: null,
  rooms: null,
  dimensions: [],
  selectedVsUnselectedAnchors: null,
  patchCount: 0,
  undoRedo: null,
  reloadEquality: null,
  consoleErrors: [],
  backendErrors: [],
  screenshots: [],
  failures: [],
};

const log = (...a) => console.log(...a);

async function main() {
  if (!PROJECT_ID) throw new Error("REVIEW_PROJECT_ID is required");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: TRACE, size: { width: 1600, height: 1000 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();

  page.on("console", (m) => { if (m.type() === "error") ev.consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => ev.consoleErrors.push(String(e)));
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API) && r.status() >= 400) {
      ev.backendErrors.push({ url: u.replace(API, "{API}"), status: r.status() });
    }
  });
  page.on("request", (r) => {
    if (r.url().startsWith(API) && (r.method() === "PATCH" || r.method() === "PUT")) ev.patchCount += 1;
  });

  // ---------- auth through the normal local login form ----------
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(ADMIN_KEY);
  await page.locator("form button").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
  ev.browserActions.push("login via form");

  // ---------- open the real Planner route ----------
  await page.goto(`${BASE}/project/${PROJECT_ID}/plan`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
  ev.browserActions.push(`open /project/${PROJECT_ID}/plan`);

  const state = () => page.evaluate(() => {
    const d = window.__dgPlanner;
    if (!d) return null;
    const p = d.plan || {};
    // resolvedWalls carry derived pts; plan.walls[].pts is absent on a fresh load.
    const walls = (d.resolvedWalls && d.resolvedWalls.length) ? d.resolvedWalls : (p.walls || []);
    return {
      at: d.at,
      tool: d.tool,
      draftLen: d.draftLen,
      gesturePhase: d.gesturePhase,
      probe: { ...(d.probe || {}) },
      selection: d.selection,
      view: { panX: d.view.panX, panY: d.view.panY, zoom: d.view.zoom },
      rect: { left: d.svgRect.left, top: d.svgRect.top, w: d.svgRect.width, h: d.svgRect.height },
      wallCount: walls.length,
      nodeCount: Object.keys(p.nodes || {}).length,
      rooms: (p.rooms || []).map((r) => ({
        id: r.id, name: r.name,
        polygon: (r.polygon || []).map((q) => ({ x: q.x, y: q.y })),
        labelPos: r.labelPos || r.centroid || null,
        areaM2: r.areaM2,
      })),
      runtimeDimCount: (d.runtimeDimensions || []).length,
      walls: walls.map((w) => ({
        id: w.id, a: w.a, b: w.b, role: w.role, thk: w.thk,
        pts: (w.pts || []).map((q) => ({ x: q.x, y: q.y })),
      })),
      nodes: Object.fromEntries(Object.entries(p.nodes || {}).map(([k, v]) => [k, { x: v.x, y: v.y }])),
      dimensions: (p.dimensions || []).map((d2) => ({
        id: d2.id, kind: d2.kind, wallId: d2.wallId, roomId: d2.roomId,
        ref: d2.ref || d2.reference || null,
        refKind: d2.refKind || d2.ref?.kind || null,
        p1: d2.p1, p2: d2.p2, value: d2.value, auto: d2.auto,
      })),
      warnings: (p.validationWarnings || []).map((w) => ({ code: w.code || w.kind, msg: w.message })),
    };
  });

  async function w2s(mx, my) {
    const s = await state();
    return {
      x: s.rect.left + s.view.panX + mx * s.view.zoom,
      y: s.rect.top + s.view.panY + my * s.view.zoom,
    };
  }

  async function shot(name) {
    await page.screenshot({ path: path.join(SHOTS, name) });
    ev.screenshots.push(name);
    log("  shot", name);
  }

  /**
   * Wait until autosave has stopped writing, so a PATCH-sensitive measurement
   * counts only what the gesture under test caused. Autosave is time-driven and
   * unrelated to the gesture, so without this a background flush lands inside the
   * window and is misread as "opening properties issued a PATCH".
   */
  async function quiesceAutosave(stableMs = 2500, capMs = 20000) {
    const started = Date.now();
    let last = ev.patchCount;
    let lastChange = Date.now();
    while (Date.now() - started < capMs) {
      await page.waitForTimeout(250);
      if (ev.patchCount !== last) {
        last = ev.patchCount;
        lastChange = Date.now();
      } else if (Date.now() - lastChange >= stableMs) {
        return true;
      }
    }
    return false;
  }

  // ---------- activate the Wall tool through the real toolbar ----------
  await page.getByRole("button", { name: "Стены", exact: true }).first().click();
  await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 10000 });
  ev.browserActions.push('click toolbar "Стены" -> tool=wall');

  // Fit so the whole 12x8 m sheet is addressable on screen.

  // Zoom out with a real wheel gesture over the canvas until the rectangle fits.
  {
    const s = await state();
    const cx = s.rect.left + s.rect.w / 2;
    const cy = s.rect.top + s.rect.h / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 60; i++) {
      const cur = await state();
      if (RECT_W * cur.view.zoom <= cur.rect.w * 0.7 && RECT_H * cur.view.zoom <= cur.rect.h * 0.7) break;
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(40);
    }
  }
  ev.browserActions.push("wheel zoom-out over canvas until rectangle fits");

  const s0 = await state();
  log("view", JSON.stringify(s0.view), "rect", JSON.stringify(s0.rect));
  if (s0.tool !== "wall") throw new Error("wall tool not active");

  // Center the rectangle inside the currently visible world extent, snapped to
  // the 50 mm grid the planner uses at this zoom.
  {
    const snap50 = (v) => Math.round(v / 50) * 50;
    const visX0 = (0 - s0.view.panX) / s0.view.zoom;
    const visY0 = (0 - s0.view.panY) / s0.view.zoom;
    const visX1 = (s0.rect.w - s0.view.panX) / s0.view.zoom;
    const visY1 = (s0.rect.h - s0.view.panY) / s0.view.zoom;
    const cx = (visX0 + visX1) / 2;
    const cy = (visY0 + visY1) / 2;
    X0 = snap50(cx - RECT_W / 2);
    Y0 = snap50(cy - RECT_H / 2);
    X1 = X0 + RECT_W;
    Y1 = Y0 + RECT_H;
    MIDX = snap50(X0 + RECT_W / 2);
    MIDY = snap50(Y0 + RECT_H / 2);
    ev.geometry = { X0, Y0, X1, Y1, MIDX, MIDY, zoom: s0.view.zoom };
    log("rect world", JSON.stringify(ev.geometry));
  }

  /** One real click: move -> down -> up, then wait for the app to settle. */
  async function click(mx, my, label) {
    const p = await w2s(mx, my);
    if (p.x < 0 || p.y < 0 || p.x > 1600 || p.y > 1000) {
      throw new Error(`point ${label} (${mx},${my}) maps off-screen: ${JSON.stringify(p)}`);
    }
    const before = await state();
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.down();
    await page.mouse.up();
    // Settle on a real state change rather than a fixed sleep.
    await page.waitForFunction(
      (prev) => {
        const d = window.__dgPlanner;
        if (!d) return false;
        return d.at !== prev.at || d.draftLen !== prev.draftLen;
      },
      { at: before.at, draftLen: before.draftLen },
      { timeout: 8000 },
    ).catch(() => {});
    const after = await state();
    ev.browserActions.push(`click ${label} @world(${mx},${my}) screen(${Math.round(p.x)},${Math.round(p.y)})`);
    ev.steps.push({
      action: `click ${label}`,
      tool: after.tool,
      draftLen: after.draftLen,
      gesturePhase: after.gesturePhase,
      walls: after.wallCount,
      nodes: after.nodeCount,
      rooms: after.rooms.length,
      probe: after.probe,
    });
    return after;
  }

  async function waitRooms(n, why) {
    await page.waitForFunction(
      (want) => (window.__dgPlanner?.plan?.rooms || []).length === want,
      n,
      { timeout: 20000 },
    );
    log(`  rooms == ${n} (${why})`);
  }

  async function waitWalls(n, why) {
    await page.waitForFunction(
      (want) => (window.__dgPlanner?.plan?.walls || []).length === want,
      n,
      { timeout: 20000 },
    );
    log(`  walls == ${n} (${why})`);
  }

  // =====================================================================
  // STEP 1 — closed rectangle, drawn click-by-click through the real canvas
  // =====================================================================
  log("STEP 1: rectangle");
  await click(X0, Y0, "rect-corner-1");
  await click(X1, Y0, "rect-corner-2");
  await click(X1, Y1, "rect-corner-3");
  await click(X0, Y1, "rect-corner-4");
  await click(X0, Y0, "rect-close-on-start");
  await page.keyboard.press("Enter");
  ev.browserActions.push("Enter -> finish wall chain");
  await waitWalls(4, "rectangle committed");
  await waitRooms(1, "rectangle is one room");
  await shot("01-rectangle.png");

  const afterRect = await state();
  if (afterRect.tool !== "wall") ev.failures.push("wall tool lost after rectangle commit");

  // =====================================================================
  // STEP 2-3 — vertical partition: top wall -> bottom wall
  // =====================================================================
  log("STEP 2-3: vertical partition");
  const topWallBefore = afterRect.walls.find((w) => hostMatch(w, MIDX, Y0));
  const botWallBefore = afterRect.walls.find((w) => hostMatch(w, MIDX, Y1));

  const st2 = await click(MIDX, Y0, "start-on-top-wall");
  if (st2.gesturePhase === "idle" && st2.draftLen === 0) {
    ev.failures.push("single click on host wall did not start a pending draft");
  }
  if (st2.selection?.coll === "walls") ev.failures.push("wall got selected while starting a draft");
  await shot("02-start-from-top-wall.png");

  await click(MIDX, Y1, "end-on-bottom-wall");
  await waitRooms(2, "vertical partition splits rectangle");
  await shot("03-two-rooms.png");

  const afterV = await state();
  ev.hostBeforeAfter.push(hostEvidence("vertical-start", topWallBefore, afterV, MIDX, Y0));
  ev.hostBeforeAfter.push(hostEvidence("vertical-end", botWallBefore, afterV, MIDX, Y1));
  if (afterV.tool !== "wall") ev.failures.push("wall tool lost after 2nd commit");

  // =====================================================================
  // STEP 4-5 — horizontal partition: left wall -> central vertical wall
  // =====================================================================
  log("STEP 4-5: left horizontal partition");
  const leftWallBefore = afterV.walls.find((w) => hostMatch(w, X0, MIDY));
  const centralBefore = afterV.walls.find((w) => hostMatch(w, MIDX, MIDY));

  await click(X0, MIDY, "start-on-left-wall");
  await click(MIDX, MIDY, "end-on-central-vertical");
  await waitRooms(3, "left partition -> 3 rooms");
  await shot("04-three-rooms.png");

  const afterH1 = await state();
  ev.hostBeforeAfter.push(hostEvidence("left-start", leftWallBefore, afterH1, X0, MIDY));
  ev.hostBeforeAfter.push(hostEvidence("central-end", centralBefore, afterH1, MIDX, MIDY));
  if (afterH1.tool !== "wall") ev.failures.push("wall tool lost after 3rd commit");

  // =====================================================================
  // STEP 6-8 — from the central cross node to the right outer wall
  // This is the step that previously never happened.
  // =====================================================================
  log("STEP 6-8: from central node to right wall");
  const st6 = await click(MIDX, MIDY, "start-on-central-cross-node");
  if (st6.draftLen === 0 && st6.gesturePhase === "idle") {
    ev.failures.push("click on central cross node did not start a draft (post-commit click swallowed)");
  }
  await shot("05-start-from-cross-node.png");

  const rightBefore = afterH1.walls.find((w) => hostMatch(w, X1, MIDY));
  await click(X1, MIDY, "end-on-right-outer-wall");
  await waitRooms(4, "fourth partition -> 4 rooms");
  await shot("06-four-rooms.png");

  const afterH2 = await state();
  ev.hostBeforeAfter.push(hostEvidence("right-end", rightBefore, afterH2, X1, MIDY));
  ev.rooms = afterH2.rooms;
  ev.probe = afterH2.probe;
  ev.invalidCrossings = afterH2.warnings.filter((w) => /cross|intersect|invalid/i.test(String(w.code || w.msg || "")));

  // cross-node closeup
  const cn = await w2s(MIDX, MIDY);
  await page.screenshot({
    path: path.join(SHOTS, "07-cross-node-closeup.png"),
    clip: { x: Math.max(0, cn.x - 220), y: Math.max(0, cn.y - 180), width: 440, height: 360 },
  });
  ev.screenshots.push("07-cross-node-closeup.png");

  // node valences at the cross node
  ev.crossNode = await page.evaluate(({ mx, my }) => {
    const p = window.__dgPlanner.plan;
    const nodes = p.nodes || {};
    const walls = p.walls || [];
    let id = null;
    let best = 1e9;
    for (const [k, v] of Object.entries(nodes)) {
      const d = Math.hypot(v.x - mx, v.y - my);
      if (d < best) { best = d; id = k; }
    }
    const inc = walls.filter((w) => w.a === id || w.b === id);
    const valences = {};
    for (const [k] of Object.entries(nodes)) {
      valences[k] = walls.filter((w) => w.a === k || w.b === k).length;
    }
    return {
      nodeId: id,
      distanceMm: best,
      valence: inc.length,
      incidentWallIds: inc.map((w) => w.id),
      allValences: valences,
      orphanNodes: Object.keys(nodes).filter((k) => walls.every((w) => w.a !== k && w.b !== k)),
    };
  }, { mx: MIDX, my: MIDY });

  // ---------- dimensions (runtime-derived; plan.dimensions holds only manual) ----------
  ev.dimensions = await collectDims(page);
  ev.dimensionSummary = summarizeDims(ev.dimensions);
  await shot("08-internal-dimensions.png");
  await shot("09-external-dimensions.png");

  // ---------- room identities + rendered label containment ----------
  ev.roomIdentities = {
    roomCount: afterH2.rooms.length,
    ids: afterH2.rooms.map((r) => r.id),
    names: afterH2.rooms.map((r) => r.name),
    uniqueIdCount: new Set(afterH2.rooms.map((r) => r.id)).size,
    uniqueNameCount: new Set(afterH2.rooms.map((r) => r.name)).size,
    areasM2: afterH2.rooms.map((r) => r.areaM2),
  };
  if (ev.roomIdentities.uniqueIdCount !== 4) ev.failures.push("room IDs are not 4 unique values");
  if (ev.roomIdentities.uniqueNameCount !== 4) ev.failures.push("room names are not 4 unique values");

  // Labels are rendered from zones, not stored on the room, so read them off the
  // real DOM and map screen -> world to test containment.
  {
    const st = await state();
    const raw = await page.evaluate(() => {
      const g = document.querySelector("[data-room-labels]");
      if (!g) return [];
      return [...g.querySelectorAll("text")].map((t) => {
        const r = t.getBoundingClientRect();
        return {
          text: (t.textContent || "").trim(),
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        };
      });
    });
    ev.roomLabelsRendered = raw
      .filter((l) => /Помещение/.test(l.text))
      .map((l) => {
        const world = {
          x: (l.cx - st.rect.left - st.view.panX) / st.view.zoom,
          y: (l.cy - st.rect.top - st.view.panY) / st.view.zoom,
        };
        const owning = st.rooms.filter((r) => pointInPoly(world, r.polygon));
        return {
          text: l.text,
          world,
          insideRoomIds: owning.map((r) => r.id),
          insideRoomNames: owning.map((r) => r.name),
          matchesOwnRoom: owning.some((r) => l.text.includes(r.name)),
        };
      });
    const visibleNames = ev.roomLabelsRendered.map((l) => l.text);
    ev.roomIdentities.renderedLabelTexts = visibleNames;
    ev.roomIdentities.renderedLabelsUnique = new Set(visibleNames).size === visibleNames.length;
    ev.roomIdentities.allLabelsInsideOwnRoom = ev.roomLabelsRendered.length > 0
      && ev.roomLabelsRendered.every((l) => l.matchesOwnRoom);
    if (visibleNames.length && !ev.roomIdentities.renderedLabelsUnique) {
      ev.failures.push(`duplicate rendered room labels: ${JSON.stringify(visibleNames)}`);
    }
    if (visibleNames.length && !ev.roomIdentities.allLabelsInsideOwnRoom) {
      ev.failures.push("a room label is not inside its own room polygon");
    }
  }

  // =====================================================================
  // UNDO / REDO of the fourth partition (keyboard needs body focus)
  // =====================================================================
  log("UNDO/REDO");
  const beforeUndo = await state();
  const hostsBeforeUndo = beforeUndo.walls.map((w) => ({ id: w.id, pts: w.pts }));
  await page.locator("body").click({ position: { x: 4, y: 4 } }).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    (want) => (window.__dgPlanner?.plan?.walls || []).length !== want,
    beforeUndo.wallCount,
    { timeout: 15000 },
  ).catch(() => {});
  const undoState = await state();
  await shot("11-undo.png");

  await page.keyboard.press("Control+y");
  await page.waitForFunction(
    (want) => (window.__dgPlanner?.plan?.walls || []).length === want,
    beforeUndo.wallCount,
    { timeout: 15000 },
  ).catch(() => {});
  let redoState = await state();
  if (redoState.wallCount !== beforeUndo.wallCount) {
    await page.keyboard.press("Control+Shift+z");
    await page.waitForFunction(
      (want) => (window.__dgPlanner?.plan?.walls || []).length === want,
      beforeUndo.wallCount,
      { timeout: 15000 },
    ).catch(() => {});
    redoState = await state();
  }
  await shot("12-redo.png");

  // did undo restore the pre-split host (one wall spanning the right side)?
  const rightHostAfterUndo = undoState.walls.filter((w) => hostMatch(w, X1, MIDY));
  ev.undoRedo = {
    before: { walls: beforeUndo.wallCount, nodes: beforeUndo.nodeCount, rooms: beforeUndo.rooms.length },
    afterUndo: {
      walls: undoState.wallCount, nodes: undoState.nodeCount, rooms: undoState.rooms.length,
      roomNames: undoState.rooms.map((r) => r.name),
      rightSideWallCount: rightHostAfterUndo.length,
      rightSideWallSpans: rightHostAfterUndo.map((w) => w.pts),
    },
    afterRedo: {
      walls: redoState.wallCount, nodes: redoState.nodeCount, rooms: redoState.rooms.length,
      roomNames: redoState.rooms.map((r) => r.name),
      rightSideWallCount: redoState.walls.filter((w) => hostMatch(w, X1, MIDY)).length,
    },
    undoRemovedFourthPartition: undoState.wallCount < beforeUndo.wallCount
      && undoState.rooms.length === beforeUndo.rooms.length - 1,
    undoRestoredUnsplitHost: rightHostAfterUndo.length === 1,
    redoRestored: redoState.wallCount === beforeUndo.wallCount
      && redoState.rooms.length === beforeUndo.rooms.length,
    redoRestoredRoomNames: JSON.stringify(redoState.rooms.map((r) => r.name).sort())
      === JSON.stringify(beforeUndo.rooms.map((r) => r.name).sort()),
    orphanNodesAfterUndo: await orphanNodes(page),
  };
  if (!ev.undoRedo.undoRemovedFourthPartition) ev.failures.push("Ctrl+Z did not undo the fourth partition");
  if (!ev.undoRedo.redoRestored) ev.failures.push("Redo did not restore the fourth partition");

  // =====================================================================
  // SELECT MODE — single click selects, double click opens Inspector
  // =====================================================================
  log("SELECT MODE + double click");
  const anchorsUnselected = anchorSig(ev.dimensions);
  const stateForPick = await state();
  const pickWall = stateForPick.walls.find((w) => hostMatch(w, X1, MIDY)) || stateForPick.walls[0];
  const wallMid = pickWall?.pts?.length === 2
    ? { x: (pickWall.pts[0].x + pickWall.pts[1].x) / 2, y: (pickWall.pts[0].y + pickWall.pts[1].y) / 2 }
    : null;

  await page.getByRole("button", { name: "Выбор", exact: true }).first().click();
  await page.waitForFunction(() => window.__dgPlanner?.tool === "select", null, { timeout: 8000 });
  ev.browserActions.push('click toolbar "Выбор" -> tool=select');

  let selState = await state();
  if (wallMid) {
    const sp = await w2s(wallMid.x, wallMid.y);
    ev.selectClickDiagnostics = {
      targetWallId: pickWall.id,
      wallPts: pickWall.pts,
      worldPoint: wallMid,
      screenPoint: sp,
      hitAreaCount: await page.evaluate(() => document.querySelectorAll('[data-ui="wall-body-hit"]').length),
      elementStack: await page.evaluate(({ x, y }) => (document.elementsFromPoint(x, y) || [])
        .slice(0, 6)
        .map((el) => ({
          tag: el.tagName,
          dataUi: el.getAttribute?.("data-ui") || null,
          cls: (el.getAttribute?.("class") || "").slice(0, 40),
        })), sp),
    };
    await page.mouse.move(sp.x, sp.y, { steps: 4 });
    await page.mouse.down(); await page.mouse.up();
    ev.browserActions.push(`select-mode single click wall ${pickWall.id}`);
    await page.waitForFunction(
      () => window.__dgPlanner?.selection?.coll === "walls",
      null, { timeout: 8000 },
    ).catch(() => {});
    selState = await state();
    ev.selectClickDiagnostics.selectionAfter = selState.selection;
    ev.selectClickDiagnostics.probeAfter = selState.probe;
  }
  const dimsSelected = await collectDims(page);
  ev.selectedVsUnselectedAnchors = {
    targetWallId: pickWall?.id || null,
    selectedWallIds: selState.selection?.ids || null,
    dimCountUnselected: ev.dimensions.length,
    dimCountSelected: dimsSelected.length,
    unselectedSig: anchorsUnselected,
    selectedSig: anchorSig(dimsSelected),
    identical: anchorsUnselected === anchorSig(dimsSelected),
  };
  if (!selState.selection || selState.selection.coll !== "walls") {
    ev.failures.push("select-mode single click did not select a wall");
  }
  if (!ev.selectedVsUnselectedAnchors.identical) {
    ev.failures.push("selecting a wall changed auto dimension anchors/values");
  }

  // double click -> Inspector, plan untouched, zero PATCH
  ev.autosaveQuiescedBeforeDbl = await quiesceAutosave();
  const patchBeforeDbl = ev.patchCount;
  const planBeforeDbl = await planHash(page);
  if (wallMid) {
    const sp = await w2s(wallMid.x, wallMid.y);
    await page.mouse.dblclick(sp.x, sp.y);
    ev.browserActions.push("select-mode double click wall -> Inspector");
  }
  await page.waitForTimeout(500);
  await shot("10-properties-double-click.png");
  ev.doubleClick = {
    planUnchanged: planBeforeDbl === (await planHash(page)),
    patchDelta: ev.patchCount - patchBeforeDbl,
    inspectorVisible: await page.locator(".dg-inspector").first().isVisible().catch(() => false),
    inspectorTextSeen: await page.locator("text=/Стена|Свойства/i").first().isVisible().catch(() => false),
  };
  if (!ev.doubleClick.planUnchanged) ev.failures.push("double-click properties mutated the plan");
  if (ev.doubleClick.patchDelta !== 0) ev.failures.push("double-click properties issued a PATCH");

  // =====================================================================
  // WALL MODE — stationary double click cancels draft + opens properties
  // =====================================================================
  await page.getByRole("button", { name: "Стены", exact: true }).first().click();
  await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 8000 });
  ev.autosaveQuiescedBeforeWallDbl = await quiesceAutosave();
  const patchBeforeWallDbl = ev.patchCount;
  const planBeforeWallDbl = await planHash(page);
  if (wallMid) {
    const sp = await w2s(wallMid.x, wallMid.y);
    await page.mouse.dblclick(sp.x, sp.y);
    ev.browserActions.push("wall-mode stationary double click -> properties, draft cancelled");
  }
  await page.waitForTimeout(500);
  const wallDblState = await state();
  ev.wallModeDoubleClick = {
    planUnchanged: planBeforeWallDbl === (await planHash(page)),
    patchDelta: ev.patchCount - patchBeforeWallDbl,
    draftLen: wallDblState.draftLen,
    wallCount: wallDblState.wallCount,
    roomCount: wallDblState.rooms.length,
    selection: wallDblState.selection,
  };
  if (!ev.wallModeDoubleClick.planUnchanged) ev.failures.push("wall-mode double click mutated the plan");
  if (ev.wallModeDoubleClick.patchDelta !== 0) ev.failures.push("wall-mode double click issued a PATCH");
  if (wallDblState.draftLen !== 0) ev.failures.push("wall-mode double click left a live draft");

  // ---------- drag after first click stays drawing (no properties) ----------
  {
    const planBeforeDrag = await planHash(page);
    const a = await w2s(MIDX, MIDY);
    const b = await w2s(MIDX, MIDY - 1500);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    const midDrag = await state();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(400);
    const afterDrag = await state();
    ev.dragAfterFirstClick = {
      draftLenDuringDrag: midDrag.draftLen,
      gesturePhaseDuringDrag: midDrag.gesturePhase,
      stayedInWallTool: midDrag.tool === "wall",
      planUnchangedAfterEscape: planBeforeDrag === (await planHash(page)),
      wallCountAfter: afterDrag.wallCount,
    };
    ev.browserActions.push("wall-mode press + drag + Escape (must stay drawing, then cancel)");
  }

  // ---------- Esc cancels a live draft: no split, no PATCH ----------
  // Re-assert the wall tool: the previous Escape may have fallen through to select.
  await page.getByRole("button", { name: "Стены", exact: true }).first().click();
  await page.waitForFunction(() => window.__dgPlanner?.tool === "wall", null, { timeout: 8000 });
  ev.autosaveQuiescedBeforeCancel = await quiesceAutosave();
  const patchBeforeCancel = ev.patchCount;
  const stBeforeCancel = await state();
  // Start on a real host wall so a cancelled draft would split it if Esc leaked.
  const cp = await w2s(MIDX, Y0);
  await page.mouse.move(cp.x, cp.y, { steps: 4 });
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => (window.__dgPlanner?.draftLen || 0) > 0, null, { timeout: 8000 }).catch(() => {});
  const draftLive = await state();
  // Move to mid-room so the draft is a real pending wall, then cancel it.
  const cp2 = await w2s(MIDX, Y0 + 2000);
  await page.mouse.move(cp2.x, cp2.y, { steps: 8 });
  const previewLive = await state();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window.__dgPlanner?.draftLen || 0) === 0, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  const afterCancel = await state();
  ev.cancelledDraft = {
    toolAtStart: stBeforeCancel.tool,
    draftLenAfterFirstClick: draftLive.draftLen,
    gesturePhaseAfterFirstClick: draftLive.gesturePhase,
    draftLenDuringPreview: previewLive.draftLen,
    draftStarted: draftLive.draftLen > 0 || previewLive.draftLen > 0,
    patchDelta: ev.patchCount - patchBeforeCancel,
    wallCountBefore: stBeforeCancel.wallCount,
    wallCountAfter: afterCancel.wallCount,
    wallCountUnchanged: afterCancel.wallCount === stBeforeCancel.wallCount,
    nodeCountUnchanged: afterCancel.nodeCount === stBeforeCancel.nodeCount,
    draftLen: afterCancel.draftLen,
    roomCount: afterCancel.rooms.length,
  };
  if (!ev.cancelledDraft.draftStarted) ev.failures.push("Esc test never started a draft on the host wall");
  if (ev.cancelledDraft.patchDelta !== 0) ev.failures.push("cancelled draft issued a PATCH");
  if (!ev.cancelledDraft.wallCountUnchanged) ev.failures.push("cancelled draft changed wall count (split leaked)");
  if (!ev.cancelledDraft.nodeCountUnchanged) ev.failures.push("cancelled draft changed node count (split leaked)");

  // ---------- probe totals (proves the counters are live, not stuck at 0) ----------
  ev.probeFinal = (await state()).probe;

  // ---------- reload equality ----------
  const preReload = await state();
  const preReloadDims = await collectDims(page);
  const preReloadTopology = await topologySig(page);
  // Wait for autosave to actually reach the backend instead of sleeping blindly.
  await page.waitForFunction(
    () => !document.querySelector("[data-autosave-pending='1']"),
    null, { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__dgPlanner?.svgRect, null, { timeout: 45000 });
  await page.waitForFunction(
    (want) => (window.__dgPlanner?.plan?.walls || []).length === want,
    preReload.wallCount, { timeout: 25000 },
  ).catch(() => {});
  await page.waitForFunction(
    () => (window.__dgPlanner?.runtimeDimensions || []).length > 0,
    null, { timeout: 15000 },
  ).catch(() => {});
  const postReload = await state();
  const postReloadDims = await collectDims(page);
  const postReloadTopology = await topologySig(page);
  await shot("13-after-reload.png");
  ev.reloadEquality = {
    before: {
      walls: preReload.wallCount, nodes: preReload.nodeCount,
      rooms: preReload.rooms.map((r) => ({ id: r.id, name: r.name })),
      autoDimensionCount: preReloadDims.length,
    },
    after: {
      walls: postReload.wallCount, nodes: postReload.nodeCount,
      rooms: postReload.rooms.map((r) => ({ id: r.id, name: r.name })),
      autoDimensionCount: postReloadDims.length,
    },
    wallsEqual: preReload.wallCount === postReload.wallCount,
    nodesEqual: preReload.nodeCount === postReload.nodeCount,
    topologyEqual: preReloadTopology === postReloadTopology,
    roomIdsEqual: JSON.stringify(preReload.rooms.map((r) => r.id).sort())
      === JSON.stringify(postReload.rooms.map((r) => r.id).sort()),
    roomNamesEqual: JSON.stringify(preReload.rooms.map((r) => r.name).sort())
      === JSON.stringify(postReload.rooms.map((r) => r.name).sort()),
    dimensionsEqual: anchorSig(preReloadDims) === anchorSig(postReloadDims),
  };
  ev.dimensionSummaryAfterReload = summarizeDims(postReloadDims);
  if (!ev.reloadEquality.roomIdsEqual) ev.failures.push("reload changed room IDs");
  if (!ev.reloadEquality.roomNamesEqual) ev.failures.push("reload changed room names");
  if (!ev.reloadEquality.topologyEqual) ev.failures.push("reload changed wall topology");

  await context.tracing.stop({ path: path.join(TRACE, "trace.zip") });
  await context.close();
  await browser.close();

  fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(ev, null, 2));
  log("\nrooms:", JSON.stringify(ev.rooms));
  log("failures:", ev.failures.length ? JSON.stringify(ev.failures, null, 2) : "none");
  log("evidence ->", path.join(OUT, "evidence.json"));
  if (ev.failures.length || (ev.rooms || []).length !== 4) process.exitCode = 1;
}

/** Auto dimensions live only in the runtime resolver, never inside plan.dimensions. */
async function collectDims(page) {
  return page.evaluate(() => {
    const d = window.__dgPlanner;
    const p = d.plan;
    const walls = p.walls || [];
    const nodes = p.nodes || {};
    const rooms = p.rooms || [];
    const seg = (w) => {
      const a = nodes[w.a], b = nodes[w.b];
      if (a && b) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
      if (w.pts?.length >= 2) return [w.pts[0], w.pts[w.pts.length - 1]];
      return null;
    };
    const distToLine = (pt, a, b) => {
      const vx = b.x - a.x, vy = b.y - a.y;
      const L = Math.hypot(vx, vy) || 1;
      return Math.abs((pt.x - a.x) * vy - (pt.y - a.y) * vx) / L;
    };
    const inPoly = (pt, poly) => {
      if (!pt || !poly || poly.length < 3) return false;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > pt.y) !== (yj > pt.y))
          && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
      }
      return inside;
    };
    const distToSeg = (pt, a, b) => {
      const vx = b.x - a.x, vy = b.y - a.y;
      const L2 = vx * vx + vy * vy || 1;
      let t = ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / L2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(pt.x - (a.x + vx * t), pt.y - (a.y + vy * t));
    };
    /**
     * The host wall of a dimension is the one it is offset FROM: parallel to the
     * dimension line and nearest by segment distance. Ranking by distance to the
     * infinite line picks perpendicular walls and yields a bogus normal.
     */
    const hostWallFor = (p1, p2) => {
      if (!p1 || !p2) return null;
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl, uy = dy / dl;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      let best = null, bestD = Infinity;
      for (const w of walls) {
        const s = seg(w);
        if (!s) continue;
        const wx = s[1].x - s[0].x, wy = s[1].y - s[0].y;
        const wl = Math.hypot(wx, wy) || 1;
        const parallel = Math.abs((wx / wl) * ux + (wy / wl) * uy);
        if (parallel < 0.98) continue;
        const dd = Math.min(distToSeg(mid, s[0], s[1]), distToSeg(p1, s[0], s[1]));
        if (dd < bestD) { bestD = dd; best = w; }
      }
      return best;
    };
    const roomsBBox = (() => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of rooms) {
        for (const q of (r.polygon || [])) {
          x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
          x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
        }
      }
      return { x0, y0, x1, y1 };
    })();
    const onAnyRoomBoundary = (pt, tol = 1.5) => {
      if (!pt) return false;
      for (const r of rooms) {
        const poly = r.polygon || [];
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          if (distToSeg(pt, poly[j], poly[i]) <= tol) return true;
        }
      }
      return false;
    };
    const outsideRoomsBBox = (pt, tol = 1.5) => !pt || pt.x < roomsBBox.x0 - tol
      || pt.x > roomsBBox.x1 + tol || pt.y < roomsBBox.y0 - tol || pt.y > roomsBBox.y1 + tol;
    return (d.runtimeDimensions || []).filter((x) => x.auto === true).map((x) => {
      const refWallId = x.reference?.wallId || x.attachedTo?.id || null;
      let w = refWallId ? walls.find((q) => q.id === refWallId) : null;
      const mid = x.p1 && x.p2 ? { x: (x.p1.x + x.p2.x) / 2, y: (x.p1.y + x.p2.y) / 2 } : null;
      if (!w) w = hostWallFor(x.p1, x.p2);
      const s = w ? seg(w) : null;
      const roomsContainingP1 = rooms.filter((r) => inPoly(x.p1, r.polygon)).map((r) => r.id);
      const roomsContainingMid = rooms.filter((r) => inPoly(mid, r.polygon)).map((r) => r.id);
      return {
        id: x.id,
        semanticKind: x.kind,
        referenceKind: x.referenceKind || null,
        reference: x.reference
          ? {
            kind: x.reference.kind, side: x.reference.side, roomId: x.reference.roomId ?? null,
            wallId: x.reference.wallId ?? null,
            joinedStart: x.reference.joinedStart ?? null, joinedEnd: x.reference.joinedEnd ?? null,
          }
          : null,
        invalid: !!x.invalid,
        invalidReason: x.invalidReason || null,
        wallId: refWallId || (w?.id ?? null),
        roomId: x.reference?.roomId ?? null,
        p1: x.p1, p2: x.p2,
        orientation: x.orientation,
        lengthMm: x.p1 && x.p2 ? Math.round(Math.hypot(x.p2.x - x.p1.x, x.p2.y - x.p1.y) * 100) / 100 : null,
        wallCenterline: s,
        wallThk: w?.thk ?? null,
        expectedHalfThk: w?.thk != null ? w.thk / 2 : null,
        anchorDistanceFromCenterline: (s && x.p1)
          ? Math.round(distToLine(x.p1, s[0], s[1]) * 100) / 100 : null,
        midDistanceFromCenterline: (s && mid)
          ? Math.round(distToLine(mid, s[0], s[1]) * 100) / 100 : null,
        // internal_clear anchors lie exactly ON the joined room face (= the room
        // polygon edge), so a raw point-in-polygon test there is degenerate.
        // Classify geometrically instead: an internal dim spans a room interior
        // (both anchors on a room boundary, inside the rooms' extent); an external
        // dim sits beyond every room interior.
        insideClassification: (() => {
          const p1On = onAnyRoomBoundary(x.p1);
          const p2On = onAnyRoomBoundary(x.p2);
          const anchorsOutside = outsideRoomsBBox(x.p1) || outsideRoomsBBox(x.p2);
          if (anchorsOutside) return "outside";
          if (p1On && p2On) return "inside";
          return rooms.some((r) => inPoly(mid, r.polygon)) ? "inside" : "outside";
        })(),
        anchorsOnRoomBoundary: {
          p1: onAnyRoomBoundary(x.p1),
          p2: onAnyRoomBoundary(x.p2),
        },
        anchorsOutsideRoomsExtent: {
          p1: outsideRoomsBBox(x.p1),
          p2: outsideRoomsBBox(x.p2),
        },
        roomsExtent: roomsBBox,
        roomsContainingP1,
        roomsContainingMid,
      };
    });
  });
}

function summarizeDims(dims) {
  const CENTERLINE = "centerline";
  const internalKinds = new Set(["internal_clear", "wall_length"]);
  const externalKinds = new Set(["external_overall", "external_segment"]);
  const internal = dims.filter((d) => internalKinds.has(d.semanticKind));
  const external = dims.filter((d) => externalKinds.has(d.semanticKind));
  const byKind = {};
  for (const d of dims) {
    byKind[d.semanticKind] = byKind[d.semanticKind] || {};
    const rk = d.referenceKind || "(none)";
    byKind[d.semanticKind][rk] = (byKind[d.semanticKind][rk] || 0) + 1;
  }
  const centerlineFallbacks = dims.filter(
    (d) => (internalKinds.has(d.semanticKind) || externalKinds.has(d.semanticKind))
      && (d.referenceKind === CENTERLINE || d.referenceKind == null)
      && !d.invalid,
  );
  const onCenterline = dims.filter(
    (d) => (internalKinds.has(d.semanticKind) || externalKinds.has(d.semanticKind))
      && d.anchorDistanceFromCenterline != null
      && d.anchorDistanceFromCenterline < 1
      && !d.invalid,
  );
  return {
    total: dims.length,
    byKindAndReferenceKind: byKind,
    internalCount: internal.length,
    externalCount: external.length,
    internalClearAllJoinedRoomFace: internal
      .filter((d) => d.semanticKind === "internal_clear")
      .every((d) => d.referenceKind === "joinedRoomFace"),
    internalWallLengthReferenceKinds: [...new Set(internal
      .filter((d) => d.semanticKind === "wall_length").map((d) => d.referenceKind))],
    externalAllJoinedOuterFace: external.every((d) => d.referenceKind === "joinedOuterFace"),
    internalAllInside: internal.filter((d) => !d.invalid)
      .every((d) => d.insideClassification === "inside"),
    externalAllOutside: external.filter((d) => !d.invalid)
      .every((d) => d.insideClassification === "outside"),
    centerlineFallbackCount: centerlineFallbacks.length,
    centerlineFallbackIds: centerlineFallbacks.map((d) => d.id),
    anchorsSittingOnCenterlineCount: onCenterline.length,
    anchorsSittingOnCenterlineIds: onCenterline.map((d) => d.id),
    invalidCount: dims.filter((d) => d.invalid).length,
    invalidIds: dims.filter((d) => d.invalid).map((d) => ({ id: d.id, reason: d.invalidReason })),
  };
}

function pointInPoly(pt, poly) {
  if (!pt || !poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y))
      && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

async function orphanNodes(page) {
  return page.evaluate(() => {
    const p = window.__dgPlanner.plan;
    const walls = p.walls || [];
    return Object.keys(p.nodes || {}).filter((k) => walls.every((w) => w.a !== k && w.b !== k));
  });
}

function hostMatch(w, mx, my) {
  const p = w.pts;
  if (!p || p.length !== 2) return false;
  const [a, b] = p;
  const vx = b.x - a.x, vy = b.y - a.y;
  const L = Math.hypot(vx, vy) || 1;
  const t = ((mx - a.x) * vx + (my - a.y) * vy) / (L * L);
  if (t < -0.02 || t > 1.02) return false;
  const perp = Math.abs((mx - a.x) * vy - (my - a.y) * vx) / L;
  return perp <= 200;
}

function hostEvidence(label, hostBefore, after, mx, my) {
  if (!hostBefore) return { label, note: "host wall not resolved before commit" };
  const parts = after.walls.filter((w) => hostMatch(w, mx, my) && collinearWith(w, hostBefore));
  const len = (w) => (w.pts?.length === 2 ? Math.hypot(w.pts[1].x - w.pts[0].x, w.pts[1].y - w.pts[0].y) : 0);
  const sum = parts.reduce((acc, w) => acc + len(w), 0);
  const origLen = len(hostBefore);
  const drift = parts.map((w) => Math.max(
    perpFrom(hostBefore, w.pts[0]), perpFrom(hostBefore, w.pts[1]),
  ));
  return {
    label,
    hostIdBefore: hostBefore.id,
    hostEndpointsBefore: hostBefore.pts,
    splitSegmentIds: parts.map((w) => w.id),
    splitSegmentEndpoints: parts.map((w) => w.pts),
    splitNode: { x: mx, y: my },
    originalLengthMm: round(origLen),
    sumOfSplitLengthsMm: round(sum),
    lengthPreserved: Math.abs(sum - origLen) <= 2,
    direction: dirOf(hostBefore),
    thicknessBefore: hostBefore.thk,
    thicknessAfter: parts.map((w) => w.thk),
    thicknessPreserved: parts.every((w) => w.thk === hostBefore.thk),
    roleBefore: hostBefore.role,
    roleAfter: parts.map((w) => w.role),
    maxTransverseDriftMm: round(Math.max(0, ...drift)),
    noTransverseDrift: Math.max(0, ...drift) <= 1,
  };
}

function collinearWith(w, host) {
  if (!w.pts || w.pts.length !== 2) return false;
  return perpFrom(host, w.pts[0]) <= 1.5 && perpFrom(host, w.pts[1]) <= 1.5;
}
function perpFrom(host, pt) {
  const [a, b] = host.pts;
  const vx = b.x - a.x, vy = b.y - a.y;
  const L = Math.hypot(vx, vy) || 1;
  return Math.abs((pt.x - a.x) * vy - (pt.y - a.y) * vx) / L;
}
function dirOf(w) {
  const [a, b] = w.pts;
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "horizontal" : "vertical";
}
function round(v) { return Math.round(v * 100) / 100; }
async function topologySig(page) {
  return page.evaluate(() => {
    const p = window.__dgPlanner.plan;
    const nodes = p.nodes || {};
    const key = (id) => (nodes[id] ? `${Math.round(nodes[id].x)},${Math.round(nodes[id].y)}` : `?${id}`);
    return JSON.stringify((p.walls || [])
      .map((w) => [key(w.a), key(w.b), w.thk, w.role].join("|"))
      .sort());
  });
}
function anchorSig(dims) {
  return JSON.stringify((dims || [])
    .map((d) => [d.semanticKind, d.p1?.x, d.p1?.y, d.p2?.x, d.p2?.y, d.value])
    .sort((a, b) => String(a).localeCompare(String(b))));
}
async function planHash(page) {
  return page.evaluate(() => {
    const p = window.__dgPlanner.plan;
    return JSON.stringify({
      w: (p.walls || []).map((x) => [x.id, x.a, x.b, x.thk, x.role]),
      n: p.nodes,
      r: (p.rooms || []).map((x) => [x.id, x.name]),
      d: (p.dimensions || []).map((x) => [x.id, x.kind, x.p1, x.p2]),
    });
  });
}

main().catch((e) => {
  ev.failures.push(`fatal: ${e?.message || e}`);
  try { fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(ev, null, 2)); } catch { /* ignore */ }
  console.error(e);
  process.exit(1);
});
