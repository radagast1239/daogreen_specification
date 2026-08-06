import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src/planner/ui/PlannerToolRail.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/planner/ui/PlannerToolRail.css"), "utf8");

describe("PlannerToolRail contracts", () => {
  it("is a pure props-driven component with no store/actions imports", () => {
    expect(src).toMatch(/export function PlannerToolRail\(/);
    expect(src).not.toMatch(/from ["'].*\/store/);
    expect(src).not.toMatch(/from ["'].*plannerActions/);
    expect(src).not.toMatch(/usePlannerState|useSelector|useDispatch/);
  });

  it("exposes the documented props contract", () => {
    for (const prop of [
      "activeToolId",
      "tools",
      "disabledToolIds",
      "onToolSelect",
      "onEscape",
      "onOpenGroup",
    ]) {
      expect(src).toContain(prop);
    }
  });

  it("1. reflects the active tool on the matching button", () => {
    expect(src).toContain("dg-tool-btn--active");
    expect(src).toContain("function isActive(tool)");
    expect(src).toContain("tool.id === activeToolId");
  });

  it("2. calls onToolSelect with tool id and tool object on click", () => {
    expect(src).toContain("onToolSelect?.(tool.id, tool)");
    expect(src).toContain("onToolSelect?.(child.id, child)");
  });

  it("3. renders a disabled state and never fires selection for disabled tools", () => {
    expect(src).toContain("dg-tool-btn--disabled");
    expect(src).toContain("if (disabledSet.has(tool.id)) return;");
    expect(src).toContain("aria-disabled={disabled}");
  });

  it("4. opens a group popover next to the rail via onOpenGroup", () => {
    expect(src).toContain("dg-tool-popover");
    expect(src).toContain("onOpenGroup?.(next ? tool : null)");
    expect(src).toContain('role="menu"');
  });

  it("5. supports linear/diagonal/angular dimension subtools", () => {
    expect(src).toContain("measure_linear");
    expect(src).toContain("Линейный");
    expect(src).toContain("measure_diagonal");
    expect(src).toContain("Диагональный");
    expect(src).toContain("measure_angular");
    expect(src).toContain("Угловой");
  });

  it("6. Escape closes an open group and always calls onEscape", () => {
    expect(src).toContain('e.key === "Escape"');
    expect(src).toContain("closeGroup();");
    expect(src).toContain("onEscape?.();");
  });

  it("7. supports roving keyboard navigation across tools", () => {
    expect(src).toContain('e.key === "ArrowDown"');
    expect(src).toContain('e.key === "ArrowUp"');
    expect(src).toContain("btnRefs.current.get(next)?.focus()");
  });

  it("8. provides tooltips and aria-labels for every tool button", () => {
    expect(src).toContain("title={tool.tooltip || tool.label}");
    expect(src).toContain("aria-label={tool.label}");
    expect(src).toContain("aria-label={child.label}");
  });

  it("9. switches to a horizontal, scrollable strip on narrow viewports", () => {
    expect(css).toMatch(/@media \(max-width: 720px\)/);
    expect(css).toMatch(/flex-direction:\s*row;/);
    expect(css).toMatch(/overflow-x:\s*auto;/);
  });

  it("10. never sets overflow on the document, only on the rail itself", () => {
    expect(css).not.toMatch(/\bhtml\s*{[^}]*overflow/);
    expect(css).not.toMatch(/\bbody\s*{[^}]*overflow/);
    expect(css).toContain(".dg-tool-rail {");
  });

  it("does not select a tool internally without an explicit callback result", () => {
    expect(src).not.toMatch(/setActiveToolId|this\.activeTool\s*=/);
  });

  it("keeps a single active tool: children and top-level share one activeToolId prop", () => {
    const matches = src.match(/activeToolId/g) || [];
    expect(matches.length).toBeGreaterThan(1);
    expect(src).not.toContain("activeToolIds");
  });
});
