import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("PlannerViewportControls", () => {
  const source = fs.readFileSync(new URL("../src/planner/ui/PlannerViewportControls.jsx", import.meta.url), "utf8");
  it("is props-driven and exposes compact zoom, fit and reset callbacks", () => {
    expect(source).toContain("onZoomOut"); expect(source).toContain("onZoomIn");
    expect(source).toContain("onFit"); expect(source).toContain("onReset");
    expect(source).not.toContain("useState");
  });
  it("has keyboard-native buttons, labels, tooltips and percentage output", () => {
    expect(source.match(/type="button"/g)).toHaveLength(4);
    expect(source.match(/aria-label=/g).length).toBeGreaterThanOrEqual(6);
    expect(source.match(/title=/g)).toHaveLength(4);
    expect(source).toContain("Math.round(zoom * 100)");
  });
});
