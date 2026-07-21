#!/usr/bin/env node
/**
 * Temp-env API preview for builder reconcile edge fixes.
 * No production DB/uploads.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tempRoot = path.join(os.tmpdir(), `daogreen-builder-edge-preview-${Date.now()}`);
const dbPath = path.join(tempRoot, "preview.db");
const uploadRoot = path.join(tempRoot, "uploads");
const API_PORT = 49871;
const ADMIN_KEY = "preview-admin-key-builder-reconcile";

fs.mkdirSync(uploadRoot, { recursive: true });

const env = {
  ...process.env,
  DATABASE_PATH: dbPath,
  DB_PATH: dbPath,
  UPLOAD_ROOT: uploadRoot,
  PORT: String(API_PORT),
  NODE_ENV: "development",
  ADMIN_KEY,
  ADMIN_ACCESS_MODE: "key",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error(`health timeout ${url}`);
}

async function api(method, pathname, body) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": ADMIN_KEY,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const report = { steps: [], ok: true };

function step(name, detail) {
  report.steps.push({ name, ...detail });
  console.log("STEP", name, JSON.stringify(detail));
  if (detail && detail.ok === false) report.ok = false;
}

async function main() {
  const backend = spawn(process.execPath, ["backend/src/index.js"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  backend.stdout.on("data", (d) => process.stdout.write(`[api] ${d}`));
  backend.stderr.on("data", (d) => process.stderr.write(`[api] ${d}`));
  await waitHealth(`http://127.0.0.1:${API_PORT}/api/health`);

  const materials = await api("GET", "/api/materials");
  const materialList = Array.isArray(materials) ? materials : materials.materials || [];
  const m = materialList[0];
  const m2 = materialList[1] || materialList[0];

  const mkItem = (id, mat, extra = {}) => ({
    id,
    materialId: mat.id,
    name: mat.name,
    module: "Стеллаж 1",
    section: "Стеллаж 1",
    qty: 2,
    price: Number(mat.basePrice) || 100,
    unit: mat.unit || "шт.",
    category: mat.category || "Прочее",
    supplier: mat.supplier || "",
    link: mat.link || "",
    includedInProject: true,
    enabled: true,
    visibleToClient: true,
    approved: true,
    status: "not_bought",
    ...extra,
  });

  // Scenario A: full builder edits including schemes/power/cooling
  const a = await api("POST", "/api/projects", {
    name: "A Farm",
    client: "C",
    status: "active",
    items: [mkItem("st_a__ln1", m)],
    stellageConfigs: [{ id: "st_a", name: "Стеллаж 1", count: 1 }],
    rooms: [{ id: "r1", name: "Old", area: 5 }],
    manualParams: {
      publishedRelease: { version: 2, frozenAt: "t0" },
      projectSchemes: [{ id: "sch1", title: "Old" }],
    },
  });
  let rev = a.revision;
  const patched = await api("PATCH", `/api/projects/${a.id}/items/st_a__ln1`, {
    expectedRevision: rev,
    status: "bought",
    clientComment: "keep-a",
    visibleToClient: false,
    visible: false,
    approved: false,
    showToClient: false,
    clientVisible: false,
  });
  rev = patched.revision;

  const aAfter = await api("PATCH", `/api/projects/${a.id}`, {
    expectedRevision: rev,
    builderSave: true,
    builderSaveMode: "full",
    name: "A Farm RENAMED",
    items: [mkItem("st_a__ln1", m, { qty: 6 })],
    stellageConfigs: [{ id: "st_a", name: "Стеллаж 1", count: 3 }],
    rooms: [{ id: "r1", name: "New Room", area: 18 }],
    manualParams: {
      publishedRelease: { version: 99 },
      projectSchemes: [{ id: "sch1", title: "Edited Scheme", clientVisible: true }],
      farmPower: { kw: 11 },
      coolingFarm: { mode: "new" },
      builderWizard: { lastStep: "review" },
    },
    status: "active",
  });
  const aItem = aAfter.items.find((i) => i.id === "st_a__ln1");
  step("A-full-builder-edits", {
    ok:
      aAfter.name === "A Farm RENAMED" &&
      aAfter.stellageConfigs[0].count === 3 &&
      aAfter.rooms[0].name === "New Room" &&
      aAfter.manualParams.projectSchemes[0].title === "Edited Scheme" &&
      aAfter.manualParams.farmPower.kw === 11 &&
      aAfter.manualParams.coolingFarm.mode === "new" &&
      aAfter.manualParams.publishedRelease.version === 2 &&
      aItem.status === "bought" &&
      aItem.clientComment === "keep-a" &&
      aItem.qty === 6,
  });

  // Scenario B: first add schemes/power/cooling
  const b = await api("POST", "/api/projects", {
    name: "B Farm",
    client: "C",
    status: "active",
    items: [mkItem("st_b__ln1", m)],
    stellageConfigs: [{ id: "st_b", name: "Стеллаж 1", count: 1 }],
    manualParams: {},
  });
  const bAfter = await api("PATCH", `/api/projects/${b.id}`, {
    expectedRevision: b.revision,
    builderSave: true,
    builderSaveMode: "full",
    name: "B Farm",
    items: [mkItem("st_b__ln1", m)],
    stellageConfigs: [{ id: "st_b", name: "Стеллаж 1", count: 1 }],
    manualParams: {
      projectSchemes: [{ id: "n", title: "First" }],
      farmPower: { kw: 1 },
      coolingFarm: { mode: "b" },
    },
    status: "active",
  });
  step("B-first-add", {
    ok:
      bAfter.manualParams.projectSchemes?.[0]?.title === "First" &&
      bAfter.manualParams.farmPower?.kw === 1 &&
      bAfter.manualParams.coolingFarm?.mode === "b",
  });

  // Scenario C/D: ghost vs purchased preserve
  const c = await api("POST", "/api/projects", {
    name: "C Farm",
    client: "C",
    status: "active",
    items: [
      mkItem("st_c__keep", m),
      mkItem("st_c__hide", m2, { name: "HideOnly" }),
      mkItem("st_c__buy", m2, { name: "BuyMe" }),
    ],
    stellageConfigs: [{ id: "st_c", name: "Стеллаж 1", count: 1 }],
    manualParams: {},
  });
  rev = c.revision;
  let r = await api("PATCH", `/api/projects/${c.id}/items/st_c__hide`, {
    expectedRevision: rev,
    visibleToClient: false,
    visible: false,
    approved: false,
    showToClient: false,
    clientVisible: false,
  });
  rev = r.revision;
  r = await api("PATCH", `/api/projects/${c.id}/items/st_c__buy`, {
    expectedRevision: rev,
    status: "bought",
    clientComment: "cfg",
  });
  rev = r.revision;

  const onlyKeep = {
    expectedRevision: rev,
    builderSave: true,
    builderSaveMode: "full",
    name: "C Farm",
    items: [mkItem("st_c__keep", m)],
    stellageConfigs: [{ id: "st_c", name: "Стеллаж 1", count: 1 }],
    manualParams: {},
    status: "active",
  };
  let cAfter = await api("PATCH", `/api/projects/${c.id}`, onlyKeep);
  const ids1 = cAfter.items.map((i) => i.id);
  rev = cAfter.revision;
  onlyKeep.expectedRevision = rev;
  cAfter = await api("PATCH", `/api/projects/${c.id}`, onlyKeep);
  const ids2 = cAfter.items.map((i) => i.id);
  step("C-D-ghost-vs-purchased", {
    ok:
      !ids1.includes("st_c__hide") &&
      ids1.includes("st_c__buy") &&
      ids2.filter((id) => id === "st_c__buy").length === 1 &&
      cAfter.items.find((i) => i.id === "st_c__buy")?.status === "bought",
    ids1,
    ids2,
  });

  // Scenario E: 409
  let got409 = false;
  try {
    await api("PATCH", `/api/projects/${c.id}`, {
      expectedRevision: 1,
      builderSave: true,
      builderSaveMode: "full",
      name: "HACK",
      items: [mkItem("st_c__keep", m)],
    });
  } catch (e) {
    got409 = e.status === 409;
  }
  step("E-stale-409", { ok: got409, got409 });

  report.tempRoot = tempRoot;
  fs.writeFileSync(path.join(tempRoot, "preview-report.json"), JSON.stringify(report, null, 2));
  console.log("PREVIEW_REPORT", JSON.stringify(report, null, 2));
  backend.kill();
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
