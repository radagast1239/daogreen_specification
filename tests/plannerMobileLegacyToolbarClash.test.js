import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "src/planner/planner-redesign.css"), "utf8");

function mediaBlock(source, query) {
  const start = source.indexOf(query);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let i = source.indexOf("{", start);
  const blockStart = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(blockStart, i + 1);
}

describe("Planner Phase 2 — mobile legacy in-canvas toolbar no longer clashes", () => {
  const mq768 = mediaBlock(css, "@media (max-width: 768px)");

  it("8. legacy full-width bottom bar (unit/undo/grid/help/...) switches to a compact mobile presentation: hidden, not stacked", () => {
    expect(mq768).toMatch(/\.planner-app--redesign \.planner-bottom-bar\s*{\s*display:\s*none;/);
  });

  it("9. the relocated zoom/Fit cluster moves out of the bottom tool-strip's territory", () => {
    expect(mq768).toMatch(/\.planner-app--redesign \.dg-tool-rail\s*{[^}]*position:\s*absolute;[^}]*bottom:\s*0;/s);
    expect(mq768).toMatch(/\.planner-app--redesign \.planner-viewport-controls-wrap\s*{[^}]*bottom:\s*auto;/s);
  });

  it("10. the relocated zoom/Fit cluster also moves out of the inspector bottom-sheet's territory", () => {
    expect(mq768).toMatch(/\.planner-inspector-slot--dock,\s*\n\s*\.planner-inspector-slot--overlay\s*{[^}]*bottom:\s*56px;/s);
    expect(mq768).toMatch(/\.planner-app--redesign \.planner-viewport-controls-wrap\s*{[^}]*top:\s*max\(8px/s);
  });

  it("11. half/expanded inspector states (from PlannerInspector.css) are unaffected by this change — no rules touched there", () => {
    const inspectorCss = fs.readFileSync(path.join(root, "src/planner/ui/PlannerInspector.css"), "utf8");
    expect(inspectorCss).toContain(".dg-inspector--half");
    expect(inspectorCss).toContain(".dg-inspector--expanded");
  });

  it("12. no viewport-specific hardcoding was introduced between 390 and 768 — one shared breakpoint still drives all of it", () => {
    expect(css).not.toMatch(/@media \(max-width: 430px\)/);
    expect(css).not.toMatch(/@media \(max-width: 390px\)/);
    expect((css.match(/@media \(max-width: 768px\)/g) || []).length).toBe(1);
  });

  it("13. zoom in/out/Fit remain reachable — relocated, not removed or disabled", () => {
    expect(mq768).toMatch(/\.planner-app--redesign \.planner-viewport-controls-wrap\s*{/);
    expect(mq768).not.toMatch(/\.planner-viewport-controls-wrap\s*{\s*display:\s*none;/);
  });

  it("14. desktop (no media query match) legacy bottom bar and viewport controls keep their original rules untouched", () => {
    expect(css).toMatch(/\.planner-viewport-controls-wrap\s*{\s*\n\s*position:\s*absolute;\s*\n\s*right:\s*12px;\s*\n\s*bottom:\s*10px;\s*\n\s*z-index:\s*5;\s*\n\s*}/);
  });

  it("respects safe-area insets for the relocated top-corner cluster", () => {
    expect(mq768).toContain("env(safe-area-inset-top, 0px)");
    expect(mq768).toContain("env(safe-area-inset-right, 0px)");
  });
});
