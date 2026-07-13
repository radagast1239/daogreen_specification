import { describe, expect, it } from "vitest";
import {
  itemHasAdminComments,
  itemHasClientNote,
  itemHasInternalNote,
} from "../src/lib/specItemComments.js";

describe("specItemComments", () => {
  it("detects non-empty clientNote and internalNote independently", () => {
    expect(itemHasClientNote({ clientNote: "  hi " })).toBe(true);
    expect(itemHasClientNote({ clientNote: "   " })).toBe(false);
    expect(itemHasInternalNote({ internalNote: "sec" })).toBe(true);
    expect(itemHasInternalNote({ internalNote: "" })).toBe(false);
  });

  it("itemHasAdminComments is true if either field is set", () => {
    expect(itemHasAdminComments({ clientNote: "a", internalNote: "" })).toBe(true);
    expect(itemHasAdminComments({ clientNote: "", internalNote: "b" })).toBe(true);
    expect(itemHasAdminComments({ clientNote: "", internalNote: "  " })).toBe(false);
    expect(itemHasAdminComments({})).toBe(false);
  });

  it("does not treat clientComment as admin comment fields", () => {
    expect(itemHasAdminComments({ clientComment: "from client" })).toBe(false);
  });
});
