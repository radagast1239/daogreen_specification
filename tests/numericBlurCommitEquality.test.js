import { describe, expect, it } from "vitest";

function normalizeNumberCommit(raw) {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function sameCommittedValue(type, draft, value) {
  if (type === "number") {
    return Object.is(normalizeNumberCommit(draft), normalizeNumberCommit(value));
  }
  return String(draft ?? "") === String(value ?? "");
}

describe("numeric blur commit equality", () => {
  it("treats 10 and '10' as equal for number fields", () => {
    expect(sameCommittedValue("number", "10", 10)).toBe(true);
    expect(sameCommittedValue("number", " 10 ", 10)).toBe(true);
  });

  it("treats empty and null as equal (no commit)", () => {
    expect(sameCommittedValue("number", "", null)).toBe(true);
    expect(sameCommittedValue("number", "", undefined)).toBe(true);
    expect(sameCommittedValue("number", null, null)).toBe(true);
  });

  it("detects real changes including 0 and decimals", () => {
    expect(sameCommittedValue("number", "0", 0)).toBe(true);
    expect(sameCommittedValue("number", "1", 0)).toBe(false);
    expect(sameCommittedValue("number", "12.5", 12.5)).toBe(true);
  });

  it("maps invalid number text to null, not 0", () => {
    expect(normalizeNumberCommit("abc")).toBe(null);
    expect(sameCommittedValue("number", "abc", null)).toBe(true);
    expect(sameCommittedValue("number", "abc", 0)).toBe(false);
  });

  it("text fields compare string identity", () => {
    expect(sameCommittedValue("text", "hi", "hi")).toBe(true);
    expect(sameCommittedValue("text", "hi", "bye")).toBe(false);
  });
});

describe("FarmPower DraftInput number normalize (mirror)", () => {
  function farmNext(draft) {
    return Math.max(0, Number(String(draft).trim()) || 0);
  }
  function farmPrev(value) {
    return Math.max(0, Number(value ?? 0) || 0);
  }

  it("keeps empty→0 behavior and skips no-op blur", () => {
    expect(farmNext("")).toBe(0);
    expect(farmNext("  ")).toBe(0);
    expect(Object.is(farmNext("10"), farmPrev(10))).toBe(true);
    expect(Object.is(farmNext("10"), farmPrev("10"))).toBe(true);
    expect(Object.is(farmNext("11"), farmPrev(10))).toBe(false);
  });
});
