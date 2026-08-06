/**
 * Local browser preview screenshots — Planner Phase 2 fullscreen shell.
 * Temp DB/auth only — never touches production.
 */
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  estimatePlannerCanvasWidth,
  meetsPlannerCanvasWidthTarget,
} from "../src/planner/plannerWorkspaceShell.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(os.tmpdir(), "daogreen-planner-phase2-shell");
const SHOTS = path.join(OUT, "shots");
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:5178";
const ADMIN_KEY = process.env.ADMIN_KEY || "preview-phase2-shell-key";

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
  }, draftRecord("draft-phase2", "Сложный план phase2", complexPlan()));
  await page.goto(`${BASE}/planner/draft/draft-phase2`, { waitUntil: "networkidle" });
  await page.waitForSelector(".planner-app--phase2", { timeout: 20000 });
  await page.waitForSelector(".dg-tool-rail", { timeout: 10000 });
  await page.waitForTimeout(900);
}

async function metrics(page) {
  return page.evaluate(() => {
    const svg = document.querySelector(".planner-canvas-wrap svg");
    const r = svg?.getBoundingClientRect();
    const pct = document.querySelector(".planner-viewport-controls output")?.textContent || "?";
    const app = document.querySelector(".planner-app--phase2");
    const shell = document.querySelector(".shell");
    return {
      zoomPct: pct,
      canvas: r ? { width: Math.round(r.width), height: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null,
      viewportWidth: window.innerWidth,
      inspectorOpen: app?.getAttribute("data-inspector-open") === "1",
      inspectorMode: app?.getAttribute("data-inspector-mode"),
      breakpoint: app?.getAttribute("data-planner-bp"),
      shellClass: shell?.className || "",
      hasGlobalSearch: !!document.querySelector(".global-search"),
      hasAppChrome: !!document.querySelector(".planner-app-chrome"),
      sidebarOpen: !!document.querySelector(".sidebar.sidebar--open"),
      hasInspector: !!document.querySelector(".dg-inspector"),
      topbarHeight: Math.round(document.querySelector(".planner-topbar")?.getBoundingClientRect().height || 0),
    };
  });
}

async function fit(page) {
  await page.locator('.planner-topbar button[title="Весь план"]').click({ force: true }).catch(() => null);
  await page.waitForTimeout(350);
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("shot", file);
  return file;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const evidence = {
    targets: {
      "1920_open": meetsPlannerCanvasWidthTarget({ viewportWidth: 1920, inspectorOpen: true }),
      "1440_open": meetsPlannerCanvasWidthTarget({ viewportWidth: 1440, inspectorOpen: true }),
      "1280_collapsed": meetsPlannerCanvasWidthTarget({ viewportWidth: 1280, inspectorOpen: false }),
    },
    beforeAfter1440: {
      before: estimatePlannerCanvasWidth({
        viewportWidth: 1440,
        appNavWidth: 220,
        inspectorOpen: true,
        inspectorWidth: 328,
      }),
      after: estimatePlannerCanvasWidth({
        viewportWidth: 1440,
        appNavWidth: 0,
        inspectorOpen: true,
        inspectorWidth: 328,
      }),
    },
    shots: [],
  };

  await login(page);
  await openComplex(page);
  await fit(page);

  // 1. 1920 sidebar hidden, inspector open
  let m = await metrics(page);
  evidence.shots.push({ name: "01-1920-sidebar-hidden-inspector-open", ...m });
  await shot(page, "01-1920-sidebar-hidden-inspector-open");

  // 2. 1440 inspector open
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  await fit(page);
  m = await metrics(page);
  evidence.shots.push({ name: "02-1440-inspector-open", ...m });
  await shot(page, "02-1440-inspector-open");

  // 3. 1280 inspector collapsed
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  // mid breakpoint defaults open — collapse explicitly
  const inspToggle = page.locator('.planner-topbar button[title="Скрыть свойства"], .planner-topbar button[title="Показать свойства"]');
  if (await page.locator(".planner-app--phase2.is-inspector-open").count()) {
    await inspToggle.click({ force: true });
    await page.waitForTimeout(300);
  }
  await fit(page);
  m = await metrics(page);
  evidence.shots.push({ name: "03-1280-inspector-collapsed", ...m });
  await shot(page, "03-1280-inspector-collapsed");

  // 4. 1280 inspector opened
  await page.locator('.planner-topbar button[title="Показать свойства"]').click({ force: true });
  await page.waitForTimeout(300);
  m = await metrics(page);
  evidence.shots.push({ name: "04-1280-inspector-opened", ...m });
  await shot(page, "04-1280-inspector-opened");

  // 5. App sidebar overlay open
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.locator(".planner-app-chrome__menu").click({ force: true });
  await page.waitForSelector(".sidebar.sidebar--open", { timeout: 5000 });
  await page.waitForTimeout(250);
  m = await metrics(page);
  evidence.shots.push({ name: "05-app-sidebar-overlay-open", ...m });
  await shot(page, "05-app-sidebar-overlay-open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // 6. metrics summary shot (projects page for non-planner unchanged check)
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const projectsHasSearch = await page.evaluate(() => !!document.querySelector(".global-search"));
  evidence.projectsPageHasGlobalSearch = projectsHasSearch;
  await shot(page, "06-projects-page-unchanged-shell");

  fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify(evidence, null, 2));
  const metricsMd = [
    "# Phase 2 canvas width metrics",
    "",
    `Before 1440 (sidebar 220 + rail + inspector): **${evidence.beforeAfter1440.before} px**`,
    `After 1440 (fullscreen, inspector open): **${evidence.beforeAfter1440.after} px**`,
    "",
    "## Layout targets",
    "",
    `- 1920 inspector open: estimated ${evidence.targets["1920_open"].width} (need ≥1250) → ${evidence.targets["1920_open"].ok ? "PASS" : "FAIL"}`,
    `- 1440 inspector open: estimated ${evidence.targets["1440_open"].width} (need ≥850) → ${evidence.targets["1440_open"].ok ? "PASS" : "FAIL"}`,
    `- 1280 inspector collapsed: estimated ${evidence.targets["1280_collapsed"].width} (need ≥850) → ${evidence.targets["1280_collapsed"].ok ? "PASS" : "FAIL"}`,
    "",
    "## Measured (browser)",
    "",
    ...evidence.shots.map(
      (s) =>
        `- ${s.name}: canvas=${s.canvas?.width ?? "?"}×${s.canvas?.height ?? "?"} zoom=${s.zoomPct} insp=${s.inspectorOpen} mode=${s.inspectorMode} bp=${s.breakpoint}`,
    ),
    "",
    `Projects page still has GlobalSearch: ${projectsHasSearch}`,
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "METRICS.md"), metricsMd);
  console.log(metricsMd);
  await browser.close();
  console.log("DONE", SHOTS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
