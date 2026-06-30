import { describe, expect, it } from "vitest";
import { pickLineSpecOverrides } from "../shared/lineSpecOverrides.js";

describe("lineSpecOverrides", () => {
  it("keeps draft flow spec rows for + позиция", () => {
    const overrides = pickLineSpecOverrides({
      name: "Насос дренажный погружной",
      flowSpecs: [
        { qty: 1, m3h: 6, link: "https://ozon.ru/a" },
        { qty: "", m3h: "", link: "" },
      ],
    });
    expect(overrides.flowSpecs).toHaveLength(2);
    expect(overrides.flowSpecs[1]).toEqual({ qty: "", m3h: "", link: "" });
    expect(overrides.clientNote).toContain("Насосы");
    expect(overrides.link).toBe("https://ozon.ru/a");
  });
});
