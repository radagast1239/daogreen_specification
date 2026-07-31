import { describe, expect, it } from "vitest";
import {
  getClipboardImageFile,
  isEditablePasteTarget,
  renameClipboardImageFile,
  screenshotDisplayName,
} from "../src/lib/clipboardPhoto.js";

function makePasteEvent({ items = [], target = { tagName: "DIV" } } = {}) {
  return {
    target,
    clipboardData: { items },
    preventDefaultCalls: 0,
    preventDefault() {
      this.preventDefaultCalls += 1;
    },
  };
}

describe("clipboardPhoto helpers", () => {
  it("getClipboardImageFile extracts image file from clipboard items", () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" });
    const file = new File([blob], "clip.png", { type: "image/png" });
    const event = makePasteEvent({
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
    });
    const out = getClipboardImageFile(event);
    expect(out).toBeTruthy();
    expect(out.type).toBe("image/png");
    expect(out.name).toMatch(/^screenshot-\d+\.png$/);
  });

  it("getClipboardImageFile ignores text-only clipboard", () => {
    const event = makePasteEvent({
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
    });
    expect(getClipboardImageFile(event)).toBeNull();
  });

  it("isEditablePasteTarget detects input/textarea", () => {
    expect(isEditablePasteTarget(makePasteEvent({ target: { tagName: "INPUT" } }))).toBe(true);
    expect(isEditablePasteTarget(makePasteEvent({ target: { tagName: "TEXTAREA" } }))).toBe(true);
    expect(isEditablePasteTarget(makePasteEvent({ target: { tagName: "DIV", isContentEditable: true } }))).toBe(true);
    expect(isEditablePasteTarget(makePasteEvent({ target: { tagName: "DIV" } }))).toBe(false);
  });

  it("screenshotDisplayName formats localized filename", () => {
    const d = new Date(2026, 6, 21, 14, 30, 0);
    expect(screenshotDisplayName(d, "png")).toBe("Скриншот 2026-07-21 14-30.png");
  });

  it("renameClipboardImageFile keeps mime type", () => {
    const raw = new File([Uint8Array.from([1])], "screenshot-1.png", { type: "image/png" });
    const renamed = renameClipboardImageFile(raw, "Скриншот 2026-07-21 14-30.png");
    expect(renamed.name).toBe("Скриншот 2026-07-21 14-30.png");
    expect(renamed.type).toBe("image/png");
  });
});
