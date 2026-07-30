// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Native Chromium wheel-on-number-input behavior is not fully covered by jsdom.
 * Default PLAYWRIGHT_BASE_URL points at production; for this suite use a local app
 * (or any page that loads the SPA with attachNumberInputWheelGuard).
 */
const BASE_URL = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const TARGET_URL = (process.env.PLAYWRIGHT_TARGET_URL || `${BASE_URL}/login`).replace(/\/$/, "");

test.describe("numeric input — wheel does not change value", () => {
  test("focused input[type=number] stays unchanged; page still scrolls", async ({ page }) => {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.id = "dg-wheel-spacer";
      spacer.style.height = "2500px";
      document.body.appendChild(spacer);

      window.__dgWheel = { inputEvents: 0, changeEvents: 0 };

      const input = document.createElement("input");
      input.id = "dg-wheel-number";
      input.type = "number";
      input.value = "10";
      input.style.marginTop = "1200px";
      input.style.width = "160px";
      input.addEventListener("input", () => {
        window.__dgWheel.inputEvents += 1;
      });
      input.addEventListener("change", () => {
        window.__dgWheel.changeEvents += 1;
      });
      document.body.appendChild(input);
    });

    const num = page.locator("#dg-wheel-number");
    expect(await num.inputValue()).toBe("10");

    // Ensure room to scroll (avoid flaky top/bottom clamps / canceling ±wheel).
    await page.evaluate(() => window.scrollTo(0, 800));
    await num.focus();
    const box = await num.boundingBox();
    expect(box).toBeTruthy();

    const scrollBefore = await page.evaluate(() => window.scrollY);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -140);
    await page.waitForTimeout(50);

    expect(await num.inputValue()).toBe("10");
    expect(await page.evaluate(() => window.__dgWheel.inputEvents)).toBe(0);
    expect(await page.evaluate(() => window.__dgWheel.changeEvents)).toBe(0);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe(
      "dg-wheel-number",
    );
    // Guard blurs without preventDefault, so page scroll must still move.
    const scrollMid = await page.evaluate(() => window.scrollY);
    expect(scrollMid).not.toBe(scrollBefore);

    await num.focus();
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(50);

    expect(await num.inputValue()).toBe("10");
  });

  test("unfocused input[type=number] is not mutated by wheel", async ({ page }) => {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "2000px";
      document.body.appendChild(spacer);

      const a = document.createElement("input");
      a.id = "dg-wheel-number-a";
      a.type = "number";
      a.value = "7";
      a.style.marginTop = "100px";

      const b = document.createElement("input");
      b.id = "dg-wheel-number-b";
      b.type = "number";
      b.value = "10";

      document.body.appendChild(a);
      document.body.appendChild(b);
    });

    const a = page.locator("#dg-wheel-number-a");
    const b = page.locator("#dg-wheel-number-b");
    await b.focus();

    const boxA = await a.boundingBox();
    expect(boxA).toBeTruthy();
    await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(50);

    expect(await a.inputValue()).toBe("7");
    expect(await page.evaluate(() => window.scrollY)).not.toBe(scrollBefore);
  });

  test("range sliders are unaffected (no blur)", async ({ page }) => {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    await page.evaluate(() => {
      const range = document.createElement("input");
      range.id = "dg-wheel-range";
      range.type = "range";
      range.min = "0";
      range.max = "100";
      range.step = "1";
      range.value = "30";
      range.style.marginTop = "200px";
      document.body.appendChild(range);
    });

    const range = page.locator("#dg-wheel-range");
    await range.focus();
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("dg-wheel-range");

    const box = await range.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(50);

    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("dg-wheel-range");
  });

  test("text inputs are unaffected", async ({ page }) => {
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    await page.evaluate(() => {
      const txt = document.createElement("input");
      txt.id = "dg-wheel-text";
      txt.type = "text";
      txt.value = "abc";
      txt.style.marginTop = "200px";
      document.body.appendChild(txt);
    });

    const txt = page.locator("#dg-wheel-text");
    await txt.focus();
    expect(await txt.inputValue()).toBe("abc");

    const box = await txt.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(50);

    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("dg-wheel-text");
    expect(await txt.inputValue()).toBe("abc");
  });
});
