import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src/planner/ui/PlannerInspector.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/planner/ui/PlannerInspector.css"), "utf8");

describe("PlannerInspector contracts", () => {
  it("is a pure props-driven component with no store/actions/plan mutation", () => {
    expect(src).toMatch(/export function PlannerInspector\(/);
    expect(src).not.toMatch(/from ["'].*\/store/);
    expect(src).not.toMatch(/from ["'].*plannerActions/);
    expect(src).not.toMatch(/plan\.\w+\s*=/);
    expect(src).not.toMatch(/usePlannerState|useSelector|useDispatch/);
  });

  it("exposes the documented props contract", () => {
    for (const prop of [
      "selection",
      "entity",
      "warnings",
      "context",
      "onChange",
      "onCommand",
      "onClearSelection",
      "onFitPlan",
    ]) {
      expect(src).toContain(prop);
    }
  });

  it("11. empty state shows helper text, layer/level/scale and a fit-plan callback", () => {
    expect(src).toContain("Ничего не выбрано");
    expect(src).toContain("Показать весь план");
    expect(src).toContain("onFitPlan?.()");
    expect(src).toContain("context?.layer");
    expect(src).toContain("context?.level");
    expect(src).toContain("context?.scale");
  });

  it("12. wall section exposes length, thickness, angle, type, split and delete", () => {
    expect(src).toContain("function WallSection(");
    expect(src).toContain('label="Длина"');
    expect(src).toContain('label="Толщина"');
    expect(src).toContain('label="Угол"');
    expect(src).toContain('onCommand?.("split"');
    expect(src).toContain('onCommand?.("delete", { id: entity.id, type: "wall" })');
  });

  it("13. node section exposes X, Y, connected wall count and merge/delete", () => {
    expect(src).toContain("function NodeSection(");
    expect(src).toContain('label="X"');
    expect(src).toContain('label="Y"');
    expect(src).toContain("entity.connectedWallCount");
    expect(src).toContain('onCommand?.("merge"');
    expect(src).toContain('onCommand?.("delete", { id: entity.id, type: "node" })');
  });

  it("14. door/window section exposes width, height, position, orientation and delete", () => {
    expect(src).toContain("function OpeningSection(");
    expect(src).toContain('label="Ширина"');
    expect(src).toContain('label="Высота"');
    expect(src).toContain('label="Положение"');
    expect(src).toContain('label="Ориентация"');
    expect(src).toContain("door: OpeningSection");
    expect(src).toContain("window: OpeningSection");
  });

  it("15. dimension section exposes type, label, offset, style and visibility", () => {
    expect(src).toContain("function DimensionSection(");
    expect(src).toContain('label="Подпись"');
    expect(src).toContain('label="Отступ"');
    expect(src).toContain('label="Стиль"');
    expect(src).toContain('label="Видимый"');
  });

  it("16. invalid dimensions show a warning and are not auto-deleted", () => {
    expect(src).toContain("function WarningBanner(");
    expect(src).toContain("не удаляется автоматически");
    expect(src).toContain("const invalid = entity.invalid");
  });

  it("17. object section exposes name, position, rotation, dimensions and current properties", () => {
    expect(src).toContain("function ObjectSection(");
    expect(src).toContain('label="Название"');
    expect(src).toContain('label="Позиция X"');
    expect(src).toContain('label="Поворот"');
    expect(src).toContain("entity.properties || []).map");
  });

  it("18. room/zone section exposes name, area, type and current parameters", () => {
    expect(src).toContain("function RoomSection(");
    expect(src).toContain('label="Имя"');
    expect(src).toContain('label="Площадь"');
    expect(src).toContain("entity.parameters || []).map");
  });

  it("19. field commits go through onChange with id/type/field/value", () => {
    expect(src).toMatch(/onChange\?\.\(\{ id: entity\.id, type: "wall", field, value \}\)/);
    expect(src).toMatch(/onChange\?\.\(\{ id: entity\.id, type: "node", field, value \}\)/);
  });

  it("20. structural commands go through onCommand, never mutate plan directly", () => {
    const commandCalls = src.match(/onCommand\?\.\(/g) || [];
    expect(commandCalls.length).toBeGreaterThan(5);
  });

  it("21. destructive delete requires an inline confirmation step", () => {
    expect(src).toContain("function DeleteButton(");
    expect(src).toContain("Удалить безвозвратно?");
    expect(src).toContain("setConfirming(true)");
    expect(src).toContain("dg-insp-btn--danger");
  });

  it("22. empty state wires a distinct fit-plan callback", () => {
    expect(src).toContain("function EmptyState({ context, onFitPlan })");
  });

  it("23. header close button clears selection via onClearSelection", () => {
    expect(src).toContain("onClearSelection?.()");
    expect(src).toContain("dg-inspector__close");
  });

  it("24. becomes a phased bottom sheet on mobile/tablet with its own scroll (superseded by Phase 2 — see plannerMobileWorkspace.test.js for the closed/peek/half/expanded contract)", () => {
    expect(css).toMatch(/@media \(max-width: 900px\)/);
    expect(css).toMatch(/position:\s*fixed;/);
    expect(css).toMatch(/max-height:\s*45vh;/);
    expect(css).toContain(".dg-inspector--peek");
    expect(css).toContain(".dg-inspector--half");
    expect(src).toContain('"dg-inspector dg-inspector--" + effectivePhase');
    expect(src).toContain("toggleCompact");
  });

  it("25. unknown or corrupt entities fall back to a safe message, not a crash", () => {
    expect(src).toContain("KNOWN_TYPES.has(type)");
    expect(src).toContain("Не удалось прочитать выбранный элемент");
  });

  it("read-only fields are visually distinguished", () => {
    expect(css).toContain(".dg-insp-field--readonly");
    expect(src).toContain("dg-insp-readonly-value");
  });

  it("desktop width sits within the 320-360px band and never overlaps the canvas", () => {
    expect(css).toMatch(/width:\s*340px;/);
    expect(css).toMatch(/min-width:\s*320px;/);
    expect(css).toMatch(/max-width:\s*360px;/);
    expect(css).not.toMatch(/position:\s*absolute;[^}]*z-index/);
  });
});
