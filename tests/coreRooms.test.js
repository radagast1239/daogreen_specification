import { describe, expect, it } from "vitest";
import {
  detectRooms,
  formatRoomAreaLabel,
  formatRoomHeightLabel,
  syncRooms,
  validateRooms,
} from "../src/planner/core/rooms/index.js";

function basePlan() {
  return {
    room: { w: 12000, h: 8000, wallThk: 120, defaultRoomHeightMm: 3000, height: 3000 },
    nodes: {},
    walls: [],
    items: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

describe("core/rooms detectRooms", () => {
  it("detects simple rectangular room", () => {
    const plan = basePlan();
    plan.walls = [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
    ];
    const rooms = detectRooms(plan);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].areaM2).toBeGreaterThan(11.8);
    expect(rooms[0].areaM2).toBeLessThan(12.2);
  });

  it("detects two rooms separated by wall", () => {
    const plan = basePlan();
    plan.walls = [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 6000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 6000, y: 0 }, { x: 6000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 6000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
      { id: "w5", thk: 100, pts: [{ x: 3000, y: 0 }, { x: 3000, y: 3000 }] },
    ];
    const rooms = detectRooms(plan);
    expect(rooms.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores open contour", () => {
    const plan = basePlan();
    plan.walls = [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 4000, y: 3000 }, { x: 1000, y: 3000 }] },
    ];
    expect(detectRooms(plan)).toHaveLength(0);
  });

  it("preserves room id after small wall move", () => {
    const plan = basePlan();
    plan.walls = [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
    ];
    const first = syncRooms(plan);
    const firstId = first.rooms[0]?.id;
    const moved = {
      ...plan,
      rooms: first.rooms,
      walls: [
        { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4050, y: 0 }] },
        { id: "w2", thk: 100, pts: [{ x: 4050, y: 0 }, { x: 4050, y: 3000 }] },
        { id: "w3", thk: 100, pts: [{ x: 4050, y: 3000 }, { x: 0, y: 3000 }] },
        { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
      ],
    };
    const second = syncRooms(moved);
    expect(second.rooms[0]?.id).toBe(firstId);
  });
});

describe("core/rooms formatting", () => {
  it("formats room height and area labels", () => {
    expect(formatRoomHeightLabel(3000)).toBe("H=300");
    expect(formatRoomAreaLabel(45_100_000)).toBe("S=45.10 м²");
  });
});

describe("core/rooms validation", () => {
  it("warns when toilet opens to production", () => {
    const plan = basePlan();
    plan.items = [
      { id: "d1", kind: "door", x: 1950, y: 950, w: 900, h: 100 },
    ];
    const rooms = [
      {
        id: "r-prod",
        category: "production_main",
        polygon: [{ x: 2000, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 2000, y: 2000 }],
      },
      {
        id: "r-toi",
        category: "toilet",
        polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }],
      },
    ];
    const warnings = validateRooms(plan, rooms);
    expect(warnings.some((w) => w.id.includes("san-prod-door"))).toBe(true);
  });

  it("warns for corridor narrower than 900 mm", () => {
    const plan = basePlan();
    const rooms = [
      {
        id: "r-cor",
        category: "corridor",
        polygon: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 3000 }, { x: 0, y: 3000 }],
      },
    ];
    const warnings = validateRooms(plan, rooms);
    expect(warnings.some((w) => w.id.includes("corridor-width"))).toBe(true);
  });
});
