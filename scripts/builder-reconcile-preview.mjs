#!/usr/bin/env node
/**
 * Temp-env browser/API preview for builder reconcile P0.
 * No production DB/uploads.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tempRoot = path.join(os.tmpdir(), `daogreen-builder-reconcile-preview-${Date.now()}`);
const dbPath = path.join(tempRoot, "preview.db");
const uploadRoot = path.join(tempRoot, "uploads");
const API_PORT = 49851;
const WEB_PORT = 49852;
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
  CORS_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
  VITE_BASE_PATH: "/",
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

function spawnNode(args, name) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  return child;
}

const report = { steps: [], ok: true };

function step(name, detail) {
  report.steps.push({ name, ...detail });
  console.log("STEP", name, JSON.stringify(detail));
}

async function main() {
  const backend = spawnNode(["backend/src/index.js"], "api");
  await waitHealth(`http://127.0.0.1:${API_PORT}/api/health`);

  // Seed material
  const mat = await api("POST", "/api/admin/materials", {
    name: "Труба preview",
    unit: "м",
    category: "Каркас",
    basePrice: 100,
    supplier: "Каталог",
    link: "https://example.test/tube",
    status: "active",
    module: "general",
  }).catch(async () => {
    // some envs use different create path
    const list = await api("GET", "/api/materials");
    return list[0] || list.materials?.[0];
  });

  const materials = await api("GET", "/api/materials");
  const materialList = Array.isArray(materials) ? materials : materials.materials || [];
  const m = mat?.id ? mat : materialList[0];
  if (!m?.id) throw new Error("no material");

  const created = await api("POST", "/api/projects", {
    name: "Preview Farm",
    client: "Preview Client",
    status: "active",
    city: "Test",
    area: 10,
    items: [
      {
        id: "st_preview__ln1",
        materialId: m.id,
        name: m.name,
        module: "Стеллаж 1",
        section: "Стеллаж 1",
        qty: 2,
        price: Number(m.basePrice) || 100,
        unit: m.unit || "шт.",
        category: m.category || "Прочее",
        supplier: m.supplier || "",
        link: m.link || "",
        includedInProject: true,
        enabled: true,
        visibleToClient: true,
        approved: true,
        status: "not_bought",
      },
    ],
    stellageConfigs: [{ id: "st_preview", name: "Стеллаж 1", count: 1 }],
    manualParams: {
      projectSchemes: [{ id: "sch1", title: "Схема preview", clientVisible: true, order: 1 }],
      floorPlanTitle: "План preview",
      publishedRelease: { version: 1, frozenAt: "2026-01-01T00:00:00Z" },
    },
  });

  let rev = created.revision;
  const itemId = created.items[0].id;

  const patched = await api("PATCH", `/api/projects/${created.id}/items/${itemId}`, {
    expectedRevision: rev,
    status: "bought",
    visibleToClient: false,
    visible: false,
    approved: false,
    showToClient: false,
    clientVisible: false,
    actualPrice: 42,
    clientComment: "preview-note",
    responsible: "buyer",
    supplier: "SpecSupplier",
    name: "Труба (admin)",
    nameOverridden: true,
    price: 777,
  });
  rev = patched.revision;

  await api("PATCH", `/api/projects/${created.id}`, {
    expectedRevision: rev,
    status: "on_review",
  }).then((p) => {
    rev = p.revision;
  });

  // Stale builder wipe attempt WITH builderSave reconcile
  const afterBuilder = await api("PATCH", `/api/projects/${created.id}`, {
    expectedRevision: rev,
    builderSave: true,
    builderSaveMode: "title",
    name: "Preview Farm RENAMED",
    items: [
      {
        id: itemId,
        materialId: m.id,
        name: m.name,
        module: "Стеллаж 1",
        section: "Стеллаж 1",
        qty: 99,
        price: 100,
        status: "not_bought",
        visibleToClient: true,
        supplier: "Каталог",
      },
    ],
    manualParams: {
      builderWizard: { lastStep: "review" },
      publishedRelease: { version: 99 },
      projectSchemes: [{ id: "sch1", title: "WIPED" }],
      floorPlanTitle: "WIPED",
    },
    status: "active",
  });

  const item = afterBuilder.items.find((i) => i.id === itemId);
  const checks = {
    name: afterBuilder.name === "Preview Farm RENAMED",
    status: afterBuilder.status === "on_review",
    itemStatus: item?.status === "bought",
    visible: item?.visibleToClient === false,
    actualPrice: item?.actualPrice === 42,
    note: item?.clientComment === "preview-note",
    supplier: item?.supplier === "SpecSupplier",
    title: item?.name === "Труба (admin)",
    price: item?.price === 777,
    qty: item?.qty === 2,
    scheme: afterBuilder.manualParams?.projectSchemes?.[0]?.title === "Схема preview",
    release: afterBuilder.manualParams?.publishedRelease?.version === 1,
    floorTitle: afterBuilder.manualParams?.floorPlanTitle === "План preview",
  };
  step("title-only-builder-save", checks);
  if (Object.values(checks).some((v) => !v)) {
    report.ok = false;
    report.failed = checks;
  }

  // Qty change preserves admin
  rev = afterBuilder.revision;
  const afterQty = await api("PATCH", `/api/projects/${created.id}`, {
    expectedRevision: rev,
    builderSave: true,
    builderSaveMode: "full",
    name: "Preview Farm RENAMED",
    items: [
      {
        ...item,
        qty: 6,
        status: "not_bought",
        visibleToClient: true,
        name: m.name,
        supplier: "Каталог",
        price: 100,
        actualPrice: null,
        clientComment: "",
      },
    ],
    stellageConfigs: [{ id: "st_preview", name: "Стеллаж 1", count: 3 }],
    manualParams: afterBuilder.manualParams,
    status: "active",
  });
  const item2 = afterQty.items.find((i) => i.id === itemId);
  const qtyChecks = {
    qty: item2?.qty === 6,
    status: item2?.status === "bought",
    visible: item2?.visibleToClient === false,
    note: item2?.clientComment === "preview-note",
    idSame: item2?.id === itemId,
  };
  step("qty-recalc-preserves-admin", qtyChecks);
  if (Object.values(qtyChecks).some((v) => !v)) {
    report.ok = false;
    report.qtyFailed = qtyChecks;
  }

  // Stale revision 409
  let got409 = false;
  try {
    await api("PATCH", `/api/projects/${created.id}`, {
      expectedRevision: 1,
      builderSave: true,
      builderSaveMode: "title",
      name: "HACK",
    });
  } catch (e) {
    got409 = e.status === 409;
  }
  step("stale-revision-409", { got409 });
  if (!got409) report.ok = false;

  // Publication immutable
  const still = await api("GET", `/api/projects/${created.id}`);
  step("publication-immutable", {
    version: still.manualParams?.publishedRelease?.version === 1,
  });

  report.tempRoot = tempRoot;
  report.apiPort = API_PORT;
  report.projectId = created.id;
  fs.writeFileSync(path.join(tempRoot, "preview-report.json"), JSON.stringify(report, null, 2));
  console.log("PREVIEW_REPORT", JSON.stringify(report, null, 2));

  backend.kill();
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
