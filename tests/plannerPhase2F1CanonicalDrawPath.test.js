/**
 * PHASE 2F1 — fixture / UI draw-path parity.
 *
 * Bare commitDrawnWall(start, end) without intents uses the legacy path.
 * Fixtures and offline builders must use commitWallThroughCanonicalDrawPath,
 * which is resolveWallDraftEnd → commitDrawnWall(+intents) — the V2 Wall tool.
 */
import { describe, expect, it } from "vitest";
import {
  commitWallThroughCanonicalDrawPath,
  commitDrawnWall,
  resolveWallDraftEnd,
} from "../src/planner/core/walls/wallDrawTopology.js";
import { classifyWallSegmentAttachments, moveWallSegment } from "../src/planner/core/walls/wallCommands.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { findUnnodedCrossings } from "../src/planner/core/walls/renderedContours.js";
import { classifyPlanTopologyAnomalies } from "../src/planner/core/walls/legacyTopologyAudit.js";
import { repairLegacyTopology } from "../src/planner/core/walls/legacyTopologyRepair.js";

const props = (chainId, role = "outer") => ({
  thk: 100,
  role,
  kind: "new",
  thicknessSide: "center",
  height: 3000,
  material: "drywall",
  chainId,
  locked: false,
  createdAt: 1,
  updatedAt: 1,
});

function idFactory(seed = 0) {
  let n = seed;
  return (prefix) => `cdp_${prefix}_${++n}`;
}

function emptyRoom() {
  return {
    nodes: {
      ul: { x: 0, y: 0 }, ur: { x: 8000, y: 0 },
      lr: { x: 8000, y: 5000 }, ll: { x: 0, y: 5000 },
    },
    walls: [
      { id: "top", a: "ul", b: "ur", ...props("top") },
      { id: "right", a: "ur", b: "lr", ...props("right") },
      { id: "bot", a: "lr", b: "ll", ...props("bot") },
      { id: "left", a: "ll", b: "ul", ...props("left") },
    ],
    items: [],
    dimensions: [],
    rooms: [],
  };
}

function degree(plan, nodeId) {
  return plan.walls.filter((w) => w.a === nodeId || w.b === nodeId).length;
}

function endpointOnHostSpan(point, hostA, hostB, tol = 1) {
  const dx = hostB.x - hostA.x;
  const dy = hostB.y - hostA.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((point.x - hostA.x) * dx + (point.y - hostA.y) * dy) / len2;
  const proj = { x: hostA.x + dx * t, y: hostA.y + dy * t };
  const dist = Math.hypot(point.x - proj.x, point.y - proj.y);
  return dist <= tol && t >= -1e-6 && t <= 1 + 1e-6;
}

describe("PHASE 2F1 canonical draw path (fixture = UI)", () => {
  it("1–2. raw end beyond a host clips; commit equals preview", () => {
    const plan = emptyRoom();
    const makeId = idFactory();
    const intended = { x: 4000, y: 5500 }; // past lower host at y=5000
    const preview = resolveWallDraftEnd(plan, {
      walls: resolvePlanWalls(plan),
      start: { x: 4000, y: 0 },
      end: intended,
      endIntentProvided: true,
      endIntent: {
        kind: "none",
        point: intended,
        nodeId: null,
        wallId: null,
        hostWallId: null,
        connects: false,
      },
    });
    expect(preview.clipped).toBe(true);
    expect(preview.point.y).toBeCloseTo(5000, 5);
    expect(preview.point.x).toBeCloseTo(4000, 5);

    const r = commitWallThroughCanonicalDrawPath(
      plan,
      { x: 4000, y: 0 },
      intended,
      props("part", "partition"),
      makeId,
    );
    expect(r.changed).toBe(true);
    expect(r.preview.previewEnd.y).toBeCloseTo(5000, 5);
    expect(r.committedEnd.y).toBeCloseTo(r.preview.previewEnd.y, 5);
    expect(r.committedEnd.x).toBeCloseTo(r.preview.previewEnd.x, 5);
    expect(Math.hypot(
      r.committedEnd.x - r.preview.previewEnd.x,
      r.committedEnd.y - r.preview.previewEnd.y,
    )).toBeLessThan(1);
  });

  it("3–8. double-T via canonical path: no pass-through, shared nodes, zero repair", () => {
    const makeId = idFactory(10);
    const room = emptyRoom();
    const r = commitWallThroughCanonicalDrawPath(
      room,
      { x: 4000, y: 0 },
      { x: 4000, y: 5600 },
      props("part", "partition"),
      makeId,
    );
    expect(r.changed).toBe(true);
    const part = r.plan.walls.find((w) => w.id === r.meta.newWallId);
    expect(part).toBeTruthy();
    expect(part.chainId).toBeTruthy();
    const a = r.plan.nodes[part.a];
    const b = r.plan.nodes[part.b];
    const yLo = Math.min(a.y, b.y);
    const yHi = Math.max(a.y, b.y);
    expect(yLo).toBeCloseTo(0, 5);
    expect(yHi).toBeCloseTo(5000, 5);
    expect(yHi).toBeLessThanOrEqual(5000 + 1);
    expect(endpointOnHostSpan(a.y <= b.y ? a : b, { x: 0, y: 0 }, { x: 8000, y: 0 })).toBe(true);
    expect(endpointOnHostSpan(a.y > b.y ? a : b, { x: 0, y: 5000 }, { x: 8000, y: 5000 })).toBe(true);
    expect(degree(r.plan, part.a)).toBe(3);
    expect(degree(r.plan, part.b)).toBe(3);
    expect(findUnnodedCrossings(resolvePlanWalls(r.plan))).toEqual([]);
    // No degree-1 endpoint sitting on a foreign wall body.
    for (const nid of [part.a, part.b]) {
      expect(degree(r.plan, nid)).toBeGreaterThanOrEqual(2);
    }
    const audit = classifyPlanTopologyAnomalies(r.plan);
    const repair = repairLegacyTopology(r.plan, { makeId: idFactory(99) });
    expect(repair.changed).toBe(false);
    expect(repair.repairs).toEqual([]);
    // Fresh double-T must not need repairable legacy anomalies on the branch.
    const repairable = (audit.anomalies || []).filter((a) => a.repairable);
    expect(repairable).toEqual([]);
  });

  it("9–11. double-T movement contract still holds after canonical draw", () => {
    const makeId = idFactory(20);
    const drawn = commitWallThroughCanonicalDrawPath(
      emptyRoom(),
      { x: 4000, y: 0 },
      { x: 4000, y: 5600 },
      props("part", "partition"),
      makeId,
    );
    const partId = drawn.meta.newWallId;
    const att = classifyWallSegmentAttachments(drawn.plan, partId);
    expect(att.start.type).toBe("tee");
    expect(att.end.type).toBe("tee");

    const left = moveWallSegment(drawn.plan, {
      wallId: partId,
      delta: { x: -400, y: 0 },
      expectedEndpointAttachments: att,
      makeId: idFactory(30),
    });
    expect(left.changed).toBe(true);
    expect(left.movement.delta.y).toBeCloseTo(0, 6);

    const vert = moveWallSegment(drawn.plan, {
      wallId: partId,
      delta: { x: 0, y: 400 },
      expectedEndpointAttachments: att,
      makeId: idFactory(31),
    });
    expect(vert.changed).toBe(false);
    expect(vert.reason).toBe("NO_CHANGE");

    const diag = moveWallSegment(drawn.plan, {
      wallId: partId,
      delta: { x: 300, y: -200 },
      expectedEndpointAttachments: att,
      makeId: idFactory(32),
    });
    expect(diag.changed).toBe(true);
    expect(diag.movement.delta.x).toBeCloseTo(300, 6);
    expect(diag.movement.delta.y).toBeCloseTo(0, 6);

    const big = moveWallSegment(drawn.plan, {
      wallId: partId,
      delta: { x: 6000, y: -1000 },
      expectedEndpointAttachments: att,
      makeId: idFactory(33),
    });
    expect(big.changed).toBe(true);
    expect(big.movement.delta.x).toBeLessThan(4000);
    expect(big.movement.delta.y).toBeCloseTo(0, 6);
  });

  it("legacy no-intent path is a different entry (fixture must not use it)", () => {
    const plan = emptyRoom();
    const legacy = commitDrawnWall(
      plan,
      { x: 4000, y: 0 },
      { x: 4000, y: 5600 },
      props("legacy", "partition"),
      idFactory(40),
    );
    const canonical = commitWallThroughCanonicalDrawPath(
      plan,
      { x: 4000, y: 0 },
      { x: 4000, y: 5600 },
      props("canon", "partition"),
      idFactory(41),
    );
    expect(legacy.changed).toBe(true);
    expect(canonical.changed).toBe(true);
    expect(canonical.preview).toBeTruthy();
    expect(canonical.preview.clipped).toBe(true);
    // Canonical always exposes preview/commit parity metadata; legacy does not.
    expect(legacy.preview).toBeUndefined();
  });
});
