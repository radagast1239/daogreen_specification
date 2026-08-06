/**
 * Temp-DB network preview — scenarios A–G for dimension×wall-command wiring.
 * Run: npx vitest run tests/plannerDimensionBrowserPreview.test.js
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addWall, moveNode, splitWall, deleteWall, mergeNodes,
} from "../src/planner/core/walls/wallCommands.js";
import {
  createWallDimension, createDiagonalDimension, createAngleDimension,
} from "../src/planner/core/dimensions/anchorOperations.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import {
  createPlanAutosaveBridge, stripEphemeralPlanFields,
} from "../src/planner/core/history/planAutosaveBridge.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const tempDir = path.join(os.tmpdir(), `daogreen-dim-preview-${Date.now()}`);
const tempDb = path.join(tempDir, "preview.db");
const tempUploads = path.join(tempDir, "uploads");

let dbMod;
let projectsMod;
let server;
let baseUrl;
let projectId;
let revision;
let n = 0;
const makeId = (p) => `pv_${p}${++n}`;

function rectPlan() {
  n = 0;
  let plan = {
    nodes: {}, walls: [], items: [],
    rooms: [{ id: "r1", name: "Room" }],
    zones: [{ id: "z1", roomId: "r1" }],
    dimensions: [],
  };
  plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, { thk: 100 }, makeId).plan;
  plan = addWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { thk: 100 }, makeId).plan;
  plan = addWall(plan, { x: 4000, y: 3000 }, { x: 0, y: 3000 }, { thk: 100 }, makeId).plan;
  plan = addWall(plan, { x: 0, y: 3000 }, { x: 0, y: 0 }, { thk: 100 }, makeId).plan;
  const w = plan.walls[0];
  plan.dimensions = [
    createWallDimension({ id: "wall-man", wallId: w.id, labelOverride: "W", offset: 120 }),
    { id: "wall-auto", auto: true, mode: "linear", kind: "wall_length", source: "walls", anchors: [{ type: "wall", wallId: w.id }] },
  ];
  return plan;
}

function createManualScheduler() {
  let queue = [];
  return {
    schedule: (fn) => { const h = { fn, cancelled: false }; queue.push(h); return h; },
    cancelSchedule: (h) => { h.cancelled = true; },
    flush: () => { const run = queue.filter((h) => !h.cancelled); queue = []; run.forEach((h) => h.fn()); },
  };
}

async function flushAsync() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function patchPlan(plan, expectedRevision) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision, plan: stripEphemeralPlanFields(plan) }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDb;
  process.env.DB_PATH = tempDb;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SESSION_SECRET = "preview-dim-secret-not-production";

  dbMod = await import("../backend/src/db.js");
  projectsMod = await import("../backend/src/routes/projects.js");
  const activityMod = await import("../backend/src/services/activityLog.js");
  dbMod.initDb();
  activityMod.initActivityLog();

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/api/projects", projectsMod.default);
  app.use(express.static(path.join(process.cwd(), "dist")));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`PREVIEW_URL=${baseUrl}`);
  console.log(`TEMP_DB=${tempDb}`);

  const project = projectsMod.createProject({ name: `dim-preview-${Date.now()}` });
  projectId = project.id;
  revision = project.revision ?? 1;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe("BROWSER/NETWORK preview A–G (temp DB only)", () => {
  it("A wall dimension move + reload", async () => {
    let plan = rectPlan();
    const w = plan.walls[0];
    const before = 4000;
    const moved = moveNode(plan, w.a, { x: plan.nodes[w.a].x + 500, y: plan.nodes[w.a].y });
    plan = materializeWallCommand(plan, moved).plan;
    const dim = plan.dimensions.find((d) => d.id === "wall-man");
    expect(dim.labelOverride).toBe("W");
    expect(Math.abs(dim.value - before)).toBeGreaterThan(1);
    const patch = await patchPlan(plan, revision);
    expect(patch.status).toBe(200);
    revision = patch.data.revision ?? revision;
    const loaded = dbMod.loadProject(projectId);
    expect(loaded.plan.dimensions.some((d) => d.id === "wall-man")).toBe(true);
    expect(JSON.stringify(stripEphemeralPlanFields(plan))).not.toContain("wall-command");
  });

  it("B split remaps / review warning / no duplicates", async () => {
    let plan = rectPlan();
    const w = plan.walls[0];
    plan.dimensions.push({ id: "amb", anchors: [{ type: "wall", wallId: w.id }] });
    const mid = {
      x: (plan.nodes[w.a].x + plan.nodes[w.b].x) / 2,
      y: (plan.nodes[w.a].y + plan.nodes[w.b].y) / 2,
    };
    const split = splitWall(plan, w.id, mid, makeId);
    const mat = materializeWallCommand(plan, split);
    plan = mat.plan;
    expect(plan.dimensions.find((d) => d.id === "wall-man")).toBeTruthy();
    expect(plan.dimensions.find((d) => d.id === "amb")?.invalid).toBe(true);
    expect(mat.warnings.some((x) => x.code === "DIMENSION_ANCHOR_NEEDS_REVIEW")).toBe(true);
    expect(plan.dimensions.filter((d) => d.id === "wall-man")).toHaveLength(1);
    const patch = await patchPlan(plan, revision);
    expect(patch.status).toBe(200);
    revision = patch.data.revision ?? revision;
    expect((stripEphemeralPlanFields(mat.plan).validationWarnings || []).some((w) => w.source === "wall-command")).toBe(false);
  });

  it("C delete keeps manual invalid, drops auto", async () => {
    let plan = rectPlan();
    const del = deleteWall(plan, plan.walls[0].id);
    plan = materializeWallCommand(plan, del).plan;
    expect(plan.dimensions.find((d) => d.id === "wall-man")?.invalid).toBe(true);
    expect(plan.dimensions.some((d) => d.id === "wall-auto")).toBe(false);
    const patch = await patchPlan(plan, revision);
    expect(patch.status).toBe(200);
    revision = patch.data.revision ?? revision;
  });

  it("D merge remaps + dedupe auto + keep manual", () => {
    n = 0;
    let plan = { nodes: {}, walls: [], dimensions: [], rooms: [{ id: "r1" }], zones: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, {}, makeId).plan;
    plan = addWall(plan, { x: 4000, y: 200 }, { x: 4000, y: 3000 }, {}, makeId).plan;
    const keep = plan.walls[0].b;
    const drop = plan.walls[1].a;
    const anchors = [{ type: "node", nodeId: keep }, { type: "node", nodeId: drop }];
    plan.dimensions = [
      createDiagonalDimension({ id: "man", fromNodeId: keep, toNodeId: drop }),
      { id: "a1", auto: true, mode: "linear", kind: "wall_length", source: "walls", anchors },
      { id: "a2", auto: true, mode: "linear", kind: "wall_length", source: "walls", anchors: [...anchors].reverse() },
    ];
    plan = materializeWallCommand(plan, mergeNodes(plan, keep, drop)).plan;
    expect(plan.nodes[drop]).toBeUndefined();
    expect(plan.dimensions.filter((d) => d.auto)).toHaveLength(1);
    expect(plan.dimensions.some((d) => d.id === "man")).toBe(true);
  });

  it("E diagonal/angle update + PATCH", async () => {
    let plan = rectPlan();
    const w0 = plan.walls[0];
    const w1 = plan.walls[1];
    const vertex = w0.b;
    const ray1 = w0.a;
    const ray2 = w1.b;
    plan.dimensions = [
      createDiagonalDimension({ id: "diag", fromNodeId: ray1, toNodeId: ray2 }),
      createAngleDimension({ id: "ang", vertexNodeId: vertex, rayNodeId1: ray1, rayNodeId2: ray2 }),
    ];
    const before = plan.dimensions[0];
    plan = materializeWallCommand(plan, moveNode(plan, ray1, {
      x: plan.nodes[ray1].x + 300, y: plan.nodes[ray1].y + 50,
    })).plan;
    const diag = plan.dimensions.find((d) => d.id === "diag");
    const ang = plan.dimensions.find((d) => d.id === "ang");
    expect(Number.isFinite(diag.value)).toBe(true);
    expect(diag.value).not.toBe(before.value);
    expect(Number.isFinite(ang.angle ?? ang.value)).toBe(true);
    const patch = await patchPlan(plan, revision);
    expect(patch.status).toBe(200);
    revision = patch.data.revision ?? revision;
  });

  it("F undo/redo + no autosave storm", async () => {
    const scheduler = createManualScheduler();
    const patches = [];
    const identity = { mode: "project", id: projectId };
    const bridge = createPlanAutosaveBridge({
      persistFn: async (_id, plan) => {
        patches.push(plan);
        const r = await patchPlan(plan, revision);
        if (r.data?.revision != null) revision = r.data.revision;
        if (r.status === 409) return { ok: false, conflict: true, status: 409 };
        return { revision, ok: true };
      },
      debounceMs: 50,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
      getActiveIdentity: () => identity,
    });
    let plan = rectPlan();
    bridge.beginHydration(identity);
    bridge.completeHydration(identity, plan);
    bridge.observePlan(identity, plan);
    scheduler.flush();
    await flushAsync();
    const p0 = patches.length;
    const history = [JSON.parse(JSON.stringify(plan))];
    const moved = materializeWallCommand(plan, moveNode(plan, plan.walls[0].a, { x: 100, y: 0 })).plan;
    history.push(moved);
    bridge.observePlan(identity, moved);
    scheduler.flush();
    await flushAsync();
    bridge.observePlan(identity, history[0]);
    scheduler.flush();
    await flushAsync();
    bridge.observePlan(identity, history[1]);
    scheduler.flush();
    await flushAsync();
    expect(history[0].dimensions.some((d) => d.id === "wall-man")).toBe(true);
    expect(patches.length - p0).toBeLessThanOrEqual(4);
    expect(patches.slice(p0).every((p) => p.rooms != null && p.zones != null)).toBe(true);
  });

  it("G room sync failure keeps walls/rooms/dims; warnings stripped", async () => {
    let plan = rectPlan();
    const roomsBefore = plan.rooms;
    const moved = materializeWallCommand(plan, moveNode(plan, plan.walls[0].a, { x: 200, y: 0 })).plan;
    const sync = syncRoomsSafe(moved, () => { throw new Error("room engine down"); });
    expect(sync.ok).toBe(false);
    const next = {
      ...moved,
      rooms: roomsBefore,
      zones: plan.zones,
      validationWarnings: [{ source: "wall-command", code: "X", text: "no" }],
    };
    expect(next.walls.length).toBe(moved.walls.length);
    expect(next.dimensions.some((d) => d.id === "wall-man")).toBe(true);
    const stripped = stripEphemeralPlanFields(next);
    expect((stripped.validationWarnings || []).some((w) => w.source === "wall-command")).toBe(false);
    const patch = await patchPlan(stripped, revision);
    expect(patch.status).toBe(200);
    revision = patch.data.revision ?? revision;
    const loaded = dbMod.loadProject(projectId);
    const text = JSON.stringify(loaded.plan || {});
    expect(text).not.toContain("DIMENSION_ANCHOR_NEEDS_REVIEW");
    expect(text).not.toContain('"source":"wall-command"');
  });
});
