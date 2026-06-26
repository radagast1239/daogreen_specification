import { chromium } from "playwright";
import fs from "fs";

const url = process.argv[2] || "http://62.233.35.206/spec/";
const out = { url, errors: [], failed: [], title: "", rootText: "", rootHtml: "" };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => out.errors.push(`PAGE: ${e.message}\n${e.stack || ""}`));
page.on("console", (m) => {
  if (m.type() === "error") out.errors.push(`CONSOLE: ${m.text()}`);
});
page.on("requestfailed", (r) => out.failed.push(`${r.url()} -> ${r.failure()?.errorText || ""}`));

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);
  out.title = await page.title();
  out.rootHtml = await page.evaluate(() => document.getElementById("root")?.innerHTML || "");
  out.rootText = await page.evaluate(() => document.body?.innerText || "");
} catch (e) {
  out.gotoError = e.message;
}

await browser.close();
fs.writeFileSync("scripts/check-site-result.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
