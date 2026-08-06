import { describe, expect, it } from "vitest";
import { inspectorSelectionTransition } from "../src/planner/ui/PlannerInspector.jsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const inspSrc = fs.readFileSync(path.join(root, "src/planner/ui/PlannerInspector.jsx"), "utf8");
const inspCss = fs.readFileSync(path.join(root, "src/planner/ui/PlannerInspector.css"), "utf8");
const railSrc = fs.readFileSync(path.join(root, "src/planner/ui/PlannerToolRail.jsx"), "utf8");
const railCss = fs.readFileSync(path.join(root, "src/planner/ui/PlannerToolRail.css"), "utf8");

describe("Planner mobile workspace — Phase 2 inspector sheet + tool popover UX", () => {
  it("1. default mobile state is closed/peek — never auto-expanded without a selection", () => {
    expect(inspSrc).toContain('useState(() => (selection ? "half" : "peek"))');
    expect(inspSrc).not.toMatch(/useState\(\s*["']expanded["']\s*\)/);
  });

  // PHASE 2D moved this decision out of the effect and into the exported
  // inspectorSelectionTransition, so both panels share one rule. The contract
  // below is unchanged for every entity that opts in — which is all of them
  // except walls, where selecting and opening the editor became separate
  // intents. Asserted behaviourally now instead of by matching source text.
  it("2. selecting an entity opens the sheet to half", () => {
    expect(inspectorSelectionTransition({ had: false, has: true, autoOpenOnSelect: true })).toBe("reveal");
    expect(inspSrc).toMatch(/else if \(move === "reveal"\) commitPhase\("half"\);/);
  });

  it("3. clearing the selection returns the sheet to peek", () => {
    expect(inspectorSelectionTransition({ had: true, has: false, autoOpenOnSelect: true })).toBe("collapse");
    expect(inspectorSelectionTransition({ had: true, has: false, autoOpenOnSelect: false })).toBe("collapse");
    expect(inspSrc).toMatch(/if \(move === "collapse"\) commitPhase\("peek"\);/);
  });

  it("4. exposes explicit expand/collapse controls, distinct from the peek<->half toggle", () => {
    expect(inspSrc).toContain("function toggleCompact()");
    expect(inspSrc).toContain("function expandFull()");
    expect(inspSrc).toContain("function collapseFromExpanded()");
    expect(inspSrc).toContain('commitPhase("expanded")');
  });

  it("5. defines the four required max-heights (peek 48-64px band, half <=45vh, expanded <=75vh, closed 0)", () => {
    expect(inspCss).toMatch(/\.dg-inspector--peek\s*{\s*max-height:\s*56px;/);
    expect(inspCss).toMatch(/\.dg-inspector--half\s*{\s*max-height:\s*45vh;/);
    expect(inspCss).toMatch(/\.dg-inspector--expanded\s*{\s*max-height:\s*75vh;/);
    expect(inspCss).toMatch(/\.dg-inspector--closed\s*{\s*max-height:\s*0px;/);
  });

  it("6. keeps its own internal scroll region so the background page never scrolls", () => {
    expect(inspCss).toMatch(/\.dg-inspector__body\s*{[^}]*overflow-y:\s*auto;/);
    expect(inspCss).toContain("touch-action: none;");
  });

  it("7. tool rail becomes a horizontal, independently-scrollable strip on mobile", () => {
    expect(railCss).toMatch(/@media \(max-width: 720px\)/);
    expect(railCss).toMatch(/flex-direction:\s*row;/);
    expect(railCss).toMatch(/overflow-x:\s*auto;/);
  });

  it("8. active tool is kept visible, gated by the ensureActiveVisible prop", () => {
    expect(railSrc).toContain("ensureActiveVisible = true");
    expect(railSrc).toContain("if (!ensureActiveVisible) return;");
    expect(railSrc).toContain("el.scrollIntoView({ block: \"nearest\", inline: \"nearest\" });");
  });

  it("9. tool group popover closes automatically after a subtool is chosen, gated by autoCloseGroup", () => {
    expect(railSrc).toContain("autoCloseGroup = true");
    expect(railSrc).toContain("if (autoCloseGroup) closeGroup();");
  });

  it("10. Escape always closes an open popover and notifies the caller", () => {
    expect(railSrc).toContain('e.key === "Escape"');
    expect(railSrc).toContain("closeGroup();");
    expect(railSrc).toContain("onEscape?.();");
  });

  it("11. clicking outside the popover (and outside its trigger) closes it", () => {
    expect(railSrc).toContain('document.addEventListener("pointerdown", handlePointerDown, true);');
    expect(railSrc).toContain("if (popoverEl && popoverEl.contains(e.target)) return;");
    expect(railSrc).toContain("if (triggerEl && triggerEl.contains(e.target)) return;");
    expect(railSrc).toContain("closeGroup(false);");
  });

  it("12. focus returns to the trigger button once its popover closes", () => {
    expect(railSrc).toContain("function closeGroup(restoreFocus = true)");
    expect(railSrc).toContain("const idToRestore = openGroupId;");
    expect(railSrc).toContain("if (restoreFocus && idToRestore) {");
    expect(railSrc).toMatch(/requestAnimationFrame\(\(\) => el\.focus\(\)\)/);
  });

  it("13. 390px viewport: no fixed pixel widths that would force document overflow", () => {
    expect(inspCss).toMatch(/width:\s*100%;\s*\n\s*max-width:\s*none;/);
    expect(railCss).toMatch(/width:\s*100%;\s*\n\s*max-width:\s*none;/);
  });

  it("14. 430px viewport: the same fluid rules apply — no viewport-specific hardcoding between 390 and 430", () => {
    expect(inspCss).not.toMatch(/@media \(max-width: 430px\)/);
    expect(railCss).not.toMatch(/@media \(max-width: 430px\)/);
    expect(inspCss).toMatch(/@media \(max-width: 900px\)/);
    expect(railCss).toMatch(/@media \(max-width: 720px\)/);
  });

  it("15. tablet contract is prop-driven, not a hardcoded page breakpoint", () => {
    expect(inspSrc).toContain('presentationMode = "auto"');
    expect(inspCss).toMatch(/\.dg-inspector--docked\s*{\s*width:\s*280px;/);
    expect(railSrc).toContain('orientation = "auto"');
    expect(railSrc).toContain("VALID_ORIENTATIONS.has(orientation)");
    expect(railCss).toContain(".dg-tool-rail.dg-tool-rail--vertical");
    expect(railCss).toContain(".dg-tool-rail.dg-tool-rail--horizontal");
  });

  it("16. corrupt/invalid props fall back to safe defaults instead of crashing", () => {
    expect(inspSrc).toContain("const safeMode = PRESENTATION_MODES.has(presentationMode) ? presentationMode : \"auto\";");
    expect(inspSrc).toContain("const isPhaseControlled = isValidPhase(sheetState);");
    expect(railSrc).toContain('const safeOrientation = VALID_ORIENTATIONS.has(orientation) ? orientation : "auto";');
    expect(railSrc).toContain("const safeTools = Array.isArray(tools) ? tools : DEFAULT_TOOL_RAIL;");
    expect(railSrc).toContain("Array.isArray(disabledToolIds) ? disabledToolIds : []");
  });

  it("component API stays additive: existing required props are untouched", () => {
    for (const prop of ["selection", "entity", "warnings", "context", "onChange", "onCommand", "onClearSelection", "onFitPlan"]) {
      expect(inspSrc).toContain(prop);
    }
    for (const prop of ["activeToolId", "tools", "disabledToolIds", "onToolSelect", "onEscape", "onOpenGroup"]) {
      expect(railSrc).toContain(prop);
    }
  });

  it("neither component imports store/actions/state managers", () => {
    for (const src of [inspSrc, railSrc]) {
      expect(src).not.toMatch(/from ["'].*\/store/);
      expect(src).not.toMatch(/from ["'].*plannerActions/);
      expect(src).not.toMatch(/usePlannerState|useSelector|useDispatch/);
    }
  });

  it("sheet state can be controlled from outside via sheetState + onSheetStateChange", () => {
    expect(inspSrc).toContain("sheetState");
    expect(inspSrc).toContain("onSheetStateChange");
    expect(inspSrc).toContain("isPhaseControlled ? sheetState : phase");
  });

  it("mobile tool strip reserves a safe-area inset at the bottom", () => {
    expect(railCss).toContain("env(safe-area-inset-bottom, 0px)");
  });

  it("inspector sheet position respects an integrator-supplied bottom offset (to avoid covering the tool strip)", () => {
    expect(inspCss).toContain("var(--dg-inspector-sheet-bottom, 0px)");
  });
});
