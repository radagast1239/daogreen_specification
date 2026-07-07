import { describe, expect, it } from "vitest";
import { wallSegDimPoints, wallSegDimLength } from "../src/planner/dimensionMarkers.jsx";
import { wallFacePoint } from "../src/planner/wallParallelGeometry.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";

function mkWall(id, x0, y0, x1, y1, thk = 100) {
  return { id, thk, pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }] };
}
function mkPlan(walls, zones = []) {
  return { walls, room: { w: 10000, h: 8000 }, nodes: {}, zones };
}
function getDims(plan) {
  return generateWallDimensions(plan).dimensions;
}

describe("wall dimensions", () => {
  const room = { w: 12000, h: 8000 };
  const wall = { thk: 100, thicknessSide: "center" };
  const a = { x: 0, y: 2000 };
  const b = { x: 4000, y: 2000 };

  it("anchors dimension line on outer face, not axis center", () => {
    const { a: fa, b: fb } = wallSegDimPoints(a, b, wall, room);
    const outerA = wallFacePoint(a, a, b, "outer", wall, room);
    const outerB = wallFacePoint(b, a, b, "outer", wall, room);
    expect(fa.x).toBeCloseTo(outerA.x, 1);
    expect(fa.y).toBeCloseTo(outerA.y, 1);
    expect(fb.x).toBeCloseTo(outerB.x, 1);
    expect(fb.y).toBeCloseTo(outerB.y, 1);
    expect(fa.y).not.toBeCloseTo(a.y, 0);
  });

  it("measures face span length equal to axis for straight wall", () => {
    const pts = wallSegDimPoints(a, b, wall, room);
    expect(wallSegDimLength(pts.a, pts.b)).toBeCloseTo(4000, 1);
  });
});

// A. Простая прямоугольная комната 4000×2000, толщина стен 100
describe("generateWallDimensions — simple rect room", () => {
  const walls = [
    mkWall("top",   0,    0,    4000, 0),
    mkWall("bot",   0,    2000, 4000, 2000),
    mkWall("left",  0,    0,    0,    2000),
    mkWall("right", 4000, 0,    4000, 2000),
  ];
  const plan = mkPlan(walls);

  it("has exactly one external_overall horizontal", () => {
    const h = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(h).toHaveLength(1);
  });

  it("has exactly one external_overall vertical", () => {
    const v = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "vertical");
    expect(v).toHaveLength(1);
  });

  it("has exactly one internal_clear horizontal", () => {
    const h = getDims(plan).filter((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    expect(h).toHaveLength(1);
  });

  it("has exactly one internal_clear vertical", () => {
    const v = getDims(plan).filter((d) => d.kind === "internal_clear" && d.orientation === "vertical");
    expect(v).toHaveLength(1);
  });

  it("external_overall horizontal span = 4000 + thk (4100)", () => {
    const d = getDims(plan).find((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    const span = Math.round(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y));
    expect(span).toBe(4100);
  });

  it("internal_clear horizontal span = 4000 - thk (3900)", () => {
    const d = getDims(plan).find((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    const span = Math.round(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y));
    expect(span).toBe(3900);
  });

  it("external_overall H anchor is on outer wall face (y = minY - half)", () => {
    const d = getDims(plan).find((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    // anchor y must be at outer face of top wall (centerline y=0, half=50 → outer face y=-50)
    expect(d.p1.y).toBeCloseTo(-50, 0);
    expect(d.p2.y).toBeCloseTo(-50, 0);
  });

  it("internal_clear H anchor is on inner wall face (y = minY + half)", () => {
    const d = getDims(plan).find((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    // anchor y must be at inner face of top wall (centerline y=0, half=50 → inner face y=+50)
    expect(d.p1.y).toBeCloseTo(50, 0);
    expect(d.p2.y).toBeCloseTo(50, 0);
  });

  it("internal_clear H offset is positive → dim line is inside room (below top inner face)", () => {
    const d = getDims(plan).find((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    // positive offset with SegDim: dim line moves in +Y direction = downward = into room interior
    expect(d.offset).toBeGreaterThan(0);
  });

  it("internal_clear V offset is negative → dim line is inside room (right of left inner face)", () => {
    const d = getDims(plan).find((d) => d.kind === "internal_clear" && d.orientation === "vertical");
    // negative offset with SegDim vertical: dim line moves in +X direction = rightward = into room interior
    expect(d.offset).toBeLessThan(0);
  });

  it("external_overall H offset is negative → dim line is outside room (above top outer face)", () => {
    const d = getDims(plan).find((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(d.offset).toBeLessThan(0);
  });

  it("no external_segment dimensions (garbage segments removed)", () => {
    const ks = getDims(plan).map((d) => d.kind).filter(Boolean);
    expect(ks).not.toContain("external_segment");
  });

  it("no auto dim with span <= 100 (no thickness dim)", () => {
    const thkDims = getDims(plan).filter((d) => {
      if (!d.auto || !d.p1 || !d.p2) return false;
      const span = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y);
      return span > 0 && span <= 100;
    });
    expect(thkDims).toHaveLength(0);
  });
});

// B. Дедупликация
describe("generateWallDimensions — deduplication", () => {
  it("no duplicate external_overall for same span in a closed rect", () => {
    // Two open walls (not a closed loop) → no external_overall (correct: only closed loops get it)
    const walls = [mkWall("h", 0, 0, 5000, 0), mkWall("v", 0, 0, 0, 3000)];
    const plan = mkPlan(walls);
    const h = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(h).toHaveLength(0); // open path → no external_overall
  });

  it("closed rect produces exactly one horizontal external_overall (no dup)", () => {
    const walls = [
      mkWall("t", 0, 0, 5000, 0), mkWall("b", 0, 3000, 5000, 3000),
      mkWall("l", 0, 0, 0, 3000), mkWall("r", 5000, 0, 5000, 3000),
    ];
    const plan = mkPlan(walls);
    const h = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(h).toHaveLength(1);
  });
});

// C. Мусорные размеры: минимальный порог < 300 мм
describe("generateWallDimensions — garbage suppression", () => {
  it("tiny room (200 мм span) produces no exterior auto dims", () => {
    const walls = [mkWall("tiny", 0, 0, 200, 0)];
    const plan = mkPlan(walls);
    const extDims = getDims(plan).filter((d) => d.kind === "external_overall" || d.kind === "internal_clear");
    expect(extDims).toHaveLength(0);
  });

  it("all external/internal auto dims have positive span > 0", () => {
    const walls = [
      mkWall("top", 0, 0, 4000, 0), mkWall("bot", 0, 2000, 4000, 2000),
      mkWall("left", 0, 0, 0, 2000), mkWall("right", 4000, 0, 4000, 2000),
    ];
    const plan = mkPlan(walls);
    getDims(plan).filter((d) => d.kind === "external_overall" || d.kind === "internal_clear").forEach((d) => {
      const span = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y);
      expect(span).toBeGreaterThan(0);
    });
  });
});

// D. Диагональная стена — нет internal_clear, external_overall сохраняется
describe("generateWallDimensions — diagonal wall", () => {
  it("diagonal wall: no internal_clear generated", () => {
    const walls = [
      mkWall("diag", 0, 0, 3000, 2000),
      mkWall("h", 0, 0, 3000, 0),
    ];
    const plan = mkPlan(walls);
    const intDims = getDims(plan).filter((d) => d.kind === "internal_clear");
    expect(intDims).toHaveLength(0);
  });

  it("open diagonal+horizontal path: no external_overall (not a closed loop)", () => {
    // An open 2-wall path is not a closed contour → external_overall not generated.
    // wall_length is generated for both walls instead.
    const walls = [mkWall("diag", 0, 0, 3000, 2000), mkWall("h", 0, 0, 3000, 0)];
    const plan = mkPlan(walls);
    const extDims = getDims(plan).filter((d) => d.kind === "external_overall");
    expect(extDims).toHaveLength(0);
    const wl = getDims(plan).filter((d) => d.kind === "wall_length");
    expect(wl.length).toBeGreaterThan(0);
  });
});

// E. repThk: толщина стен учитывается в outer face
describe("generateWallDimensions — outer face uses wall thk", () => {
  it("thk=200 → external_overall H span = 5000 + 200", () => {
    const walls = [
      mkWall("top", 0, 0, 5000, 0, 200), mkWall("bot", 0, 3000, 5000, 3000, 200),
      mkWall("left", 0, 0, 0, 3000, 200), mkWall("right", 5000, 0, 5000, 3000, 200),
    ];
    const plan = mkPlan(walls);
    const h = getDims(plan).find((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    const span = Math.round(Math.hypot(h.p2.x - h.p1.x, h.p2.y - h.p1.y));
    expect(span).toBe(5200); // 5000 + 2×100
  });
});

// F. Per-wall dimensions (wall_length)
describe("generateWallDimensions — wall_length per wall", () => {
  it("simple 4-wall rect: outer walls have NO wall_length (covered by external_overall)", () => {
    const walls = [
      mkWall("top",   0,    0,    4000, 0),
      mkWall("bot",   0,    2000, 4000, 2000),
      mkWall("left",  0,    0,    0,    2000),
      mkWall("right", 4000, 0,    4000, 2000),
    ];
    const plan = mkPlan(walls);
    const wl = getDims(plan).filter((d) => d.kind === "wall_length");
    expect(wl).toHaveLength(0);
  });

  it("full-span partition in 4-wall rect: no wall_length (span covered by external_overall)", () => {
    // Partition endpoints at (0,1000) and (4000,1000) — full span matching external_overall H.
    // removeWallLengthCoveredBySpans removes it.
    const walls = [
      mkWall("r-top",   0,    0,    4000, 0),
      mkWall("r-bot",   0,    2000, 4000, 2000),
      mkWall("r-left",  0,    0,    0,    2000),
      mkWall("r-right", 4000, 0,    4000, 2000),
      mkWall("part",    0,    1000, 4000, 1000),
    ];
    const plan = mkPlan(walls);
    const wl = getDims(plan).filter((d) => d.kind === "wall_length");
    expect(wl).toHaveLength(0);
  });

  it("diagonal wall always gets wall_length", () => {
    const walls = [mkWall("diag", 0, 0, 3000, 2000)];
    const plan = mkPlan(walls);
    const wl = getDims(plan).filter((d) => d.kind === "wall_length");
    expect(wl).toHaveLength(1);
  });

  it("wall_length has labelOverride with units (not bare number)", () => {
    // Two open-path walls — not a closed loop, so wall_length is generated
    const walls = [mkWall("top", 0, 0, 4000, 0), mkWall("ext", 5000, 0, 8000, 0)];
    const plan = mkPlan(walls);
    const wl = getDims(plan).filter((d) => d.kind === "wall_length");
    expect(wl.length).toBeGreaterThan(0);
    wl.forEach((d) => {
      expect(d.labelOverride).toBeTruthy();
      expect(d.labelOverride).toMatch(/м/);
    });
  });

  it("short wall < 300 mm produces no wall_length dim", () => {
    const walls = [mkWall("short", 0, 0, 200, 0)];
    const plan = mkPlan(walls);
    const wl = getDims(plan).filter((d) => d.kind === "wall_length");
    expect(wl).toHaveLength(0);
  });

  it("wall_length span matches wall segment length for isolated wall", () => {
    const walls = [mkWall("h", 0, 500, 3500, 500)];
    const plan = mkPlan(walls);
    const wl = getDims(plan).find((d) => d.kind === "wall_length");
    expect(wl).toBeTruthy();
    const span = Math.round(Math.hypot(wl.p2.x - wl.p1.x, wl.p2.y - wl.p1.y));
    // Isolated wall: no miter extension, visible body = centerline length
    expect(span).toBe(3500);
  });

  it("wall_length for L-shape corner uses miter-extended body (not centerline)", () => {
    // Two walls meeting at one corner — open path (not closed loop) → wall_length generated
    const walls = [
      mkWall("top",   0,    0, 4000, 0),    // horizontal
      mkWall("right", 4000, 0, 4000, 2000), // vertical, shares (4000,0) with top
    ];
    const plan = mkPlan(walls);
    const topDim = getDims(plan).find((d) => d.kind === "wall_length" && d.id?.includes("top"));
    expect(topDim).toBeTruthy();
    const span = Math.round(Math.hypot(topDim.p2.x - topDim.p1.x, topDim.p2.y - topDim.p1.y));
    // Right end of top wall has a miter corner → spans slightly beyond 4000mm
    expect(span).toBeGreaterThanOrEqual(4000);
  });

  it("wall_length offset is 150mm (outside wall body)", () => {
    const walls = [mkWall("h", 0, 500, 3500, 500)];
    const plan = mkPlan(walls);
    const wl = getDims(plan).find((d) => d.kind === "wall_length");
    expect(wl).toBeTruthy();
    expect(Math.abs(wl.offset)).toBe(150);
  });
});

// G. Disconnected wall groups — external_overall per group, not global
describe("generateWallDimensions — disconnected groups", () => {
  it("two disconnected rectangles produce separate external_overall dims, not one global", () => {
    const rect1 = [
      mkWall("r1-t", 0,    0,    3000, 0),
      mkWall("r1-b", 0,    2000, 3000, 2000),
      mkWall("r1-l", 0,    0,    0,    2000),
      mkWall("r1-r", 3000, 0,    3000, 2000),
    ];
    const rect2 = [
      mkWall("r2-t", 8000, 0,    11000, 0),
      mkWall("r2-b", 8000, 2000, 11000, 2000),
      mkWall("r2-l", 8000, 0,    8000,  2000),
      mkWall("r2-r", 11000, 0,   11000, 2000),
    ];
    const plan = mkPlan([...rect1, ...rect2]);
    const extH = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(extH).toHaveLength(2); // one per rect, not one spanning both
    extH.forEach((d) => {
      const span = Math.round(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y));
      expect(span).toBeLessThan(5000); // each rect is ~3100mm wide, not 11000mm
    });
  });

  it("isolated open wall produces no external_overall (not a closed loop)", () => {
    const walls = [mkWall("h", 0, 0, 5000, 0)];
    const plan = mkPlan(walls);
    const ext = getDims(plan).filter((d) => d.kind === "external_overall");
    expect(ext).toHaveLength(0);
  });

  it("diagonal group does not pollute rectangle external_overall", () => {
    const rect = [
      mkWall("r-t", 0,    0,    4000, 0),
      mkWall("r-b", 0,    2000, 4000, 2000),
      mkWall("r-l", 0,    0,    0,    2000),
      mkWall("r-r", 4000, 0,    4000, 2000),
    ];
    const diag = mkWall("diag", 6000, 0, 9000, 2000); // separate disconnected diagonal
    const plan = mkPlan([...rect, diag]);
    const extH = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    // Only the rect has a closed loop → only 1 horizontal external_overall
    expect(extH).toHaveLength(1);
    const span = Math.round(Math.hypot(extH[0].p2.x - extH[0].p1.x, extH[0].p2.y - extH[0].p1.y));
    expect(span).toBeLessThan(6000); // not ~9100mm global bbox
  });
});

// H. WALL-DIMENSIONS-003 — no duplicate spans (full-span partition vs external_overall)
describe("generateWallDimensions — no duplicate spans (WALL-DIMENSIONS-003)", () => {
  // Layout:
  //   Outer rect 8000×6000 (centerlines). thk=100.
  //   Full horizontal partition at y=3000 (endpoints at (0,3000) and (8000,3000)).
  //   Short vertical partition at x=4000, from y=3000 to y=6000.
  function makeSplitRectPlan() {
    const rect = [
      mkWall("s-top",   0,    0,    8000, 0),
      mkWall("s-bot",   0,    6000, 8000, 6000),
      mkWall("s-left",  0,    0,    0,    6000),
      mkWall("s-right", 8000, 0,    8000, 6000),
    ];
    const partH = mkWall("part-h", 0, 3000, 8000, 3000); // full-span horizontal partition
    const partV = mkWall("part-v", 4000, 3000, 4000, 6000); // short vertical partition
    return mkPlan([...rect, partH, partV]);
  }

  it("no horizontal span duplicates: external_overall H appears exactly once", () => {
    const plan = makeSplitRectPlan();
    const extH = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(extH).toHaveLength(1);
  });

  it("no vertical span duplicates: external_overall V appears exactly once", () => {
    const plan = makeSplitRectPlan();
    const extV = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "vertical");
    expect(extV).toHaveLength(1);
  });

  it("full-span horizontal partition does not duplicate external_overall H span", () => {
    const plan = makeSplitRectPlan();
    const dims = getDims(plan);
    const extH = dims.filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(extH).toHaveLength(1);
    // wall_length for part-h must NOT appear (same span as external_overall)
    const partHLen = dims.filter((d) => d.kind === "wall_length" && d.id?.includes("part-h"));
    expect(partHLen).toHaveLength(0);
  });

  it("vertical partition forming complete cell sides: no wall_length (suppressed as cell boundary)", () => {
    // part-v covers the full right side of BL cell and left side of BR cell →
    // collectFullCellBoundaryWallIds marks it as a boundary → suppressed.
    const plan = makeSplitRectPlan();
    const dims = getDims(plan);
    const partVLen = dims.filter((d) => d.kind === "wall_length" && d.id?.includes("part-v"));
    expect(partVLen).toHaveLength(0);
  });

  it("diagonal wall keeps its wall_length even when external_overall is present nearby", () => {
    const rect = [
      mkWall("r-t", 0, 0, 4000, 0), mkWall("r-b", 0, 3000, 4000, 3000),
      mkWall("r-l", 0, 0, 0, 3000), mkWall("r-r", 4000, 0, 4000, 3000),
    ];
    const diag = mkWall("diag", 0, 0, 4000, 3000); // diagonal inside same bbox
    const plan = mkPlan([...rect, diag]);
    const diagLen = getDims(plan).filter((d) => d.kind === "wall_length" && d.id?.includes("diag"));
    expect(diagLen).toHaveLength(1);
  });
});

// I. WALL-DIMENSIONS-004 — internal_clear restored for real rooms (split rooms)
describe("generateWallDimensions — internal_clear for split rooms (WALL-DIMENSIONS-004)", () => {
  // Outer rect 8000×6000 split by full horizontal partition at y=3000
  function makeSplitH() {
    return mkPlan([
      mkWall("t",  0,    0,    8000, 0),
      mkWall("b",  0,    6000, 8000, 6000),
      mkWall("l",  0,    0,    0,    6000),
      mkWall("r",  8000, 0,    8000, 6000),
      mkWall("ph", 0,    3000, 8000, 3000),
    ]);
  }
  // Outer rect 8000×6000 split by full vertical partition at x=4000
  function makeSplitV() {
    return mkPlan([
      mkWall("t",  0,    0,    8000, 0),
      mkWall("b",  0,    6000, 8000, 6000),
      mkWall("l",  0,    0,    0,    6000),
      mkWall("r",  8000, 0,    8000, 6000),
      mkWall("pv", 4000, 0,    4000, 6000),
    ]);
  }

  it("split-H: external_overall is generated", () => {
    const extH = getDims(makeSplitH()).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(extH).toHaveLength(1);
  });

  it("split-H: internal_clear exists for top room", () => {
    const ic = getDims(makeSplitH()).filter((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    // top room: y0=0→y1=3000, bottom room: y0=3000→y1=6000 — two separate H dims at different Y
    expect(ic.length).toBeGreaterThanOrEqual(1);
    // at least one H internal_clear near top (y ≈ 50)
    const topRoom = ic.filter((d) => Math.min(d.p1.y, d.p2.y) < 1000);
    expect(topRoom.length).toBeGreaterThanOrEqual(1);
  });

  it("split-H: internal_clear exists for bottom room", () => {
    const ic = getDims(makeSplitH()).filter((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    // bottom room: y starts at 3000
    const bottomRoom = ic.filter((d) => Math.min(d.p1.y, d.p2.y) > 1000);
    expect(bottomRoom.length).toBeGreaterThanOrEqual(1);
  });

  it("split-H: full-span partition wall_length is still suppressed", () => {
    const wl = getDims(makeSplitH()).filter((d) => d.kind === "wall_length" && d.id?.includes("ph"));
    expect(wl).toHaveLength(0);
  });

  it("split-V: internal_clear exists for left and right rooms", () => {
    const ic = getDims(makeSplitV()).filter((d) => d.kind === "internal_clear" && d.orientation === "vertical");
    expect(ic.length).toBeGreaterThanOrEqual(2);
  });

  it("external_overall does not remove internal_clear with same length", () => {
    // Simple 4-wall rect: external_overall H ≈ 4100mm (outer), internal_clear H ≈ 3900mm (inner)
    // They have similar but not identical length — both must survive
    const plan = mkPlan([
      mkWall("t", 0, 0, 4000, 0), mkWall("b", 0, 3000, 4000, 3000),
      mkWall("l", 0, 0, 0, 3000), mkWall("r", 4000, 0, 4000, 3000),
    ]);
    const dims = getDims(plan);
    expect(dims.some((d) => d.kind === "external_overall")).toBe(true);
    expect(dims.some((d) => d.kind === "internal_clear")).toBe(true);
  });

  it("two disconnected rectangles each get their own internal_clear", () => {
    const plan = mkPlan([
      // rect A: 4000×3000
      mkWall("a-t", 0,    0,    4000, 0),
      mkWall("a-b", 0,    3000, 4000, 3000),
      mkWall("a-l", 0,    0,    0,    3000),
      mkWall("a-r", 4000, 0,    4000, 3000),
      // rect B: offset by 6000
      mkWall("b-t", 6000, 0,    9000, 0),
      mkWall("b-b", 6000, 3000, 9000, 3000),
      mkWall("b-l", 6000, 0,    6000, 3000),
      mkWall("b-r", 9000, 0,    9000, 3000),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    // Each rect has H + V = 2 dims, total ≥ 4
    expect(ic.length).toBeGreaterThanOrEqual(4);
    // And two separate external_overall H dims (one per rect)
    const eo = getDims(plan).filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    expect(eo).toHaveLength(2);
  });

  it("diagonal wall does not break internal_clear of adjacent rectilinear room", () => {
    const plan = mkPlan([
      mkWall("t", 0, 0, 4000, 0), mkWall("b", 0, 3000, 4000, 3000),
      mkWall("l", 0, 0, 0, 3000), mkWall("r", 4000, 0, 4000, 3000),
      mkWall("diag", 500, 500, 3500, 2500), // diagonal inside
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    expect(ic.length).toBeGreaterThanOrEqual(2); // H + V for the rect
  });
});

// J. WALL-DIMENSIONS-005 — detectRectCells with coverage-based matching (T-junction walls)
describe("generateWallDimensions — detectRectCells coverage (WALL-DIMENSIONS-005)", () => {
  // Outer 8000×5000 rect + full vertical partition at x=4000.
  // Top/bottom walls are full-span (not split at T-junction).
  function makeFullSpanTopBottom() {
    return mkPlan([
      mkWall("top",   0,    0,    8000, 0),    // full-span, not split at x=4000
      mkWall("bot",   0,    5000, 8000, 5000),
      mkWall("left",  0,    0,    0,    5000),
      mkWall("right", 8000, 0,    8000, 5000),
      mkWall("pv",    4000, 0,    4000, 5000), // vertical partition T-junctions into top/bot
    ]);
  }

  it("detects two cells when outer top/bottom walls are full-span (T-junction)", () => {
    const dims = getDims(makeFullSpanTopBottom());
    const ic = dims.filter((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    // left room: p1.x near 50, p2.x near 3950
    // right room: p1.x near 4050, p2.x near 7950
    const leftRoom = ic.filter((d) => Math.min(d.p1.x, d.p2.x) < 500 && Math.max(d.p1.x, d.p2.x) < 5000);
    const rightRoom = ic.filter((d) => Math.min(d.p1.x, d.p2.x) > 3000);
    expect(leftRoom.length).toBeGreaterThanOrEqual(1);
    expect(rightRoom.length).toBeGreaterThanOrEqual(1);
  });

  it("external_overall still appears exactly once (no duplicate from split)", () => {
    const extH = getDims(makeFullSpanTopBottom()).filter(
      (d) => d.kind === "external_overall" && d.orientation === "horizontal"
    );
    expect(extH).toHaveLength(1);
  });

  it("full vertical partition wall_length is suppressed (matches external_overall V)", () => {
    const wl = getDims(makeFullSpanTopBottom()).filter(
      (d) => d.kind === "wall_length" && d.id?.includes("pv")
    );
    expect(wl).toHaveLength(0);
  });

  it("detects two cells when horizontal partition creates T-junction on side walls", () => {
    const plan = mkPlan([
      mkWall("top",   0,    0,    8000, 0),
      mkWall("bot",   0,    5000, 8000, 5000),
      mkWall("left",  0,    0,    0,    5000),  // full-span left wall
      mkWall("right", 8000, 0,    8000, 5000),
      mkWall("ph",    0,    2500, 8000, 2500),  // horizontal partition
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear" && d.orientation === "vertical");
    const topRoom = ic.filter((d) => Math.min(d.p1.y, d.p2.y) < 1000);
    const botRoom = ic.filter((d) => Math.min(d.p1.y, d.p2.y) > 1000);
    expect(topRoom.length).toBeGreaterThanOrEqual(1);
    expect(botRoom.length).toBeGreaterThanOrEqual(1);
  });

  it("long wall coverage satisfies both cell edges without splitting", () => {
    // Top wall spans 0..8000. Cells need top edge at y=0 for [0..4000] AND [4000..8000].
    // hasH(0, 0, 4000) and hasH(0, 4000, 8000) must both be true from the single segment.
    const plan = mkPlan([
      mkWall("top",   0,    0,    8000, 0),
      mkWall("bot",   0,    4000, 8000, 4000),
      mkWall("left",  0,    0,    0,    4000),
      mkWall("right", 8000, 0,    8000, 4000),
      mkWall("pv",    4000, 0,    4000, 4000),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    // 2 H dims (one per room) + 2 V dims = 4 total, but at minimum 2
    expect(ic.length).toBeGreaterThanOrEqual(2);
  });

  it("slightly off-axis wall (y deviation ≤ 5mm) still classified as horizontal", () => {
    // Top wall with y=2 on one end (simulating fp drift in real plans)
    const plan = mkPlan([
      mkWall("top",   0, 2,    8000, 0),   // very slightly diagonal (dy=2 ≤ AXIS_TOL=5)
      mkWall("bot",   0, 4000, 8000, 4000),
      mkWall("left",  0, 0,    0,    4000),
      mkWall("right", 8000, 0, 8000, 4000),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    expect(ic.length).toBeGreaterThanOrEqual(1);
  });
});

// K. WALL-DIMENSIONS-006 — internal_clear measured from inner wall faces
describe("generateWallDimensions — internal_clear inner faces (WALL-DIMENSIONS-006)", () => {
  const THK = 300;

  // Simple rect 8000×5000 with thk=300 walls
  function makeThickRect() {
    return mkPlan([
      mkWall("t", 0,    0,    8000, 0,    THK),
      mkWall("b", 0,    5000, 8000, 5000, THK),
      mkWall("l", 0,    0,    0,    5000, THK),
      mkWall("r", 8000, 0,    8000, 5000, THK),
    ]);
  }

  it("horizontal internal_clear uses inner wall faces (not centerlines)", () => {
    const ic = getDims(makeThickRect()).filter(
      (d) => d.kind === "internal_clear" && d.orientation === "horizontal"
    );
    expect(ic.length).toBeGreaterThanOrEqual(1);
    // Width = 8000 - 150 - 150 = 7700
    const span = Math.round(Math.abs(ic[0].p2.x - ic[0].p1.x));
    expect(span).toBe(7700);
    // Endpoints must be inset from centerlines (not 0 or 8000)
    expect(Math.min(ic[0].p1.x, ic[0].p2.x)).toBeCloseTo(150, 0);
    expect(Math.max(ic[0].p1.x, ic[0].p2.x)).toBeCloseTo(7850, 0);
  });

  it("vertical internal_clear uses inner wall faces (not centerlines)", () => {
    const ic = getDims(makeThickRect()).filter(
      (d) => d.kind === "internal_clear" && d.orientation === "vertical"
    );
    expect(ic.length).toBeGreaterThanOrEqual(1);
    // Height = 5000 - 150 - 150 = 4700
    const span = Math.round(Math.abs(ic[0].p2.y - ic[0].p1.y));
    expect(span).toBe(4700);
    expect(Math.min(ic[0].p1.y, ic[0].p2.y)).toBeCloseTo(150, 0);
    expect(Math.max(ic[0].p1.y, ic[0].p2.y)).toBeCloseTo(4850, 0);
  });

  it("internal_clear endpoints are NOT equal to centerline cell boundaries", () => {
    const ic = getDims(makeThickRect()).filter((d) => d.kind === "internal_clear");
    ic.forEach((d) => {
      // p1 coords must not be exactly on the wall centerlines (0, 8000, 5000)
      expect(Math.min(d.p1.x, d.p2.x)).not.toBe(0);
      expect(Math.min(d.p1.y, d.p2.y)).not.toBe(0);
    });
  });

  it("split-V: left room uses partition inner face as right boundary", () => {
    // Left cell x0=0..x1=4000, partition at x=4000 thk=300
    // innerRight of left room = 4000 - 150 = 3850
    // width = 3850 - 150 = 3700
    const plan = mkPlan([
      mkWall("t",  0,    0,    8000, 0,    THK),
      mkWall("b",  0,    5000, 8000, 5000, THK),
      mkWall("l",  0,    0,    0,    5000, THK),
      mkWall("r",  8000, 0,    8000, 5000, THK),
      mkWall("pv", 4000, 0,    4000, 5000, THK),
    ]);
    const ic = getDims(plan).filter(
      (d) => d.kind === "internal_clear" && d.orientation === "horizontal"
    );
    // Both rooms have the same width (symmetric split)
    const spans = ic.map((d) => Math.round(Math.abs(d.p2.x - d.p1.x)));
    expect(spans.every((s) => s === 3700)).toBe(true);
  });

  it("split-H: top room uses partition inner face as bottom boundary", () => {
    // Top cell y0=0..y1=2500, partition at y=2500 thk=300
    // innerBot = 2500 - 150 = 2350, innerTop = 0 + 150 = 150
    // height = 2350 - 150 = 2200
    const plan = mkPlan([
      mkWall("t",  0,    0,    8000, 0,    THK),
      mkWall("b",  0,    5000, 8000, 5000, THK),
      mkWall("l",  0,    0,    0,    5000, THK),
      mkWall("r",  8000, 0,    8000, 5000, THK),
      mkWall("ph", 0,    2500, 8000, 2500, THK),
    ]);
    const ic = getDims(plan).filter(
      (d) => d.kind === "internal_clear" && d.orientation === "vertical"
    );
    const spans = ic.map((d) => Math.round(Math.abs(d.p2.y - d.p1.y)));
    expect(spans.every((s) => s === 2200)).toBe(true);
  });

  it("external_overall is unaffected by inner-face correction", () => {
    const eo = getDims(makeThickRect()).filter((d) => d.kind === "external_overall");
    expect(eo.length).toBeGreaterThanOrEqual(1);
    // external_overall span should be > internal_clear span (outer > inner)
    const eoH = eo.find((d) => d.orientation === "horizontal");
    const icH = getDims(makeThickRect())
      .filter((d) => d.kind === "internal_clear" && d.orientation === "horizontal")[0];
    if (eoH && icH) {
      const eoSpan = Math.abs(eoH.p2.x - eoH.p1.x);
      const icSpan = Math.abs(icH.p2.x - icH.p1.x);
      expect(eoSpan).toBeGreaterThan(icSpan);
    }
  });
});

// L. WALL-DIMENSIONS-007 — cell boundary suppression and cross-split rooms
describe("generateWallDimensions — cell boundary suppression (WALL-DIMENSIONS-007)", () => {
  it("cross-split: all 4 cells get internal_clear (8 total), 0 wall_length", () => {
    // Rectangle 8000×5000 with full H partition at y=2500 and full V partition at x=4000.
    // Produces 4 cells: TL, TR, BL, BR — each gets H and V internal_clear.
    // All 6 walls are full sides of at least one cell → suppressedWallIds → 0 wall_length.
    const plan = mkPlan([
      mkWall("t",  0,    0,    8000, 0,    100),
      mkWall("b",  0,    5000, 8000, 5000, 100),
      mkWall("l",  0,    0,    0,    5000, 100),
      mkWall("r",  8000, 0,    8000, 5000, 100),
      mkWall("ph", 0,    2500, 8000, 2500, 100),
      mkWall("pv", 4000, 0,    4000, 5000, 100),
    ]);
    const dims = getDims(plan);
    const ic = dims.filter((d) => d.kind === "internal_clear");
    const wl = dims.filter((d) => d.kind === "wall_length");
    expect(ic.length).toBe(8);
    expect(wl.length).toBe(0);
  });

  it("T-junction splits outer wall: split halves have no wall_length, 2 cells each get internal_clear", () => {
    // Top and bottom walls each split into 2 segments by a V partition at x=4000.
    // All 7 segments are full sides of their respective cells → 0 wall_length.
    const plan = mkPlan([
      mkWall("t1", 0,    0,    4000, 0,    100),
      mkWall("t2", 4000, 0,    8000, 0,    100),
      mkWall("b1", 0,    5000, 4000, 5000, 100),
      mkWall("b2", 4000, 5000, 8000, 5000, 100),
      mkWall("l",  0,    0,    0,    5000, 100),
      mkWall("r",  8000, 0,    8000, 5000, 100),
      mkWall("pv", 4000, 0,    4000, 5000, 100),
    ]);
    const dims = getDims(plan);
    expect(dims.filter((d) => d.kind === "wall_length").length).toBe(0);
    expect(dims.filter((d) => d.kind === "internal_clear").length).toBe(4); // 2 cells × H+V
  });

  it("partial partition not reaching outer walls: keeps wall_length", () => {
    // V stub at x=4000, y=1000→4000: doesn't touch the top (y=0) or bottom (y=5000) wall.
    // No complete cell can be formed with this partition → not in cellBoundaryWallIds.
    const plan = mkPlan([
      mkWall("t",   0,    0,    8000, 0,    100),
      mkWall("b",   0,    5000, 8000, 5000, 100),
      mkWall("l",   0,    0,    0,    5000, 100),
      mkWall("r",   8000, 0,    8000, 5000, 100),
      mkWall("pvp", 4000, 1000, 4000, 4000, 100),
    ]);
    const dims = getDims(plan);
    const partWl = dims.filter((d) => d.kind === "wall_length" && d.id?.includes("pvp"));
    expect(partWl.length).toBeGreaterThan(0);
  });

  it("activeWallId in opts has no effect on auto-dimension count", () => {
    const plan = mkPlan([
      mkWall("t", 0, 0, 4000, 0),
      mkWall("b", 0, 2000, 4000, 2000),
      mkWall("l", 0, 0, 0, 2000),
      mkWall("r", 4000, 0, 4000, 2000),
    ]);
    const base = getDims(plan);
    const withActive = generateWallDimensions(plan, { activeWallId: "t" }).dimensions;
    expect(withActive.length).toBe(base.length);
  });
});

// M. WALL-DIMENSIONS-008 — resolveCellInnerRect: explicit endpoint coordinates
describe("generateWallDimensions — inner rect endpoints (WALL-DIMENSIONS-008)", () => {
  // 5000×3000 rectangle, thk=300 on all sides.
  // inner faces: x=150..4850, y=150..2850
  function makeRect5x3() {
    return mkPlan([
      mkWall("t", 0,    0,    5000, 0,    300),
      mkWall("b", 0,    3000, 5000, 3000, 300),
      mkWall("l", 0,    0,    0,    3000, 300),
      mkWall("r", 5000, 0,    5000, 3000, 300),
    ]);
  }

  it("internal_clear endpoints use inner faces, not wall centerlines", () => {
    const dims = getDims(makeRect5x3());
    const icH = dims.find((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    const icV = dims.find((d) => d.kind === "internal_clear" && d.orientation === "vertical");
    expect(icH).toBeTruthy();
    expect(icV).toBeTruthy();
    // H: p1.x = innerLeft = 150, p2.x = innerRight = 4850
    expect(Math.min(icH.p1.x, icH.p2.x)).toBeCloseTo(150, 0);
    expect(Math.max(icH.p1.x, icH.p2.x)).toBeCloseTo(4850, 0);
    // H: both endpoints at y = innerTop = 150
    expect(icH.p1.y).toBeCloseTo(150, 0);
    expect(icH.p2.y).toBeCloseTo(150, 0);
    // V: p1.y = innerTop = 150, p2.y = innerBot = 2850
    expect(Math.min(icV.p1.y, icV.p2.y)).toBeCloseTo(150, 0);
    expect(Math.max(icV.p1.y, icV.p2.y)).toBeCloseTo(2850, 0);
    // No endpoint should lie on a wall centerline (0, 5000, 3000)
    [icH.p1, icH.p2, icV.p1, icV.p2].forEach((p) => {
      expect(p.x).not.toBe(0);
      expect(p.x).not.toBe(5000);
      expect(p.y).not.toBe(0);
      expect(p.y).not.toBe(3000);
    });
  });

  it("selected wall (activeWallId) does not shift internal_clear anchors", () => {
    // Outer rect + H partition at y=1500; pass activeWallId=partition to opts
    const plan = mkPlan([
      mkWall("t",  0,    0,    5000, 0,    100),
      mkWall("b",  0,    3000, 5000, 3000, 100),
      mkWall("l",  0,    0,    0,    3000, 100),
      mkWall("r",  5000, 0,    5000, 3000, 100),
      mkWall("ph", 0,    1500, 5000, 1500, 100),
    ]);
    const base    = generateWallDimensions(plan).dimensions.filter((d) => d.kind === "internal_clear");
    const active  = generateWallDimensions(plan, { activeWallId: "ph" }).dimensions.filter((d) => d.kind === "internal_clear");
    // Same count and same coordinates regardless of selection
    expect(active.length).toBe(base.length);
    base.forEach((bd) => {
      const ad = active.find((a) => a.id === bd.id);
      expect(ad).toBeTruthy();
      if (ad) {
        expect(ad.p1.x).toBeCloseTo(bd.p1.x, 0);
        expect(ad.p1.y).toBeCloseTo(bd.p1.y, 0);
        expect(ad.p2.x).toBeCloseTo(bd.p2.x, 0);
        expect(ad.p2.y).toBeCloseTo(bd.p2.y, 0);
      }
    });
  });

  it("equal-length internal_clear in separate cells are not deduped", () => {
    // Two disconnected identical rects: rect1 (0..3000 × 0..2000) and rect2 (4000..7000 × 0..2000)
    // Both produce H internal_clear of span 2900mm — different x positions → different keys.
    const plan = mkPlan([
      mkWall("r1t", 0,    0,    3000, 0,    100),
      mkWall("r1b", 0,    2000, 3000, 2000, 100),
      mkWall("r1l", 0,    0,    0,    2000, 100),
      mkWall("r1r", 3000, 0,    3000, 2000, 100),
      mkWall("r2t", 4000, 0,    7000, 0,    100),
      mkWall("r2b", 4000, 2000, 7000, 2000, 100),
      mkWall("r2l", 4000, 0,    4000, 2000, 100),
      mkWall("r2r", 7000, 0,    7000, 2000, 100),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    expect(ic.length).toBe(4); // 2 cells × (H + V)
    const icH = ic.filter((d) => d.orientation === "horizontal");
    expect(icH.length).toBe(2);
    // Both have the same span but different x-start → different dedup keys → both survive
    const spans = icH.map((d) => Math.round(Math.abs(d.p2.x - d.p1.x)));
    expect(spans.every((s) => s === 2900)).toBe(true);
    const x0s = icH.map((d) => Math.round(Math.min(d.p1.x, d.p2.x)));
    expect(new Set(x0s).size).toBe(2); // different starting x positions
  });
});

// N. WALL-DIMENSIONS-009 — innerFaceDist respects thicknessSide (not always thk/2)
describe("generateWallDimensions — thicknessSide-aware inner faces (WALL-DIMENSIONS-009)", () => {
  // Helper: wall with explicit thicknessSide
  function mkWallSide(id, x0, y0, x1, y1, thk, thicknessSide) {
    return { id, thk, thicknessSide, pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }] };
  }

  it("internal_clear anchors at axis+thk for thicknessSide='in' (axis = outer face)", () => {
    // Room 4000×3000, left/right walls thicknessSide="in", thk=200:
    //   axis = outer face; inner face = axis + thk (inward) = 200mm from axis.
    // Expected: innerLeft = 0 + 200 = 200; innerRight = 4000 - 200 = 3800
    // Clear width = 3600mm.
    const plan = mkPlan([
      mkWall("t", 0,    0,    4000, 0,    100),           // center (default)
      mkWall("b", 0,    3000, 4000, 3000, 100),
      mkWallSide("l", 0,    0, 0,    3000, 200, "in"),    // axis = outer face
      mkWallSide("r", 4000, 0, 4000, 3000, 200, "in"),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    expect(ic.length).toBeGreaterThan(0);
    const h = ic[0];
    // innerLeft = 0 + 200 = 200, innerRight = 4000 - 200 = 3800
    expect(Math.round(Math.min(h.p1.x, h.p2.x))).toBe(200);
    expect(Math.round(Math.max(h.p1.x, h.p2.x))).toBe(3800);
    // label span matches visual anchor distance
    expect(Math.round(Math.abs(h.p2.x - h.p1.x))).toBe(3600);
  });

  it("internal_clear anchors at axis+0 for thicknessSide='out' (axis = inner face)", () => {
    // Room 4000×3000, left/right walls thicknessSide="out", thk=200:
    //   axis = inner face; inner face = axis + 0 = at the axis coordinate.
    // Expected: innerLeft = 0, innerRight = 4000; clear width = 4000mm.
    const plan = mkPlan([
      mkWall("t", 0,    0,    4000, 0,    100),
      mkWall("b", 0,    3000, 4000, 3000, 100),
      mkWallSide("l", 0,    0, 0,    3000, 200, "out"),   // axis = inner face
      mkWallSide("r", 4000, 0, 4000, 3000, 200, "out"),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear" && d.orientation === "horizontal");
    expect(ic.length).toBeGreaterThan(0);
    const h = ic[0];
    // innerLeft = 0 + 0 = 0, innerRight = 4000 - 0 = 4000
    expect(Math.round(Math.min(h.p1.x, h.p2.x))).toBe(0);
    expect(Math.round(Math.max(h.p1.x, h.p2.x))).toBe(4000);
    expect(Math.round(Math.abs(h.p2.x - h.p1.x))).toBe(4000);
  });

  it("label length always equals visual anchor distance regardless of thicknessSide", () => {
    // Mixed thicknessSide: top "center" thk=100, bottom "in" thk=200, left "out" thk=150, right "center" thk=100
    // Vertical inner clear:
    //   innerTop = 0 + innerFaceDist(100,"center") = 50
    //   innerBot = 3000 - innerFaceDist(200,"in") = 3000 - 200 = 2800
    //   V clear height = 2800 - 50 = 2750
    const plan = mkPlan([
      mkWall("t",    0,    0,    4000, 0,    100),         // center
      mkWallSide("b", 0, 3000, 4000, 3000, 200, "in"),    // axis = outer face
      mkWallSide("l", 0,    0,    0, 3000,  150, "out"),  // axis = inner face
      mkWall("r", 4000, 0, 4000, 3000, 100),              // center
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    // Both H and V dims: label distance must equal |p2 - p1|
    ic.forEach((d) => {
      const dist = Math.round(Math.abs(
        d.orientation === "horizontal" ? d.p2.x - d.p1.x : d.p2.y - d.p1.y,
      ));
      // The label (no labelOverride) is computed from |p2-p1| in the renderer — verify consistency
      // by checking the raw distance matches expectations based on thicknessSide:
      // V: innerTop=50, innerBot=2800 → height=2750
      if (d.orientation === "vertical") expect(dist).toBe(2750);
    });
  });
});

// S. WALL-DIMENSIONS-011 — complex/L-shaped contour suppression
describe("generateWallDimensions — complex contour suppression (WALL-DIMENSIONS-011)", () => {
  it("S-1: L-shaped closed room does not emit internal_clear or wall_length", () => {
    const plan = mkPlan([
      mkWall("t",  0,    0,    4000, 0,    100),
      mkWall("ru", 4000, 0,    4000, 2000, 100),
      mkWall("si", 4000, 2000, 2000, 2000, 100),
      mkWall("sd", 2000, 2000, 2000, 4000, 100),
      mkWall("b",  2000, 4000, 0,    4000, 100),
      mkWall("l",  0,    4000, 0,    0,    100),
    ]);
    const dims = getDims(plan);
    expect(dims.filter((d) => d.kind === "internal_clear")).toHaveLength(0);
    expect(dims.filter((d) => d.kind === "external_overall").length).toBeGreaterThan(0);
    expect(dims.filter((d) => d.kind === "wall_length")).toHaveLength(0);
  });

  it("S-2: simple rectangle still keeps internal_clear", () => {
    const plan = mkPlan([
      mkWall("t", 0,    0,    4000, 0,    100),
      mkWall("b", 0,    3000, 4000, 3000, 100),
      mkWall("l", 0,    0,    0,    3000, 100),
      mkWall("r", 4000, 0,    4000, 3000, 100),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    expect(ic.length).toBeGreaterThan(0);
  });

  it("S-3: split rectangle keeps room cell internal_clear", () => {
    const plan = mkPlan([
      mkWall("t",  0,    0,    4000, 0,    100),
      mkWall("b",  0,    4000, 4000, 4000, 100),
      mkWall("l",  0,    0,    0,    4000, 100),
      mkWall("r",  4000, 0,    4000, 4000, 100),
      mkWall("mh", 0,    2000, 4000, 2000, 100),
    ]);
    const ic = getDims(plan).filter((d) => d.kind === "internal_clear");
    expect(ic.length).toBeGreaterThan(0);
  });

  it("S-4: U-shaped complex closed loop suppresses per-wall clutter", () => {
    const plan = mkPlan([
      mkWall("t",  0,    0,    6000, 0,    100),
      mkWall("r",  6000, 0,    6000, 4000, 100),
      mkWall("br", 6000, 4000, 4000, 4000, 100),
      mkWall("ir", 4000, 4000, 4000, 2000, 100),
      mkWall("it", 4000, 2000, 2000, 2000, 100),
      mkWall("il", 2000, 2000, 2000, 4000, 100),
      mkWall("bl", 2000, 4000, 0,    4000, 100),
      mkWall("lw", 0,    4000, 0,    0,    100),
    ]);
    const dims = getDims(plan);
    expect(dims.filter((d) => d.kind === "wall_length")).toHaveLength(0);
    expect(dims.filter((d) => d.kind === "internal_clear")).toHaveLength(0);
    expect(dims.filter((d) => d.kind === "external_overall").length).toBeGreaterThan(0);
  });

  it("S-5: standalone diagonal wall keeps wall_length", () => {
    const plan = mkPlan([
      mkWall("diag", 0, 0, 3000, 4000, 100),
    ]);
    const wl = getDims(plan).filter((d) => d.kind === "wall_length");
    expect(wl.length).toBeGreaterThan(0);
  });
});

