/**
 * Local browser preview screenshots for Planner visual redesign Phase 1 integration.
 * Temp DB/auth only — never touches production.
 */
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), "daogreen-planner-redesign-phase1");
const SHOTS = path.join(OUT, "shots");
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:5177";
const ADMIN_KEY = process.env.ADMIN_KEY || "preview-redesign-key";

fs.mkdirSync(SHOTS, { recursive: true });

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/planner", name), "utf8"));
}

function complexPlan() {
  const base = loadFixture("two-rooms.json");
  const dim = loadFixture("manual-dimension.json").dimensions[0];
  const door = loadFixture("door-on-wall.json").items[0];
  delete base._fixture;
  delete base._note;
  // Add a diagonal wall for production-like geometry
  base.nodes.n8 = { x: 2000, y: 4000 };
  base.nodes.n9 = { x: 3500, y: 2500 };
  base.walls.push({
    id: "w-diag",
    a: "n8",
    b: "n9",
    thk: 100,
    role: "partition",
    kind: "new",
    thicknessSide: "center",
    height: 3000,
    type: "wall",
    chainId: "w-diag",
  });
  base.items = [
    {
      ...door,
      id: "d-main",
      x: 1550,
      y: -50,
      wallId: "w1",
      wallSeg: { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
    },
    {
      id: "win1",
      kind: "window",
      x: 5200,
      y: -40,
      w: 1200,
      h: 80,
      angle: 0,
      wallId: "w2",
      wallSeg: { a: { x: 4000, y: 0 }, b: { x: 8000, y: 0 } },
    },
    {
      id: "rack1",
      kind: "rack",
      x: 800,
      y: 800,
      w: 1200,
      h: 600,
      angle: 0,
      layer: "racks",
      label: "Стеллаж 1",
    },
  ];
  base.dimensions = [
    {
      ...dim,
      id: "dim-top",
      p1: { x: 0, y: 0 },
      p2: { x: 8000, y: 0 },
      offset: 420,
    },
    {
      id: "dim-side",
      type: "dimension",
      mode: "linear",
      kind: "manual",
      p1: { x: 0, y: 0 },
      p2: { x: 0, y: 4000 },
      offset: 360,
      orientation: "vertical",
    },
  ];
  base.labels = [];
  base.zones = [];
  base.links = [];
  base.structurals = [];
  base.rooms = [];
  return base;
}

function draftRecord(id, name, plan) {
  const now = new Date().toISOString();
  return { id, name, createdAt: now, updatedAt: now, plan };
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="password"]', ADMIN_KEY);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => null),
    page.click("button.btn-primary"),
  ]);
  await page.waitForTimeout(600);
}

async function openComplex(page) {
  await page.evaluate((draft) => {
    localStorage.setItem("daogreen-standalone-plans", JSON.stringify([draft]));
  }, draftRecord("draft-complex", "Сложный план phase1", complexPlan()));
  await page.goto(`${BASE}/planner/draft/draft-complex`, { waitUntil: "networkidle" });
  await page.waitForSelector(".planner-app--redesign", { timeout: 20000 });
  await page.waitForSelector(".dg-tool-rail", { timeout: 10000 });
  await page.waitForSelector(".dg-inspector", { timeout: 10000 });
  await page.waitForTimeout(900);
}

async function metrics(page) {
  return page.evaluate(() => {
    const svg = document.querySelector(".planner-canvas-wrap svg");
    const r = svg?.getBoundingClientRect();
    const pct = document.querySelector(".planner-viewport-controls output")?.textContent || "?";
    return {
      zoomPct: pct,
      canvas: r ? { width: Math.round(r.width), height: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null,
      docWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      hasRail: !!document.querySelector(".dg-tool-rail"),
      hasInspector: !!document.querySelector(".dg-inspector"),
      hasViewport: !!document.querySelector(".planner-viewport-controls"),
    };
  });
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", file);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const evidence = [];

  await login(page);
  await openComplex(page);

  // Before fit evidence — capture current zoom then force Fit
  const before = await metrics(page);
  await shot(page, "10a-fit-before");
  await page.locator('.planner-topbar button[title="Показать весь план"]').click({ force: true });
  await page.waitForTimeout(400);
  const after = await metrics(page);
  await shot(page, "10b-fit-after");
  evidence.push({ step: "fit", before, after });

  // 1. complex none selected
  await page.locator('.dg-tool-btn[aria-label="Выбор"]').click({ force: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await shot(page, "01-complex-1920x1080-none");

  // 2. wall selected
  const box = await page.locator(".planner-canvas-wrap svg").boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.38);
    await page.waitForTimeout(500);
  }
  await shot(page, "02-wall-selected-inspector");

  // 3. dimension
  if (box) {
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.28);
    await page.waitForTimeout(500);
  }
  await shot(page, "03-dimension-selected");

  // 4. measure group open
  await page.locator('.dg-tool-btn[aria-label="Размер"]').click({ force: true });
  await page.waitForTimeout(300);
  await shot(page, "04-measure-group-open");

  // 5. 1440
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.locator('.planner-topbar button[title="Показать весь план"]').click({ force: true }).catch(() => null);
  await page.waitForTimeout(250);
  await shot(page, "05-1440x900");
  evidence.push({ step: "1440", ...(await metrics(page)) });

  // 6. 1280
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  await page.locator('.planner-topbar button[title="Показать весь план"]').click({ force: true }).catch(() => null);
  await page.waitForTimeout(250);
  await shot(page, "06-1280x720");

  // 7. mobile tools
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.locator('.dg-tool-btn[aria-label="Выбор"]').click({ force: true }).catch(() => null);
  await shot(page, "07-mobile-390-tools");

  // 8. mobile inspector sheet
  if (box) {
    // re-open and select something after resize
    await page.goto(`${BASE}/planner/draft/draft-complex`, { waitUntil: "networkidle" });
    await page.waitForSelector(".dg-inspector");
    await page.waitForTimeout(700);
    const b2 = await page.locator(".planner-canvas-wrap svg").boundingBox();
    if (b2) await page.mouse.click(b2.x + b2.width * 0.45, b2.y + b2.height * 0.4);
    await page.waitForTimeout(400);
  }
  await shot(page, "08-mobile-390-inspector");

  // 9. tablet
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(400);
  await page.locator('.planner-topbar button[title="Показать весь план"]').click({ force: true }).catch(() => null);
  await page.waitForTimeout(250);
  await shot(page, "09-tablet-768x1024");
  evidence.push({ step: "768", ...(await metrics(page)) });

  fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("EVIDENCE", JSON.stringify(evidence, null, 2));
  await browser.close();
  console.log("DONE", SHOTS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
