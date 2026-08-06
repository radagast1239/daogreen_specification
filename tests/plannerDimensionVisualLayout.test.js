import { describe, expect, it } from "vitest";
import { computeLinearDimensionGeometry } from "../src/planner/core/dimensions/renderGeometry.js";
import {
  computeDimensionLabelLanes, layoutDimensionLabels, shouldRenderDimensionLabel,
} from "../src/planner/core/dimensions/dimensionLayout.js";
import { computeSelectionHandles, placeHandleAvoidingLabels } from "../src/planner/selectionHandleLayout.js";

const geom = (p1, p2, offset = 100, zoom = 1, mode = "linear") => computeLinearDimensionGeometry({ p1, p2, offset, zoom, mode });
const boxesOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("dimension label lanes", () => {
  it("lays out 8 labels on one wall without intersections", () => {
    const dimensions = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, auto: true, kind: "local", label: `${800 + i * 25}` }));
    const geometry = Object.fromEntries(dimensions.map((d, i) => [d.id, geom({ x: i * 180, y: 0 }, { x: i * 180 + 900, y: 0 }, 100)]));
    const result = layoutDimensionLabels(dimensions, geometry, { zoom: 1, maxLanes: 8 });
    const shown = result.filter((entry) => entry.visible);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) expect(boxesOverlap(shown[i].bounds, shown[j].bounds)).toBe(false);
  });

  it("prioritizes selected, manual, total, then local auto", () => {
    const dimensions = [
      { id: "local", auto: true, kind: "local" }, { id: "total", auto: true, kind: "total" },
      { id: "manual", auto: false, kind: "manual" }, { id: "selected", auto: true, kind: "local", selected: true },
    ];
    const geometry = Object.fromEntries(dimensions.map((d) => [d.id, geom({ x: 0, y: 0 }, { x: 1000, y: 0 })]));
    expect(computeDimensionLabelLanes(dimensions, geometry, { zoom: 1 }).map((x) => x.priority)).toEqual([3, 2, 1, 0]);
  });

  it.each([
    ["horizontal", { x: 0, y: 0 }, { x: 1000, y: 0 }],
    ["vertical", { x: 0, y: 0 }, { x: 0, y: 1000 }],
    ["diagonal", { x: 0, y: 0 }, { x: 800, y: 600 }],
    ["reversed", { x: 1000, y: 0 }, { x: 0, y: 0 }],
  ])("supports %s dimensions", (_name, p1, p2) => {
    const dimension = { id: "d", kind: "manual" };
    const geometry = geom(p1, p2, 100);
    const result = layoutDimensionLabels([dimension], { d: geometry }, { zoom: 1 });
    expect(result[0]).toMatchObject({ visible: true, lane: 0 });
    expect(result[0].position).toEqual(geometry.labelBase);
  });

  it.each([0.25, 0.5, 1, 2])("uses screen-pixel LOD at %s zoom", (zoom) => {
    const geometry = geom({ x: 0, y: 0 }, { x: 200, y: 0 }, 100, zoom);
    const local = { id: "local", auto: true, kind: "local" };
    expect(shouldRenderDimensionLabel(local, geometry, { zoom })).toBe(zoom >= 0.5 && 200 * zoom >= 72);
  });

  it("keeps selected dimension visible at low zoom", () => {
    const dimension = { id: "selected", auto: true, kind: "local", selected: true };
    expect(shouldRenderDimensionLabel(dimension, geom({ x: 0, y: 0 }, { x: 10, y: 0 }), { zoom: 0.25 })).toBe(true);
  });

  it("keeps total while hiding local auto at low zoom and restores on zoom in", () => {
    const g = geom({ x: 0, y: 0 }, { x: 400, y: 0 });
    expect(shouldRenderDimensionLabel({ id: "total", auto: true, kind: "total" }, g, { zoom: 0.25 })).toBe(true);
    expect(shouldRenderDimensionLabel({ id: "local", auto: true, kind: "local" }, g, { zoom: 0.25 })).toBe(false);
    expect(shouldRenderDimensionLabel({ id: "local", auto: true, kind: "local" }, g, { zoom: 1 })).toBe(true);
  });

  // LIVE4.4/4.5 contract: perpendicular lanes were removed (they drifted with
  // zoom). A wall that covers the whole dimension line leaves a primary label
  // crowded in place -- still visible, still on the line, never in a lane.
  it("crowds a label in place instead of opening a perpendicular lane", () => {
    const d = { id: "d", kind: "manual" }, g = geom({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100);
    const result = layoutDimensionLabels([d], { d: g }, { zoom: 1, walls: [{ pts: [{ x: 0, y: 100 }, { x: 1000, y: 100 }] }] });
    expect(result[0]).toMatchObject({ visible: true, lane: 0, crowded: true, alongDisplacementMm: 0 });
    expect(result[0].position).toEqual(g.labelBase);
  });

  it("hides low-priority labels if all lanes collide", () => {
    const blockers = Array.from({ length: 8 }, (_, i) => ({ left: -1000, right: 1000, top: 80 + i * 20, bottom: 140 + i * 20 }));
    const result = layoutDimensionLabels([{ id: "d", auto: true, kind: "local" }], { d: geom({ x: 0, y: 0 }, { x: 1000, y: 0 }, 100) }, { zoom: 1, labelBounds: blockers, maxLanes: 4 });
    expect(result[0]).toMatchObject({ visible: false, reason: "collision" });
  });

  it("is deterministic and does not mutate dimensions", () => {
    const dimensions = [{ id: "b", auto: true, kind: "local" }, { id: "a", kind: "manual" }];
    const geometry = { a: geom({ x: 0, y: 0 }, { x: 1000, y: 0 }), b: geom({ x: 0, y: 0 }, { x: 1000, y: 0 }) };
    const before = structuredClone(dimensions);
    expect(layoutDimensionLabels(dimensions, geometry, { zoom: 1 })).toEqual(layoutDimensionLabels(dimensions, geometry, { zoom: 1 }));
    expect(dimensions).toEqual(before);
  });

  it("handles corrupt geometry safely", () => {
    expect(() => layoutDimensionLabels([null, { id: "bad" }], { bad: { valid: true, labelBase: { x: NaN, y: 0 } } }, { zoom: 1 })).not.toThrow();
    expect(layoutDimensionLabels([{ id: "bad" }], {}, { zoom: 1 })[0].visible).toBe(false);
  });

  it("lays out 500 dimensions within performance budget", () => {
    const dimensions = Array.from({ length: 500 }, (_, i) => ({ id: `${i}`, auto: true, kind: "local" }));
    const geometry = Object.fromEntries(dimensions.map((d, i) => [d.id, geom({ x: i * 100, y: 0 }, { x: i * 100 + 90, y: 0 })]));
    const start = performance.now(); expect(layoutDimensionLabels(dimensions, geometry, { zoom: 1 })).toHaveLength(500);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("selection handle presentation", () => {
  it("provides distinct endpoint, move and offset glyphs only in active context", () => {
    expect(computeSelectionHandles({ endpoints: [{ x: 0, y: 0 }] })).toEqual([]);
    const handles = computeSelectionHandles({ selected: true, endpoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }], center: { x: 5, y: 0 }, offsetPoint: { x: 5, y: 10 } });
    expect(handles.map((h) => h.glyph)).toEqual(["endpoint", "endpoint", "move", "offset"]);
  });

  it.each([0.25, 0.5, 1, 2])("keeps 10px visuals invariant at %s zoom", (zoom) => {
    const [handle] = computeSelectionHandles({ selected: true, endpoints: [{ x: 100, y: 100 }] }, { zoom });
    expect(handle.visualSizePx).toBe(10); expect(handle.hitSizePx).toBe(22);
  });

  it("moves handles away from labels", () => {
    const handle = placeHandleAvoidingLabels({ x: 100, y: 100, glyph: "endpoint" }, [{ left: 90, right: 110, top: 90, bottom: 110 }], { zoom: 1 });
    expect(handle.displaced).toBe(true); expect(handle.y).not.toBe(100);
  });

  it("ignores corrupt handle points", () => expect(computeSelectionHandles({ selected: true, endpoints: [{ x: NaN, y: 0 }, null] })).toEqual([]));
});
