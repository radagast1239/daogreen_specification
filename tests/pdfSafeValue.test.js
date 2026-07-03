import { describe, it, expect } from "vitest";
import {
  finiteNumber,
  safePdfText,
  safePdfNumber,
  safeCoolingKw,
  safeCoolingBtu,
} from "../src/lib/pdfSafeValue.js";

describe("pdfSafeValue", () => {
  it("safePdfText превращает невалидные значения в тире", () => {
    expect(safePdfText(undefined)).toBe("—");
    expect(safePdfText(null)).toBe("—");
    expect(safePdfText(NaN)).toBe("—");
    expect(safePdfText(Infinity)).toBe("—");
    expect(safePdfText(-Infinity)).toBe("—");
  });

  it("safePdfText сохраняет текст и чистит управляющие символы", () => {
    expect(safePdfText("Насос")).toBe("Насос");
    expect(safePdfText("A B")).toBe("A B");
    expect(safePdfText("   ")).toBe("—");
  });

  it("finiteNumber парсит числа и использует fallback", () => {
    expect(finiteNumber("12.5")).toBe(12.5);
    expect(finiteNumber(NaN, 7)).toBe(7);
    expect(finiteNumber(Infinity, 3)).toBe(3);
    expect(finiteNumber(undefined, 0)).toBe(0);
  });

  it("safePdfNumber превращает NaN/Infinity в тире", () => {
    expect(safePdfNumber(NaN)).toBe("—");
    expect(safePdfNumber(Infinity)).toBe("—");
    expect(safePdfNumber(-Infinity)).toBe("—");
    expect(safePdfNumber(42)).toBe("42");
  });

  it("safeCoolingKw не даёт отрицательное значение", () => {
    expect(safeCoolingKw(-5)).toBe(0);
    expect(safeCoolingKw(-5)).toBeGreaterThanOrEqual(0);
    expect(safeCoolingKw(NaN)).toBe(0);
    expect(safeCoolingKw(3.2)).toBe(3.2);
  });

  it("safeCoolingBtu не даёт отрицательное значение", () => {
    expect(safeCoolingBtu(-12000)).toBe(0);
    expect(safeCoolingBtu(-12000)).toBeGreaterThanOrEqual(0);
    expect(safeCoolingBtu(NaN)).toBe(0);
    expect(safeCoolingBtu(12000)).toBe(12000);
  });
});
