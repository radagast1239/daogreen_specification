/**
 * PHASE 1B-1B — parseWallLengthInput (leaf UI parser, no React/DOM/geometry-core).
 */
import { describe, it, expect } from "vitest";
import {
  parseWallLengthInput,
  formatWallLengthMm,
  WALL_LENGTH_INPUT_EMPTY,
  WALL_LENGTH_INPUT_NOT_A_NUMBER,
  WALL_LENGTH_INPUT_NOT_POSITIVE,
  WALL_LENGTH_INPUT_TOO_SHORT,
} from "../src/planner/ui/parseWallLengthInput.js";

describe("PHASE 1B-1B — parseWallLengthInput: accepted formats", () => {
  it("plain integer", () => {
    expect(parseWallLengthInput("3000")).toEqual({ ok: true, lengthMm: 3000 });
  });

  it("dot decimal", () => {
    expect(parseWallLengthInput("3000.5")).toEqual({ ok: true, lengthMm: 3000.5 });
  });

  it("comma decimal", () => {
    expect(parseWallLengthInput("3000,5")).toEqual({ ok: true, lengthMm: 3000.5 });
  });

  it("leading/trailing whitespace", () => {
    expect(parseWallLengthInput(" 3000 ")).toEqual({ ok: true, lengthMm: 3000 });
  });

  it("does not lose the fractional part (no parseInt truncation)", () => {
    const result = parseWallLengthInput("1234.75");
    expect(result.ok).toBe(true);
    expect(result.lengthMm).toBe(1234.75);
  });

  it("exactly the 50mm minimum is accepted", () => {
    expect(parseWallLengthInput("50")).toEqual({ ok: true, lengthMm: 50 });
  });
});

describe("PHASE 1B-1B — parseWallLengthInput: rejected inputs", () => {
  it("empty string", () => {
    expect(parseWallLengthInput("").code).toBe(WALL_LENGTH_INPUT_EMPTY);
  });

  it("only spaces", () => {
    expect(parseWallLengthInput("   ").code).toBe(WALL_LENGTH_INPUT_EMPTY);
  });

  it("non-numeric text", () => {
    expect(parseWallLengthInput("abc").code).toBe(WALL_LENGTH_INPUT_NOT_A_NUMBER);
  });

  it("mixed garbage (number + letters)", () => {
    expect(parseWallLengthInput("12abc").code).toBe(WALL_LENGTH_INPUT_NOT_A_NUMBER);
  });

  it("space-separated thousands (existing UI does not support this format)", () => {
    expect(parseWallLengthInput("3 000").code).toBe(WALL_LENGTH_INPUT_NOT_A_NUMBER);
  });

  it("scientific notation is not supported", () => {
    expect(parseWallLengthInput("3e3").code).toBe(WALL_LENGTH_INPUT_NOT_A_NUMBER);
  });

  it("literal NaN text", () => {
    expect(parseWallLengthInput("NaN").code).toBe(WALL_LENGTH_INPUT_NOT_A_NUMBER);
  });

  it("literal Infinity text", () => {
    expect(parseWallLengthInput("Infinity").code).toBe(WALL_LENGTH_INPUT_NOT_A_NUMBER);
  });

  it("zero", () => {
    expect(parseWallLengthInput("0").code).toBe(WALL_LENGTH_INPUT_NOT_POSITIVE);
  });

  it("negative", () => {
    expect(parseWallLengthInput("-100").code).toBe(WALL_LENGTH_INPUT_NOT_POSITIVE);
  });

  it("below the 50mm minimum", () => {
    expect(parseWallLengthInput("49.999").code).toBe(WALL_LENGTH_INPUT_TOO_SHORT);
  });

  it("non-string input", () => {
    expect(parseWallLengthInput(undefined).code).toBe(WALL_LENGTH_INPUT_EMPTY);
    expect(parseWallLengthInput(null).code).toBe(WALL_LENGTH_INPUT_EMPTY);
  });

  it("every rejection carries a human-readable message", () => {
    for (const raw of ["", "abc", "0", "-5", "10"]) {
      const result = parseWallLengthInput(raw);
      expect(result.ok).toBe(false);
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

describe("PHASE 1B-1B — formatWallLengthMm", () => {
  it("formats a whole number without trailing decimals", () => {
    expect(formatWallLengthMm(3000)).toBe("3000");
  });

  it("formats a fractional value rounded to one decimal", () => {
    expect(formatWallLengthMm(3000.55)).toBe("3000.6");
  });

  it("round-trips through parseWallLengthInput", () => {
    const formatted = formatWallLengthMm(4123.4);
    const parsed = parseWallLengthInput(formatted);
    expect(parsed).toEqual({ ok: true, lengthMm: 4123.4 });
  });

  it("returns an empty string for non-finite input", () => {
    expect(formatWallLengthMm(NaN)).toBe("");
    expect(formatWallLengthMm(Infinity)).toBe("");
  });
});
