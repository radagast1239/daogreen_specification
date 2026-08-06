import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { layoutDimensionLabels } from "../src/planner/core/dimensions/dimensionLayout.js";
import { computeLinearDimensionGeometry, resolveLabelMetrics } from "../src/planner/core/dimensions/renderGeometry.js";
import {
  WallSelectionDims,
  DimensionsLayer,
  planSelectedWallDimensions,
  dimensionAssociatesWithWall,
  DIM_SELECTION_ACCENT,
} from "../src/planner/dimensionMarkers.jsx";
import { dimensionKeySet } from "../src/planner/core/dimensions/dimensionCanonicalKeys.js";
import { buildPhysicalSpanKey } from "../src/planner/core/dimensions/finalizeAutoDimensions.js";

function complexReferenceFixture() {
  return {
    nodes: {
      n1: { x: 0, y: 0 }, n2: { x: 2500, y: 0 }, n3: { x: 2500, y: 1500 },
      n4: { x: 2100, y: 1900 }, n5: { x: 1500, y: 1900 }, n6: { x: 1100, y: 1500 },
      n7: { x: 300, y: 1700 }, n8: { x: 500, y: 250 }, n9: { x: 1000, y: 750 }, n10: { x: 500, y: 900 },
    },
    walls: [
      { id: "top", a: "n1", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "top" },
      { id: "right", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "right" },
      { id: "diagUR", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "diagUR" },
      { id: "botR", a: "n4", b: "n5", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "botR" },
      { id: "diagBL", a: "n5", b: "n6", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "diagBL" },
      { id: "diagAcute", a: "n6", b: "n7", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "diagAcute" },
      { id: "closeDiag", a: "n7", b: "n1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "closeDiag" },
      { id: "intA", a: "n8", b: "n9", thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "intA" },
      { id: "intB", a: "n9", b: "n10", thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "intB" },
    ],
    room: { w: 2500, h: 1900, wallThk: 100, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

function fitLayout(dimensions, zoom, selectedId = null) {
  const geometry = Object.fromEntries(
    dimensions.map((dim) => [dim.id, computeLinearDimensionGeometry({ p1: dim.p1, p2: dim.p2, offset: dim.offset, zoom })]),
  );
  const tagged = dimensions.map((dim) => ({ ...dim, selected: selectedId === dim.id }));
  return layoutDimensionLabels(tagged, geometry, { zoom, selectedId });
}

function wallEl(plan, wallId) {
  const w = plan.walls.find((x) => x.id === wallId);
  return {
    id: wallId,
    thk: w.thk || 100,
    pts: [plan.nodes[w.a], plan.nodes[w.b]],
  };
}

function renderWithSelection(dimensions, wall, emphasizeWallId = null) {
  return renderToStaticMarkup(
    React.createElement(
      "svg",
      null,
      React.createElement(DimensionsLayer, {
        dimensions,
        k: 1,
        fmtDim: (n) => `${n} мм`,
        display: { wallsForEmphasis: wall ? [wall] : [] },
        zoom: 1,
        selectedId: null,
        emphasizeWallId: emphasizeWallId || wall?.id || null,
        emphasizeWall: wall || null,
      }),
      React.createElement(WallSelectionDims, {
        wall: wall || { id: "x", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        room: {},
        k: 1,
        fmtU: (n) => `${n}`,
        display: {},
        dimensions,
      }),
    ),
  );
}

describe("Fit-scale visibility policy (complex reference fixture)", () => {
  const plan = complexReferenceFixture();
  const { dimensions } = generateWallDimensions(plan);
  const FIT_ZOOM = 0.64;

  it("1. shows a non-zero number of primary labels at Fit scale", () => {
    const presentation = fitLayout(dimensions, FIT_ZOOM);
    expect(presentation.filter((p) => p.visible).length).toBeGreaterThan(0);
  });

  it("2. keeps both external_overall dimensions visible at Fit scale", () => {
    const presentation = fitLayout(dimensions, FIT_ZOOM);
    const byId = new Map(presentation.map((p) => [p.id, p]));
    const overallIds = dimensions.filter((d) => d.kind === "external_overall").map((d) => d.id);
    expect(overallIds.length).toBeGreaterThan(0);
    for (const id of overallIds) expect(byId.get(id)?.visible).toBe(true);
  });

  it("5. the visibility policy is deterministic across repeated calls", () => {
    expect(fitLayout(dimensions, FIT_ZOOM)).toEqual(fitLayout(dimensions, FIT_ZOOM));
  });
});

describe("PHASE 2F1 — no label cards; text halo only", () => {
  const plan = complexReferenceFixture();
  const { dimensions } = generateWallDimensions(plan);
  const wall = wallEl(plan, "top");

  it("1-3. normal dimensions render no background rect; halo + line knockout", () => {
    const html = renderWithSelection(dimensions, null, null);
    expect(html).not.toMatch(/data-label-card="1"/);
    expect(html).toMatch(/data-label-card="0"/);
    expect(html).toMatch(/data-label-halo="1"/);
    expect(html).toMatch(/paint-order="stroke fill"/);
    expect(html).toMatch(/data-label-knockout="1"/);
    expect(html).toMatch(/data-dim-line-seg="a"/);
    expect(html).toMatch(/data-dim-line-seg="b"/);
    expect(html).not.toMatch(/<rect[^>]*rx=/);
  });

  it("4. horizontal / vertical / oblique labels remain present", () => {
    const html = renderWithSelection(dimensions, wall, "top");
    expect(html).toMatch(/data-mode="linear"/);
    expect(html.length).toBeGreaterThan(200);
  });
});

describe("PHASE 2F1 — selection emphasizes canonical dims only (zero new records)", () => {
  const plan = complexReferenceFixture();
  const resolved = { ...plan, walls: resolvePlanWalls(plan) };
  const { dimensions } = generateWallDimensions(resolved);
  const wall = wallEl(plan, "top");

  it("5-6. selecting a wall emphasizes associated canonical dim; no duplicate", () => {
    const before = dimensionKeySet(dimensions);
    const beforeIds = dimensions.map((d) => d.id).sort().join("|");
    const associated = dimensions.filter((d) => dimensionAssociatesWithWall(d, wall));
    expect(associated.length).toBeGreaterThanOrEqual(1);
    const html = renderWithSelection(dimensions, wall, "top");
    expect(html).toContain('data-dimension-selected="true"');
    expect(html).toContain(DIM_SELECTION_ACCENT);
    expect(html).not.toContain("#e0312a"); // bright red rejected
    expect(html).toContain('data-emphasize-wall="top"');
    expect(dimensionKeySet(dimensions)).toBe(before);
    expect(dimensions.map((d) => d.id).sort().join("|")).toBe(beforeIds);
    // No second generator path.
    expect(html).not.toContain("data-selection-mode");
    expect(html).not.toContain("selected_physical_edge_length");
  });

  it("7-11. selection adds zero records; no selected-only / centreline fallback", () => {
    const planned = planSelectedWallDimensions(wall, plan.room, dimensions);
    expect(planned.mode).toBe("suppress");
    expect(planned.segments).toEqual([]);
    expect(WallSelectionDims({ wall, room: plan.room, dimensions })).toBe(null);
    expect(renderWithSelection(dimensions, wall, "top")).not.toContain("sel-outline-");
  });

  it("12. deselect restores normal style (no selected attrs without emphasize)", () => {
    const html = renderWithSelection(dimensions, null, null);
    expect(html).not.toContain('data-dimension-selected="true"');
  });

  it("wall without nearby canonical dim produces no selected styling for unrelated dims only", () => {
    const orphan = { id: "orphan", thk: 100, pts: [{ x: 9000, y: 9000 }, { x: 9500, y: 9000 }] };
    const html = renderWithSelection(dimensions, orphan, "orphan");
    // Orphan far from fixture — no emphasized dims.
    expect(html).not.toContain('data-dimension-selected="true"');
  });
});

describe("PHASE 2F1 — label stays on dimension line across zoom", () => {
  const plan = complexReferenceFixture();
  const { dimensions } = generateWallDimensions(plan);

  it("9. perpendicular distance to line ≤ 0.5 px at many zooms", () => {
    const dim = dimensions.find((d) => d.kind === "external_overall") || dimensions[0];
    for (const zoom of [0.05, 0.1, 0.2, 0.5, 1, 2, 3]) {
      const g = computeLinearDimensionGeometry({
        p1: dim.p1, p2: dim.p2, offset: dim.offset, style: dim.style, zoom,
      });
      const mid = {
        x: (g.dimensionLine.a.x + g.dimensionLine.b.x) / 2,
        y: (g.dimensionLine.a.y + g.dimensionLine.b.y) / 2,
      };
      expect(g.labelBase.x).toBeCloseTo(mid.x, 6);
      expect(g.labelBase.y).toBeCloseTo(mid.y, 6);
      const layout = layoutDimensionLabels(
        [{ ...dim, label: dim.labelOverride || "1.00" }],
        { [dim.id]: g },
        { zoom },
      );
      const pos = layout[0]?.position || g.labelBase;
      const ax = g.dimensionLine.a.x, ay = g.dimensionLine.a.y;
      const bx = g.dimensionLine.b.x, by = g.dimensionLine.b.y;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const cross = Math.abs((pos.x - ax) * (by - ay) - (pos.y - ay) * (bx - ax)) / len;
      expect(cross * zoom, `zoom=${zoom}`).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it("16. font and halo remain screen-bounded", () => {
    const m1 = resolveLabelMetrics({}, 0.05, "8.10");
    const m2 = resolveLabelMetrics({}, 8, "8.10");
    for (const m of [m1, m2]) {
      expect(m.fontPx).toBeGreaterThanOrEqual(9);
      expect(m.fontPx).toBeLessThanOrEqual(14);
      expect(m.haloPx).toBeGreaterThanOrEqual(2.5);
      expect(m.haloPx).toBeLessThanOrEqual(4.5);
      expect(m.horizontalPaddingPx).toBe(0);
      expect(m.cornerRadiusPx).toBe(0);
    }
  });
});

describe("PHASE 2F1 — physical span key merges overall≡local", () => {
  it("exact same span from two pipelines collapses to one key", () => {
    const a = {
      kind: "external_segment",
      p1: { x: -50, y: -50 },
      p2: { x: 8050, y: -50 },
      measurementValue: 8100,
      reference: { side: "outer", envelopeId: "e1" },
    };
    const b = {
      kind: "external_overall",
      p1: { x: -50, y: -50 },
      p2: { x: 8050, y: -50 },
      measurementValue: 8100,
      reference: { side: "outer", envelopeId: "e1" },
    };
    expect(buildPhysicalSpanKey(a)).toBe(buildPhysicalSpanKey(b));
  });
});
