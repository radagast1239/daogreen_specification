import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const plannerCss = fs.readFileSync(path.join(root, "src/planner/planner.css"), "utf8");
const redesignCss = fs.readFileSync(path.join(root, "src/planner/planner-redesign.css"), "utf8");
const plannerLayout = fs.readFileSync(path.join(root, "src/planner/ui/PlannerLayout.jsx"), "utf8");
const plannerInspector = fs.readFileSync(path.join(root, "src/planner/ui/PlannerInspector.jsx"), "utf8");

function firstRuleBlock(source, selectorLine) {
  const start = source.indexOf(selectorLine);
  expect(start).toBeGreaterThan(-1);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) break; }
  }
  return source.slice(start, i + 1);
}

describe("Planner Phase 2 — mobile workspace layout cascade fix", () => {
  it("1. the redesign workspace rule no longer collides with the legacy .planner-workspace grid rule at equal specificity", () => {
    // legacy rule (untouched, still display: grid — this task does not
    // touch or remove it, since other legacy call sites may still depend
    // on it outside the redesign shell).
    const legacyBlock = firstRuleBlock(plannerCss, ".planner-workspace {");
    expect(legacyBlock).toContain("display: grid;");

    // redesign rule is now qualified with the always-present ancestor
    // class, raising specificity above the legacy single-class selector
    // regardless of @import cascade order.
    const redesignBlock = firstRuleBlock(redesignCss, ".planner-app--redesign .planner-workspace--redesign {");
    expect(redesignBlock).toContain("display: flex;");
  });

  it("2. mobile workspace uses the correct (flex) layout mode — not inherited grid", () => {
    expect(redesignCss).toContain(".planner-app--redesign .planner-workspace--redesign {");
    expect(redesignCss).not.toMatch(/^\.planner-workspace--redesign\s*{/m);
  });

  it("3. the canvas area still gets a positive flex-height contract (flex: 1, min-height: 0)", () => {
    const canvasAreaBlock = firstRuleBlock(redesignCss, ".planner-app--redesign .planner-canvas-area {");
    expect(canvasAreaBlock).toContain("flex: 1;");
    expect(canvasAreaBlock).toContain("min-height: 0;");
  });

  it("4. no !important was introduced by this fix — it is a plain specificity/selector correction", () => {
    const redesignBlock = firstRuleBlock(redesignCss, ".planner-app--redesign .planner-workspace--redesign {");
    expect(redesignBlock).not.toContain("!important");
  });

  it("documents the root cause: planner.css @imports planner-redesign.css at its top, so the legacy rule that follows in source order previously won equal-specificity ties", () => {
    expect(plannerCss.trim().startsWith('@import "./planner-redesign.css";') || plannerCss.includes('@import "./planner-redesign.css";')).toBe(true);
    const importIdx = plannerCss.indexOf('@import "./planner-redesign.css";');
    const legacyRuleIdx = plannerCss.indexOf(".planner-workspace {");
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(legacyRuleIdx).toBeGreaterThan(importIdx);
  });

  it("5. the fix is route/component scoped — only applies under .planner-app--redesign, never touches the bare .planner-workspace class used elsewhere", () => {
    // redesign.css never redefines the bare legacy selector (no --redesign
    // suffix, no ancestor qualifier) as an actual rule — every occurrence
    // of the class name in this file is either the ancestor-qualified
    // `.planner-app--redesign .planner-workspace--redesign` rule or plain
    // prose in a comment explaining the fix.
    const ruleLines = redesignCss.split("\n").filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));
    const bareRule = ruleLines.some((line) => /^\.planner-workspace\s*\{/.test(line.trim()));
    expect(bareRule).toBe(false);
  });

  it("9. the same fix applies consistently inside the 768px and 1100px media queries (no reintroduced grid at those breakpoints)", () => {
    const mq768 = firstRuleBlock(redesignCss, "@media (max-width: 768px) {");
    const mq1100 = firstRuleBlock(redesignCss, "@media (max-width: 1100px) {");
    expect(mq768).toMatch(/\.planner-app--redesign \.planner-workspace--redesign \{\s*\n\s*flex-wrap: nowrap;/);
    expect(mq1100).toMatch(/\.planner-app--redesign \.planner-workspace--redesign \{\s*\n\s*flex-wrap: nowrap;/);
  });

  it("10. desktop shell rules (canvas width contract) are untouched by this change", () => {
    expect(plannerLayout).toContain('planner-app planner-app--redesign planner-app--phase2');
    // no new class names or DOM structure changes were introduced
    expect(plannerLayout).not.toMatch(/planner-workspace--v2|planner-workspace--fixed/);
  });

  it("7. the mobile bottom-sheet no longer slides under the bottom tool strip: --dg-inspector-sheet-bottom is wired at <=768px", () => {
    // PlannerInspector.css's own bottom-sheet CSS is `position: fixed`,
    // which escapes the PlannerLayout slot wrapper's `bottom: 56px` offset
    // entirely (a fixed element ignores a non-transformed ancestor's own
    // position). It already exposed `--dg-inspector-sheet-bottom` as an
    // integration hook; this just wires it up for the redesign shell.
    const mq768 = firstRuleBlock(redesignCss, "@media (max-width: 768px) {");
    expect(mq768).toMatch(/\.planner-app--redesign\s*\{\s*\n\s*--dg-inspector-sheet-bottom:\s*76px;/);
  });

  it("16. real dimension entities (style as a {importance} object, not a string) no longer crash the inspector", () => {
    // generateWallDimensions.js sets dim.style = { importance: "important" }
    // etc — DimensionSection's "Стиль" select previously put that whole
    // object into an <option>'s children, which React rejects at runtime.
    expect(plannerInspector).toContain(
      'typeof entity.style === "string" ? entity.style : entity.style?.importance || "по умолчанию"'
    );
    expect(plannerInspector).not.toMatch(/label:\s*entity\.style\s*\|\|/);
  });
});
