import { describe, expect, it } from "vitest";
import {
  resolveBuilderLineQty,
  sumFlowSpecQty,
  isPumpName,
} from "../shared/flowSpecs.js";

describe("flowSpecs builder qty", () => {
  it("detects pump names", () => {
    expect(isPumpName("Насос дренажный погружной")).toBe(true);
  });

  it("sums qty from flow spec rows", () => {
    expect(
      sumFlowSpecQty([
        { qty: 1, m3h: 6, link: "" },
        { qty: 2, m3h: 3, link: "" },
      ])
    ).toBe(3);
  });

  it("uses qty column when set", () => {
    expect(
      resolveBuilderLineQty({
        name: "Насос дренажный погружной",
        qty: 4,
        flowSpecs: [{ qty: 1, m3h: 6, link: "" }],
      })
    ).toBe(4);
  });

  it("falls back to flowSpecs when qty column is zero", () => {
    expect(
      resolveBuilderLineQty({
        name: "Насос дренажный погружной",
        qty: 0,
        flowSpecs: [{ qty: 1, m3h: 0, link: "https://ozon.ru/t/x" }],
      })
    ).toBe(1);
  });
});
