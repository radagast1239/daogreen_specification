import { describe, expect, it } from "vitest";
import {
  createAngleDimension, createDiagonalDimension, createWallDimension, dedupeAutoDimensions,
  invalidateDimensionsAfterWallDelete, normalizeDimensionModel, remapDimensionAfterWallSplit,
  remapDimensionsAfterNodeMerge, remapDimensionsAfterWallMove, resolveDimensionAnchors,
} from "../src/planner/core/dimensions/index.js";

const plan = () => ({
  nodes: { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, c: { x: 3000, y: 4000 }, d: { x: 6000, y: 0 } },
  walls: [{ id: "w1", a: "a", b: "b" }, { id: "w2", a: "b", b: "c" }, { id: "w3", a: "b", b: "d" }],
  items: [{ id: "door", x: 1000, y: 0, w: 900, h: 100 }], dimensions: [],
});
const auto = (id, anchors) => ({ id, auto: true, type: "dimension", mode: "linear", kind: "wall_length", source: "walls", anchors });

describe("stable dimension anchor core", () => {
  it("1 manual survives normalization with text/style/id", () => {
    const d = { id: "m", p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 }, labelOverride: "custom", style: { color: "red" } };
    expect(normalizeDimensionModel([d]).dimensions[0]).toMatchObject({ id: "m", kind: "manual", labelOverride: "custom", style: { color: "red" } });
  });
  it("2 auto dedupe is idempotent", () => {
    const ds = [auto("a", [{ type: "node", nodeId: "a" }, { type: "node", nodeId: "b" }]), auto("b", [{ type: "node", nodeId: "a" }, { type: "node", nodeId: "b" }])];
    const once = dedupeAutoDimensions(ds); expect(once.dimensions).toHaveLength(1); expect(dedupeAutoDimensions(once.dimensions).changed).toBe(false);
  });
  it("3 reversed anchors dedupe", () => {
    const ab = [{ type: "node", nodeId: "a" }, { type: "node", nodeId: "b" }];
    expect(dedupeAutoDimensions([auto("a", ab), auto("b", [...ab].reverse())]).dimensions).toHaveLength(1);
  });
  it("4 manual and auto coexist", () => {
    const anchors = [{ type: "node", nodeId: "a" }, { type: "node", nodeId: "b" }];
    expect(dedupeAutoDimensions([{ id: "m", auto: false, anchors }, auto("a", anchors)]).dimensions).toHaveLength(2);
  });
  it("5 move node updates a wall dimension and preserves metadata", () => {
    const d = createWallDimension({ id: "m", wallId: "w1", labelOverride: "x", style: { c: 1 }, offset: 99 });
    const p = plan(); p.nodes.b.x = 5000; const got = remapDimensionsAfterWallMove(p, [d]).dimensions[0];
    expect(got.p2.x).toBe(5000); expect(got).toMatchObject({ id: "m", labelOverride: "x", style: { c: 1 }, offset: 99 });
  });
  it("6 shared-node move updates all relevant dimensions", () => {
    const p = plan(); p.nodes.b = { x: 3200, y: 200 };
    const ds = [createWallDimension({ id: "x", wallId: "w1" }), createWallDimension({ id: "y", wallId: "w2" })];
    expect(remapDimensionsAfterWallMove(p, ds).dimensions.map((d) => [d.p1, d.p2])).toContainEqual([{ x: 3200, y: 200 }, { x: 3000, y: 4000 }]);
  });
  it("7 split preserves endpoint anchors", () => {
    const d = { id: "e", anchors: [{ type: "wall_endpoint", wallId: "w1", endpoint: "a", nodeId: "a" }, { type: "wall_endpoint", wallId: "w1", endpoint: "b", nodeId: "b" }] };
    const r = remapDimensionAfterWallSplit([d], { oldWallId: "w1", secondWallId: "w1b" }); expect(r.dimensions[0].anchors.map((a) => a.wallId)).toEqual(["w1", "w1b"]);
  });
  it("8 ambiguous whole-wall anchor returns review warning", () => {
    const r = remapDimensionAfterWallSplit([{ id: "m", anchors: [{ type: "wall", wallId: "w1" }] }], { oldWallId: "w1", secondWallId: "w1b" });
    expect(r.warnings[0].code).toBe("DIMENSION_ANCHOR_NEEDS_REVIEW"); expect(r.dimensions[0].invalid).toBe(true);
  });
  it("9 split twice is idempotent for the old wall", () => {
    const d = createWallDimension({ id: "m", wallId: "w1" }); const a = remapDimensionAfterWallSplit([d], { oldWallId: "w1", secondWallId: "w1b" });
    expect(remapDimensionAfterWallSplit(a.dimensions, { oldWallId: "gone", secondWallId: "x" }).changed).toBe(false);
  });
  it("10 delete invalidates manual explicitly", () => { const r = invalidateDimensionsAfterWallDelete([createWallDimension({ id: "m", wallId: "w1" })], { wallIds: ["w1"] }); expect(r.dimensions[0].invalid).toBe(true); expect(r.warnings).toHaveLength(1); });
  it("11 delete removes eligible auto only", () => { const r = invalidateDimensionsAfterWallDelete([auto("a", [{ type: "wall", wallId: "w1" }]), createWallDimension({ id: "m", wallId: "w1" })], { wallIds: ["w1"] }); expect(r.dimensions.map((d) => d.id)).toEqual(["m"]); });
  it("12 unrelated wall delete does nothing", () => { expect(invalidateDimensionsAfterWallDelete([createWallDimension({ id: "m", wallId: "w1" })], { wallIds: ["w2"] }).changed).toBe(false); });
  it("13 item dimension survives wall operation", () => { const d = { id: "i", anchors: [{ type: "item", itemId: "door" }] }; expect(invalidateDimensionsAfterWallDelete([d], { wallIds: ["w1"] }).dimensions).toEqual([d]); });
  it("14 free dimension survives wall operation", () => { const d = { id: "f", anchors: [{ type: "free", point: { x: 1, y: 2 } }] }; expect(invalidateDimensionsAfterWallDelete([d], { wallIds: ["w1"] }).dimensions).toEqual([d]); });
  it("15 diagonal has real length", () => { const r = resolveDimensionAnchors(plan(), createDiagonalDimension({ id: "d", fromNodeId: "a", toNodeId: "c" })); expect(r.dimensions[0].value).toBe(5000); });
  it("16 diagonal updates after node move", () => { const p = plan(); p.nodes.c = { x: 0, y: 4000 }; expect(resolveDimensionAnchors(p, createDiagonalDimension({ id: "d", fromNodeId: "a", toNodeId: "c" })).dimensions[0].value).toBe(4000); });
  it("17 diagonal invalid anchor warns", () => { expect(resolveDimensionAnchors(plan(), createDiagonalDimension({ id: "d", fromNodeId: "a", toNodeId: "missing" })).warnings[0].code).toBe("DIMENSION_ANCHOR_INVALID"); });
  it("18 perpendicular angle is 90", () => { expect(resolveDimensionAnchors(plan(), createAngleDimension({ id: "a", vertexNodeId: "b", rayNodeId1: "a", rayNodeId2: "c" })).dimensions[0].angle).toBeCloseTo(90); });
  it("19 diagonal angle is correct", () => { const p = plan(); p.nodes.c = { x: 1000, y: 1000 }; expect(resolveDimensionAnchors(p, createAngleDimension({ id: "a", vertexNodeId: "a", rayNodeId1: "b", rayNodeId2: "c" })).dimensions[0].angle).toBeCloseTo(45); });
  it("20 reversed ray order gives same angle", () => { const p = plan(); const a = resolveDimensionAnchors(p, createAngleDimension({ id: "a", vertexNodeId: "b", rayNodeId1: "a", rayNodeId2: "c" })).dimensions[0].angle; const b = resolveDimensionAnchors(p, createAngleDimension({ id: "b", vertexNodeId: "b", rayNodeId1: "c", rayNodeId2: "a" })).dimensions[0].angle; expect(a).toBe(b); });
  it("21 collinear geometry warns", () => { expect(resolveDimensionAnchors(plan(), createAngleDimension({ id: "a", vertexNodeId: "b", rayNodeId1: "a", rayNodeId2: "d" })).warnings[0].code).toBe("DIMENSION_ANGLE_INVALID"); });
  it("22 zero length geometry warns", () => { expect(resolveDimensionAnchors(plan(), createAngleDimension({ id: "a", vertexNodeId: "b", rayNodeId1: "b", rayNodeId2: "c" })).warnings[0].code).toBe("DIMENSION_ANGLE_INVALID"); });
  it("23 T-junction angle", () => { expect(resolveDimensionAnchors(plan(), createAngleDimension({ id: "a", vertexNodeId: "b", rayNodeId1: "d", rayNodeId2: "c" })).dimensions[0].angle).toBeCloseTo(90); });
  it("24 stable ids", () => { expect(resolveDimensionAnchors(plan(), createDiagonalDimension({ id: "stable", fromNodeId: "a", toNodeId: "c" })).dimensions[0].id).toBe("stable"); });
  it("25 legacy wall attachment migrates", () => { const d = { id: "l", attachedTo: { type: "wall", wallId: "w1", t0: 0, t1: 1 } }; expect(normalizeDimensionModel([d]).dimensions[0].anchors).toHaveLength(2); });
  it("26 mixed legacy/current dimensions", () => { const r = normalizeDimensionModel([{ id: "l", attachedTo: { type: "wall", wallId: "w1", t0: 0, t1: 1 } }, createDiagonalDimension({ id: "d", fromNodeId: "a", toNodeId: "c" })]); expect(r.dimensions).toHaveLength(2); });
  it("27 normalize twice unchanged", () => { const a = normalizeDimensionModel([createDiagonalDimension({ id: "d", fromNodeId: "a", toNodeId: "c" })]); expect(normalizeDimensionModel(a.dimensions).changed).toBe(false); });
  it("28 input is not mutated", () => { const d = createWallDimension({ id: "m", wallId: "w1" }); const before = JSON.stringify(d); remapDimensionAfterWallSplit([d], { oldWallId: "w1", secondWallId: "w1b" }); expect(JSON.stringify(d)).toBe(before); });
  it("29 reordered plan entities preserve semantic result", () => { const p = plan(), q = { ...p, nodes: Object.fromEntries(Object.entries(p.nodes).reverse()), walls: [...p.walls].reverse() }; const d = createDiagonalDimension({ id: "d", fromNodeId: "a", toNodeId: "c" }); expect(resolveDimensionAnchors(q, d).dimensions[0].value).toBe(resolveDimensionAnchors(p, d).dimensions[0].value); });
  it("30 large plan stays within budget", () => { const ds = Array.from({ length: 5000 }, (_, i) => auto(String(i), [{ type: "node", nodeId: "a" }, { type: "node", nodeId: `n${i}` }])); const t = performance.now(); expect(dedupeAutoDimensions(ds).dimensions).toHaveLength(5000); expect(performance.now() - t).toBeLessThan(1000); });
  it("31 door/window dimensions are unaffected", () => { const d = { id: "door-d", anchors: [{ type: "item", itemId: "door" }] }; expect(remapDimensionAfterWallSplit([d], { oldWallId: "w1", secondWallId: "w1b" }).changed).toBe(false); });
  it("32 corrupt anchors warn rather than crash", () => { expect(() => normalizeDimensionModel([{ id: "bad", anchors: [{ type: "node" }] }])).not.toThrow(); expect(normalizeDimensionModel([{ id: "bad", anchors: [{ type: "node" }] }]).warnings[0].code).toBe("DIMENSION_ANCHOR_INVALID"); });
  it("33 merge remaps node anchors and dedupes auto", () => {
    const anchors = [{ type: "node", nodeId: "a" }, { type: "node", nodeId: "drop" }];
    const r = remapDimensionsAfterNodeMerge([
      createDiagonalDimension({ id: "m", fromNodeId: "a", toNodeId: "drop" }),
      auto("a1", anchors),
      auto("a2", [{ type: "node", nodeId: "a" }, { type: "node", nodeId: "drop" }]),
    ], { keepId: "keep", dropId: "drop" });
    expect(r.dimensions.find((d) => d.id === "m").anchors.map((a) => a.nodeId)).toEqual(["a", "keep"]);
    expect(r.dimensions.filter((d) => d.auto).map((d) => d.id)).toEqual(["a1"]);
  });
});
