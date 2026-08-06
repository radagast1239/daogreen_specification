/**
 * PHASE 2F1 — real-mouse driving primitives for the Planner canvas.
 *
 * Everything here moves the ACTUAL pointer through the visible UI. Nothing in
 * this module creates, edits or writes plan geometry: it only positions the
 * camera, presses the real tool buttons, drags the real mouse, and reads back
 * what the application itself produced.
 *
 * The user's video established that construction PATH matters — walls made by
 * helper commands did not behave like walls drawn by hand — so fixture geometry
 * may only ever come out of these gestures.
 */

export const VIEWPORT = { width: 1680, height: 1000 };
/** Canvas area that is safely inside the drawing surface (panels excluded). */
export const SAFE = { left: 180, top: 110, right: 1330, bottom: 900 };

export const safeCenter = () => ({
  x: (SAFE.left + SAFE.right) / 2,
  y: (SAFE.top + SAFE.bottom) / 2,
});

export async function readView(page) {
  return page.evaluate(() => ({
    rect: { left: window.__dgPlanner.svgRect.left, top: window.__dgPlanner.svgRect.top },
    view: { ...window.__dgPlanner.view },
    tool: window.__dgPlanner.tool,
    wallCount: (window.__dgPlanner.plan.walls || []).length,
  }));
}

export const toScreen = (world, v) => ({
  x: v.rect.left + v.view.panX + world.x * v.view.zoom,
  y: v.rect.top + v.view.panY + world.y * v.view.zoom,
});

export const toWorld = (screen, v) => ({
  x: (screen.x - v.rect.left - v.view.panX) / v.view.zoom,
  y: (screen.y - v.rect.top - v.view.panY) / v.view.zoom,
});

export const inSafeArea = (p) => p.x >= SAFE.left && p.x <= SAFE.right
  && p.y >= SAFE.top && p.y <= SAFE.bottom;

export async function selectTool(page, name) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(220);
}

/**
 * Real mouse-wheel zoom, anchored at a screen point (the app keeps the world
 * point under the cursor fixed, exactly as it does for a user).
 */
export async function zoomAt(page, anchor, targetZoom, { maxTicks = 60 } = {}) {
  await page.mouse.move(anchor.x, anchor.y);
  for (let i = 0; i < maxTicks; i++) {
    const v = await readView(page);
    if (Math.abs(v.view.zoom - targetZoom) / targetZoom < 0.15) return v;
    await page.mouse.wheel(0, v.view.zoom < targetZoom ? -120 : 120);
    await page.waitForTimeout(85);
  }
  return readView(page);
}

/**
 * Pan with a real left-button drag on empty canvas (the app's own pan gesture —
 * the status bar documents ЛКМ as панорама). The drag start is chosen away from
 * any existing wall so the gesture can never grab geometry instead.
 */
/** The canvas controls expose aria-labels, which own their accessible name. */
export const CONTROL = Object.freeze({
  fit: "Показать весь план",
  zoomIn: "Увеличить масштаб",
  zoomOut: "Уменьшить масштаб",
});

export async function fitAll(page) {
  await page.getByRole("button", { name: CONTROL.fit, exact: true }).first().click();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(500);
  return readView(page);
}

export async function panBy(page, dx, dy) {
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  // Long pans are chunked: a single drag must both start and end inside the
  // drawing surface, so a 2000px request can never be one gesture.
  const maxX = (SAFE.right - SAFE.left) - 160;
  const maxY = (SAFE.bottom - SAFE.top) - 160;
  const steps = Math.max(
    1,
    Math.ceil(Math.abs(dx) / maxX),
    Math.ceil(Math.abs(dy) / maxY),
  );
  if (steps > 1) {
    for (let i = 0; i < steps; i++) await panOnce(page, dx / steps, dy / steps);
    return;
  }
  await panOnce(page, dx, dy);
}

async function panOnce(page, dx, dy) {
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
  await selectTool(page, "Выбор");
  const v = await readView(page);
  // Clearance is measured to wall BODIES, not just endpoints: a drag that
  // starts on a wall would move that wall instead of panning the view.
  const segments = await page.evaluate(() => (window.__dgPlanner.resolvedWalls || [])
    .filter((w) => w.pts?.length >= 2)
    .map((w) => ({ a: { ...w.pts[0] }, b: { ...w.pts[w.pts.length - 1] } })));
  const screenSegs = segments.map((s) => ({ a: toScreen(s.a, v), b: toScreen(s.b, v) }));
  const distToSeg = (p, s) => {
    const dxs = s.b.x - s.a.x;
    const dys = s.b.y - s.a.y;
    const l2 = dxs * dxs + dys * dys;
    if (l2 < 1e-9) return Math.hypot(p.x - s.a.x, p.y - s.a.y);
    const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dxs + (p.y - s.a.y) * dys) / l2));
    return Math.hypot(p.x - (s.a.x + dxs * t), p.y - (s.a.y + dys * t));
  };
  const candidates = [];
  for (let gx = SAFE.left + 40; gx <= SAFE.right - 40; gx += 50) {
    for (let gy = SAFE.top + 40; gy <= SAFE.bottom - 40; gy += 50) {
      const from = { x: gx, y: gy };
      const to = { x: gx + dx, y: gy + dy };
      if (!inSafeArea(to)) continue;
      const clearance = screenSegs.length
        ? Math.min(...screenSegs.map((s) => distToSeg(from, s)))
        : Infinity;
      candidates.push({ from, to, clearance });
    }
  }
  candidates.sort((a, b) => b.clearance - a.clearance);
  const pick = candidates[0];
  if (!pick) throw new Error(`panOnce: no in-surface drag for delta ${dx},${dy}`);
  if (pick.clearance < 45) {
    throw new Error(`panOnce: every start point is on geometry (best clearance ${pick.clearance.toFixed(0)}px)`);
  }
  await page.mouse.move(pick.from.x, pick.from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      pick.from.x + (pick.to.x - pick.from.x) * (i / 8),
      pick.from.y + (pick.to.y - pick.from.y) * (i / 8),
    );
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(320);
}

/**
 * Bring every world point of a scheme into the safe drawing area at a workable
 * zoom, using only real zoom-button clicks and real pan drags.
 */
export async function ensureVisible(page, worldPoints, { zoom = 0.12, margin = 70 } = {}) {
  const bbox = (v) => {
    const s = worldPoints.map((p) => toScreen(p, v));
    return {
      minX: Math.min(...s.map((q) => q.x)), maxX: Math.max(...s.map((q) => q.x)),
      minY: Math.min(...s.map((q) => q.y)), maxY: Math.max(...s.map((q) => q.y)),
    };
  };
  const fits = (b) => b.minX >= SAFE.left + margin && b.maxX <= SAFE.right - margin
    && b.minY >= SAFE.top + margin && b.maxY <= SAFE.bottom - margin;

  // Pure canvas gestures only — the Fit button sits under the zoom slider and
  // cannot be clicked without forcing the hit-test.
  //
  // Travel cheaply: zoom OUT first (screen distance scales with zoom, so a
  // cross-plan hop costs a couple of drags instead of a dozen), pan the scheme
  // to the middle of the surface, then zoom back IN anchored on that middle —
  // which the app holds fixed under the cursor, so the scheme stays centred.
  const c = safeCenter();
  const wide = 0.03;
  if ((await readView(page)).view.zoom > wide * 1.5) await zoomAt(page, c, wide);
  let v = await readView(page);
  let b = bbox(v);
  await panBy(page, c.x - (b.minX + b.maxX) / 2, c.y - (b.minY + b.maxY) / 2);
  await zoomAt(page, c, zoom);

  for (let attempt = 0; attempt < 4; attempt++) {
    v = await readView(page);
    b = bbox(v);
    if (fits(b)) return v;
    const c = safeCenter();
    const dx = c.x - (b.minX + b.maxX) / 2;
    const dy = c.y - (b.minY + b.maxY) / 2;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      await panBy(page, dx, dy);
      continue;
    }
    // Centred and still too large for the surface — ease the zoom back.
    await zoomAt(page, c, (await readView(page)).view.zoom * 0.75);
  }
  return readView(page);
}

/**
 * Draw ONE wall with real pointer input.
 *
 * Returns the preview endpoint captured just before pointerup, so the caller
 * can prove the persisted wall matches what the user could see.
 */
export async function drawWall(page, fromWorld, toWorld_, {
  steps = 10, settleMs = 900, alt = false,
} = {}) {
  await selectTool(page, "Стены");
  const v = await readView(page);
  const A = toScreen(fromWorld, v);
  const B = toScreen(toWorld_, v);
  if (!inSafeArea(A) || !inSafeArea(B)) {
    throw new Error(`drawWall: gesture leaves the canvas A=${JSON.stringify(A)} B=${JSON.stringify(B)}`);
  }
  // Alt is the app's own "free angle" modifier: it turns off grid and angle
  // snapping (PlanPage: altSnapRef). Without it a shallow oblique edge is
  // snapped flat to 0°, which silently opens a supposedly closed contour.
  if (alt) await page.keyboard.down("Alt");
  try {
    await page.mouse.move(A.x, A.y);
    await page.waitForTimeout(90);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(A.x + (B.x - A.x) * (i / steps), A.y + (B.y - A.y) * (i / steps));
      await page.waitForTimeout(55);
    }
    await page.waitForTimeout(180);
  } catch (err) {
    if (alt) await page.keyboard.up("Alt");
    throw err;
  }
  const preview = await page.evaluate(() => {
    const pv = window.__dgPlanner.wallDrawV2?.preview;
    return pv ? {
      start: { x: pv.start.x, y: pv.start.y },
      end: pv.end ? { x: pv.end.x, y: pv.end.y } : null,
      startSnap: pv.startSnap?.kind ?? null,
      endSnap: pv.endSnap?.kind ?? null,
    } : null;
  });
  const before = await page.evaluate(() => (window.__dgPlanner.plan.walls || []).map((w) => w.id));
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
  await page.waitForTimeout(settleMs);
  const after = await page.evaluate(() => (window.__dgPlanner.plan.walls || []).map((w) => w.id));
  const created = after.filter((id) => !before.includes(id));
  return { preview, createdWallIds: created, requested: { from: fromWorld, to: toWorld_ } };
}

/** Full topology snapshot straight out of the running application. */
export async function readTopology(page) {
  return page.evaluate(() => {
    const p = window.__dgPlanner.plan;
    const walls = p.walls || [];
    const nodes = p.nodes || {};
    const degree = (n) => walls.filter((w) => w.a === n || w.b === n).length;
    return {
      walls: walls.map((w) => ({
        id: w.id, chainId: w.chainId ?? null, a: w.a, b: w.b,
        A: nodes[w.a] ? { ...nodes[w.a] } : null,
        B: nodes[w.b] ? { ...nodes[w.b] } : null,
        role: w.role, kind: w.kind, thk: w.thk,
        thicknessSide: w.thicknessSide, height: w.height, locked: !!w.locked,
      })),
      nodes: Object.entries(nodes).map(([id, q]) => ({
        id, x: q.x, y: q.y, degree: degree(id),
        incident: walls.filter((w) => w.a === id || w.b === id).map((w) => w.id).sort(),
      })),
      roomCount: (p.rooms || []).length,
      zoneCount: (p.zones || []).length,
    };
  });
}
