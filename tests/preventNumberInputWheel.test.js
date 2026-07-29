import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { attachNumberInputWheelGuard } from "../src/lib/preventNumberInputWheel.js";

/**
 * Vitest uses environment: "node" (no jsdom). Provide a minimal DOM so
 * attachNumberInputWheelGuard's HTMLInputElement / document.activeElement path can be tested.
 */
class FakeHTMLInputElement {
  constructor() {
    this.type = "text";
    this.value = "";
  }

  focus() {
    document.activeElement = this;
  }

  blur() {
    if (document.activeElement === this) {
      document.activeElement = document.body;
    }
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.defaultPrevented = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

function installDom() {
  const body = { innerHTML: "" };
  const doc = {
    body,
    activeElement: body,
    createElement(tag) {
      if (String(tag).toLowerCase() !== "input") {
        throw new Error(`unsupported createElement(${tag})`);
      }
      return new FakeHTMLInputElement();
    },
  };

  const win = new EventEmitter();
  win.addEventListener = (type, listener, options) => {
    const capture = options === true || (options && options.capture);
    win.on(capture ? `capture:${type}` : type, listener);
  };
  win.removeEventListener = (type, listener, options) => {
    const capture = options === true || (options && options.capture);
    win.off(capture ? `capture:${type}` : type, listener);
  };
  win.dispatchEvent = (event) => {
    win.emit(`capture:${event.type}`, event);
    win.emit(event.type, event);
    return !event.defaultPrevented;
  };

  globalThis.HTMLInputElement = FakeHTMLInputElement;
  globalThis.Event = FakeEvent;
  globalThis.document = doc;
  globalThis.window = win;
}

describe("attachNumberInputWheelGuard", () => {
  beforeEach(() => {
    installDom();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete globalThis.HTMLInputElement;
    delete globalThis.Event;
    delete globalThis.document;
    delete globalThis.window;
  });

  it("blurs focused number input on wheel without preventDefault", () => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = "10";
    document.body.appendChild = () => {};
    input.focus();
    expect(document.activeElement).toBe(input);

    const detach = attachNumberInputWheelGuard(window);
    const event = new Event("wheel", { bubbles: true, cancelable: true });
    const preventedSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe("10");
    expect(preventedSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    detach();
  });

  it("ignores text and range inputs", () => {
    const text = document.createElement("input");
    text.type = "text";
    text.value = "abc";
    const range = document.createElement("input");
    range.type = "range";
    range.value = "30";

    const detach = attachNumberInputWheelGuard(window);
    text.focus();
    window.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(document.activeElement).toBe(text);

    range.focus();
    window.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(document.activeElement).toBe(range);

    detach();
  });

  it("does not duplicate listeners after attach and removes on detach", () => {
    const input = document.createElement("input");
    input.type = "number";
    input.value = "5";

    const blurSpy = vi.spyOn(input, "blur");
    const detach1 = attachNumberInputWheelGuard(window);
    const detach2 = attachNumberInputWheelGuard(window);

    input.focus();
    window.dispatchEvent(new Event("wheel", { bubbles: true }));
    // Two listeners both call blur once each while focused; first blur wins.
    expect(blurSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    detach1();
    detach2();
    blurSpy.mockClear();
    input.focus();
    window.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(blurSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });
});
