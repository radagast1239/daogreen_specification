import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvasPrimitives = fs.readFileSync(path.join(root, "src/planner/canvasPrimitives.jsx"), "utf8");
const wallEditOverlay = fs.readFileSync(path.join(root, "src/planner/wallEditOverlay.jsx"), "utf8");
const planPage = fs.readFileSync(path.join(root, "src/pages/admin/PlanPage.jsx"), "utf8");
const plannerLayout = fs.readFileSync(path.join(root, "src/planner/ui/PlannerLayout.jsx"), "utf8");

describe("Planner Phase 2 — real selection scenario stays wired end-to-end", () => {
  it("1. select tool → click wall body: select is the default tool and wall clicks are gated by it", () => {
    expect(planPage).toContain('useState("select")');
    expect(planPage).toMatch(/tool === "select" && e\.button === 0/);
    expect(planPage).toContain("pickWallBodyHit(mm, resolvePlanWalls(plan), plan.room)");
    expect(planPage).toMatch(/if \(wallHit\) \{\s*selectWall\(e, wallHit\.wall\);/);
  });

  it("2. selecting a wall opens the wall inspector via the real, live-computed inspector model", () => {
    expect(planPage).toContain("selection: inspectorModel.selection");
    expect(planPage).toContain("entity: inspectorModel.entity");
    expect(planPage).toContain("onClearSelection: clearSelection");
  });

  it("3. compact handles render: endpoint/midpoint circles use a small constant-radius visual layer", () => {
    expect(canvasPrimitives).toMatch(/r=\{\(hoverNodeIdx === i \? 6 : 5\) \* k\}/);
    expect(canvasPrimitives).toMatch(/r=\{\(hoverNodeIdx === -1 \? 6 : 5\) \* k\}/);
  });

  it("4. handles are zoom-invariant: visual radius is expressed as N * k, and k = 1 / zoom, so on-screen size stays constant", () => {
    expect(planPage).toContain("const k = 1 / z;");
    // Visual handle radii (5 or 6) * k => constant screen px regardless of z.
    expect(canvasPrimitives).toMatch(/r=\{11 \* k\}/);
    // separate, larger hit target — also constant screen px via the same k.
    const hitCircles = canvasPrimitives.match(/r=\{11 \* k\}/g) || [];
    expect(hitCircles.length).toBeGreaterThanOrEqual(2);
  });

  it("5. handles stay compact so they do not grow into nearby dimension labels: visual layer is pointer-events: none, only the invisible layer is hit-testable", () => {
    expect(canvasPrimitives).toMatch(/fill="transparent"\s*\n\s*stroke="none"\s*\n\s*onPointerDown=\{\(e\) => onMidNode\?\.\(e, wall\)\}/);
    expect(canvasPrimitives).toMatch(/pointerEvents="none"\s*\n\s*style=\{\{ cursor: "move" \}\}\s*\n\s*\/>\s*\n\s*<\/>/);
    expect(canvasPrimitives).toMatch(/pointerEvents="none"\s*\n\s*style=\{\{ cursor: "move" \}\}\s*\n\s*\/>\s*\n\s*<\/g>/);
  });

  it("endpoint/move handles (teal) stay visually distinct from the offset/nudge pad (rust orange) — no color change made", () => {
    expect(canvasPrimitives).toContain('stroke={hoverNodeIdx === i ? "#116355" : outerColor}');
    expect(wallEditOverlay).toContain('stroke="#c44a2f"');
  });

  it("6. clicking empty canvas clears selection (bgClick contract untouched)", () => {
    expect(planPage).toContain('const bgClick = e.target === svgRef.current || e.target.getAttribute("data-canvas-bg") === "1";');
    expect(planPage).toContain("const clearSelection = () => setSelection(null);");
  });

  it("7. selection is pure UI state — no PATCH/save call lives in the click-to-select path", () => {
    const selectWallMatch = planPage.match(/const selectWall = [\s\S]{0,400}/);
    expect(selectWallMatch).toBeTruthy();
    expect(selectWallMatch[0]).not.toMatch(/api\.(patch|post|put)|fetch\(|autosave/i);
  });

  it("does not touch wallCommands, geometry, room sync, autosave, plan schema, or dimension anchors", () => {
    // Presentation-only: no new imports of forbidden modules were added to the touched files.
    expect(canvasPrimitives).not.toMatch(/wallCommands|autosaveGuard|planAutosaveBridge/);
    expect(wallEditOverlay).not.toMatch(/wallCommands|autosaveGuard|planAutosaveBridge/);
    expect(plannerLayout).not.toMatch(/wallCommands|autosaveGuard|planAutosaveBridge/);
  });

  it("selecting an object on mobile/narrow reveals a closed/collapsed inspector (real gap found in browser preview, fixed here)", () => {
    expect(plannerLayout).toContain("const hadSelectionRef = useRef(!!inspectorProps?.selection);");
    // PHASE 2D: the "should this reveal the panel?" decision is shared with
    // PlannerInspector via inspectorSelectionTransition; the reveal itself is
    // still this effect's job and still only fires on a real transition.
    expect(plannerLayout).toMatch(/inspectorSelectionTransition\(\{/);
    expect(plannerLayout).toMatch(/if \(move === "reveal"\) setInspectorOpen\(true\);/);
    // It only ever opens on a no-selection -> selection transition; it never
    // forces the panel closed, so "session-only" and "clear -> peek" stay
    // owned entirely by PlannerInspector's own sheet-phase state.
    expect(plannerLayout).not.toMatch(/if \(!has\) setInspectorOpen\(false\)/);
  });
});
