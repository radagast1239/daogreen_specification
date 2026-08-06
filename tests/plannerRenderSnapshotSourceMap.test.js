/**
 * PHASE 2F1 — one authoritative render snapshot.
 *
 * Every geometry-bearing canvas layer must resolve its coordinates from
 * effectivePlan (the active transaction when one exists, otherwise the
 * committed plan). A layer silently reading the committed plan while its
 * neighbours read the preview is what produced ghost geometry.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/pages/admin/PlanPage.jsx", "utf8");

describe("PHASE 2F1 render snapshot source map", () => {
  it("1. wall geometry resolves from effectivePlan", () => {
    expect(SRC).toContain("resolvePlanWalls(effectivePlan)");
    expect(SRC).toContain("weldWallNodes(resolvedWalls)");
  });

  it("2. room floors and zones render from effectivePlan, never from the committed plan", () => {
    expect(SRC).toContain("const renderZones = effectivePlan.zones || []");
    expect(SRC).toContain("const renderRooms = effectivePlan.rooms || []");
    expect(SRC).toContain("renderZones.map(");
    expect(SRC).not.toContain("plan.zones.map(");
    expect(SRC).not.toContain("plan.rooms.map(");
  });

  it("3. wall mass, top overlay and dimensions all consume the same welded walls", () => {
    expect(SRC).toContain("<WallMassLayer walls={weldedWalls}");
    const wallProps = SRC.match(/walls=\{weldedWalls\}/g) || [];
    expect(wallProps.length).toBeGreaterThanOrEqual(3);
    expect(SRC).not.toMatch(/walls=\{resolvePlanWalls\(plan\)\}/);
  });

  // LIVE3 split: room validation follows the preview (cheap, and a stale hatch
  // under moved walls is the ghost-geometry defect), but the finalized dimension
  // inventory stays on the committed plan so it is not rebuilt every pointer
  // frame during a hold. Live measurements during a drag come from the separate
  // liveWallMeasurements overlay, not from this memo.
  it("4. room validation derives from effectivePlan, finalized dimensions from the committed plan", () => {
    expect(SRC).toContain("validateRooms(effectivePlan, renderRooms)");
    expect(SRC).toContain("resolvePlanDimensions(plan, { dimensionDisplayMode })");
    expect(SRC).not.toContain("resolvePlanDimensions(effectivePlan");
  });

  it("5. preview plans keep rooms/zones in lockstep with preview walls", () => {
    // Both wall-move preview builders must sync rooms, and fail closed (empty)
    // rather than leaving the committed floor visible under moved walls.
    const previews = SRC.match(/syncRoomsSafe\(mat\.plan\)/g) || [];
    expect(previews.length).toBeGreaterThanOrEqual(2);
    expect(SRC).toContain("rooms: [], zones: []");
  });
});
