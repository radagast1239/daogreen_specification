import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  isModalEscapeKey,
  dispatchModalEscape,
  registerModalEscape,
  modalEscapeStackDepth,
  resetModalEscapeStack,
} from "../src/lib/modalEscape.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiSrc = fs.readFileSync(path.join(__dirname, "../src/components/ui.jsx"), "utf8");
const themeCss = fs.readFileSync(path.join(__dirname, "../src/styles/theme.css"), "utf8");
const materialsPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/MaterialsPage.jsx"),
  "utf8"
);

describe("modalEscape 1h", () => {
  beforeEach(() => {
    resetModalEscapeStack();
  });

  afterEach(() => {
    resetModalEscapeStack();
  });

  it("isModalEscapeKey recognizes Escape and respects defaultPrevented", () => {
    expect(isModalEscapeKey({ key: "Escape", defaultPrevented: false })).toBe(true);
    expect(isModalEscapeKey({ key: "Esc", defaultPrevented: false })).toBe(true);
    expect(isModalEscapeKey({ key: "Enter", defaultPrevented: false })).toBe(false);
    expect(isModalEscapeKey({ key: "Escape", defaultPrevented: true })).toBe(false);
    expect(isModalEscapeKey(null)).toBe(false);
  });

  it("Escape invokes only top onClose once; preventDefault Escape does nothing", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const unregLower = registerModalEscape(lower);
    const unregUpper = registerModalEscape(upper);
    expect(modalEscapeStackDepth()).toBe(2);

    const esc = { key: "Escape", defaultPrevented: false, preventDefault: vi.fn() };
    expect(dispatchModalEscape(esc)).toBe(true);
    expect(esc.preventDefault).toHaveBeenCalledTimes(1);
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();

    expect(
      dispatchModalEscape({ key: "Escape", defaultPrevented: true, preventDefault: vi.fn() })
    ).toBe(false);
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();

    unregUpper();
    const esc2 = { key: "Escape", defaultPrevented: false, preventDefault: vi.fn() };
    expect(dispatchModalEscape(esc2)).toBe(true);
    expect(lower).toHaveBeenCalledTimes(1);
    unregLower();
    expect(modalEscapeStackDepth()).toBe(0);
  });

  it("unregister removes listener registration without leaving stale depth", () => {
    const a = vi.fn();
    const unreg = registerModalEscape(a);
    expect(modalEscapeStackDepth()).toBe(1);
    unreg();
    unreg();
    expect(modalEscapeStackDepth()).toBe(0);
  });
});

describe("shared Modal 1h structure", () => {
  it("wires Escape registration, focus restore, body scroll lock, and close aria", () => {
    expect(uiSrc).toContain('import { registerModalEscape } from "../lib/modalEscape.js"');
    expect(uiSrc).toContain("registerModalEscape(");
    expect(uiSrc).toContain('document.body.style.overflow = "hidden"');
    expect(uiSrc).toContain("previousFocusRef");
    expect(uiSrc).toContain("closeBtnRef");
    expect(uiSrc).toContain('aria-label="Закрыть"');
    expect(uiSrc).toContain('role="dialog"');
    expect(uiSrc).toContain("aria-modal");
  });

  it("keeps overlay click-outside and ✕ onClose without changing submit semantics", () => {
    expect(uiSrc).toContain('className="overlay" onClick={onClose}');
    expect(uiSrc).toContain("onClick={onClose}");
    expect(uiSrc).toContain("e.stopPropagation()");
    expect(uiSrc).not.toContain("onSubmit");
  });

  it("preserves material-edit-modal className passthrough", () => {
    expect(uiSrc).toContain("className={`modal${className ? ` ${className}` : \"\"}`}");
    expect(materialsPage).toContain('className="material-edit-modal"');
  });
});

describe("internal admin links 1h", () => {
  it("Materials supplier create uses Link, not raw href=/suppliers", () => {
    expect(materialsPage).toContain('<Link to="/suppliers">Создать поставщика</Link>');
    expect(materialsPage).not.toContain('href="/suppliers"');
    expect(materialsPage).not.toContain('href="/modules"');
    expect(materialsPage).not.toContain('href="/settings"');
    expect(materialsPage).not.toContain('href="/materials"');
    expect(materialsPage).not.toMatch(/href=["']\/spec\/spec/);
    expect(materialsPage).toContain('to={modulesTabPath("publish")}');
    expect(materialsPage).toContain('to={modulesTabPath("farm")}');
  });

  it("does not hardcode /spec basename inside Materials Link targets", () => {
    expect(materialsPage).not.toMatch(/to=["']\/spec\//);
    expect(materialsPage).not.toMatch(/to=\{`\/spec\//);
  });
});

describe("modal + narrow layout CSS 1h", () => {
  it("modal body scrolls while head/foot stay outside overflow", () => {
    expect(themeCss).toMatch(/\.modal\s*\{[^}]*display:\s*flex/s);
    expect(themeCss).toMatch(/\.modal\s*\{[^}]*overflow:\s*hidden/s);
    expect(themeCss).toMatch(/\.modal-body\s*\{[^}]*overflow:\s*auto/s);
    expect(themeCss).toMatch(/\.modal-foot\s*\{[^}]*flex-shrink:\s*0/s);
    expect(themeCss).toMatch(/\.modal-head\s*\{[^}]*flex-shrink:\s*0/s);
  });

  it("material-edit-modal keeps scroll body and no duplicate sticky requirement", () => {
    expect(themeCss).toContain(".modal.material-edit-modal");
    expect(themeCss).toContain(".modal.material-edit-modal .modal-body");
  });

  it("narrow viewport collapses photo/quality stats and allows toolbar wrap", () => {
    expect(themeCss).toContain("@media (max-width: 480px)");
    expect(themeCss).toContain(".photos-stat-row");
    expect(themeCss).toContain("grid-template-columns: 1fr");
    expect(themeCss).toMatch(/\.toolbar\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(themeCss).toContain(".table-scroll-wrap");
  });
});
