import { describe, it, expect } from "vitest";
import { structuredClientNote } from "../shared/structuredClientNote.js";

const split = {
  name: "Сплит-система / кондиционер",
  splitSpecs: [{ qty: 1, coolingKw: 2.5 }],
};

describe("structuredClientNote — split systems", () => {
  it("keeps the provided cooling spec note instead of overriding it", () => {
    const note = "Комната Манипуляционная · холод 3,11 кВт · 12 000 BTU · потребление ~0,97 кВт";
    expect(structuredClientNote({ ...split, clientNote: note })).toBe(note);
  });

  it("falls back to the auto split note when no note is provided", () => {
    const auto = structuredClientNote(split);
    expect(auto).toBeTruthy();
    expect(auto).toMatch(/сплит/i);
  });

  it("does not affect non-split items", () => {
    expect(structuredClientNote({ name: "Насос", clientNote: "просто комментарий" })).toBe(
      "просто комментарий"
    );
  });
});
