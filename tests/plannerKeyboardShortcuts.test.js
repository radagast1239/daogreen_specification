/**
 * PHASE 2C3A — history shortcut contract.
 *
 * Drives the exact matcher the PlanPage keydown handler calls
 * (matchHistoryShortcut), so a passing test means the shipped shortcut works,
 * not that a copy of the logic works. The handler is a one-liner around this
 * matcher: one match -> one preventDefault -> one history action.
 */
import { describe, it, expect } from "vitest";
import { matchHistoryShortcut, isEditableTarget } from "../src/pages/admin/PlanPage.jsx";

/** Minimal KeyboardEvent stand-in: only the fields the matcher reads. */
function key({ code, key: k, ctrl = false, meta = false, shift = false, target = { tagName: "BODY" } }) {
  return { code, key: k, ctrlKey: ctrl, metaKey: meta, shiftKey: shift, target };
}

const BODY = { tagName: "BODY" };
const CANVAS = { tagName: "svg" };

describe("PHASE 2C3A — Undo/Redo shortcut matching", () => {
  it("1. Ctrl+Z on an English layout is Undo", () => {
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "z", ctrl: true }))).toBe("undo");
  });

  it("2. Ctrl+physical-Z on a Russian layout is Undo (key='я', code='KeyZ')", () => {
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "я", ctrl: true }))).toBe("undo");
  });

  it("3. Meta+Z is Undo", () => {
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "z", meta: true }))).toBe("undo");
  });

  it("4. Ctrl+Shift+Z is Redo, including the uppercase key browsers report", () => {
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "Z", ctrl: true, shift: true }))).toBe("redo");
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "я", ctrl: true, shift: true }))).toBe("redo");
  });

  it("5. Ctrl+Y is Redo on both layouts", () => {
    expect(matchHistoryShortcut(key({ code: "KeyY", key: "y", ctrl: true }))).toBe("redo");
    expect(matchHistoryShortcut(key({ code: "KeyY", key: "н", ctrl: true }))).toBe("redo");
  });

  it("6. works with canvas focus and with body focus", () => {
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "z", ctrl: true, target: BODY }))).toBe("undo");
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "z", ctrl: true, target: CANVAS }))).toBe("undo");
  });

  it("7. never fires inside a real editable field", () => {
    for (const target of [
      { tagName: "INPUT" },
      { tagName: "TEXTAREA" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
      { tagName: "SPAN", closest: (sel) => (sel === "[contenteditable='true']" ? {} : null) },
    ]) {
      expect(matchHistoryShortcut(key({ code: "KeyZ", key: "z", ctrl: true, target }))).toBeNull();
      expect(matchHistoryShortcut(key({ code: "KeyY", key: "y", ctrl: true, target }))).toBeNull();
      expect(isEditableTarget(target)).toBe(true);
    }
  });

  it("8. a plain BODY/svg target is not editable", () => {
    expect(isEditableTarget(BODY)).toBe(false);
    expect(isEditableTarget({ tagName: "DIV", closest: () => null })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("9. bare Z / Y without a modifier are not history shortcuts", () => {
    expect(matchHistoryShortcut(key({ code: "KeyZ", key: "z" }))).toBeNull();
    expect(matchHistoryShortcut(key({ code: "KeyY", key: "y" }))).toBeNull();
  });

  it("10. one keydown yields exactly one action (undo and redo are exclusive)", () => {
    const undoEvt = key({ code: "KeyZ", key: "z", ctrl: true });
    const redoEvt = key({ code: "KeyZ", key: "z", ctrl: true, shift: true });
    expect(matchHistoryShortcut(undoEvt)).toBe("undo");
    expect(matchHistoryShortcut(redoEvt)).toBe("redo");
    // The matcher is a pure classifier: repeated calls cannot double-apply.
    expect(matchHistoryShortcut(undoEvt)).toBe("undo");
  });

  it("11. falls back to event.key when the engine omits event.code", () => {
    expect(matchHistoryShortcut(key({ code: undefined, key: "z", ctrl: true }))).toBe("undo");
    expect(matchHistoryShortcut(key({ code: undefined, key: "я", ctrl: true }))).toBe("undo");
    expect(matchHistoryShortcut(key({ code: undefined, key: "Y", ctrl: true }))).toBe("redo");
  });

  it("12. unrelated modified keys are ignored", () => {
    expect(matchHistoryShortcut(key({ code: "KeyC", key: "c", ctrl: true }))).toBeNull();
    expect(matchHistoryShortcut(key({ code: "KeyV", key: "v", ctrl: true }))).toBeNull();
    expect(matchHistoryShortcut(null)).toBeNull();
  });
});
