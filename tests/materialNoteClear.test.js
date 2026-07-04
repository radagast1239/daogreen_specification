import { describe, it, expect } from "vitest";
import { resolveMaterialNoteField } from "../shared/materialNoteFields.js";
import { structuredClientNote } from "../shared/structuredClientNote.js";

describe("material note clear — save payload helpers", () => {
  it("resolveMaterialNoteField saves empty string for techNote", () => {
    expect(resolveMaterialNoteField({ techNote: "" }, "techNote")).toBe("");
  });

  it("resolveMaterialNoteField saves empty string for internalNote", () => {
    expect(resolveMaterialNoteField({ internalNote: "" }, "internalNote")).toBe("");
  });

  it("resolveMaterialNoteField returns undefined when field is absent", () => {
    expect(resolveMaterialNoteField({ techNote: "old" }, "internalNote")).toBeUndefined();
  });

  it("simulates PATCH merge: cleared client_note does not fall back to comment", () => {
    const cur = {
      name: "Насос",
      clientNote: "старый комментарий",
      comment: "старый комментарий",
      techNote: "старая техзаметка",
      internalNote: "старая внутренняя",
    };
    const patch = { clientNote: "", techNote: "", internalNote: "" };
    const merged = { ...cur, ...patch };

    expect(structuredClientNote(merged)).toBe("");
    expect(resolveMaterialNoteField(merged, "techNote")).toBe("");
    expect(resolveMaterialNoteField(merged, "internalNote")).toBe("");
  });
});
