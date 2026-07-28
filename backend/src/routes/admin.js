import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { nanoid } from "nanoid";
import { db, getDbPath } from "../db.js";
import { listMaterials, listModulesAdmin, createModule, updateModule, archiveModule, restoreModule, duplicateModule } from "./materials.js";
import { materialInModule } from "../../../shared/materialModules.js";
import { loadProject, loadProjectItems, rowToProject } from "../db.js";
import { projectTotals } from "../services/buildItems.js";
import { getAnalytics } from "../services/analytics.js";
import { getReportsR1Payload } from "../services/reportsR1.js";
import { listAdminUsers, upsertAdminUser, deactivateAdminUser } from "../auth.js";
import { brandSettingsResponse } from "../services/clientBrand.js";
import { publishRulesSettingsPayload } from "../services/publishRules.js";
import { multerFileFilter } from "../services/uploadFilter.js";
import { saveFile } from "../storage/index.js";
import {
  assertCanDeleteOrOverwriteAsset,
  deleteLocalUploadFile,
} from "../services/publishedAssetRetention.js";
import {
  runStorageInventoryScan,
  queryStorageInventory,
  isStorageInventoryScanning,
  getLastStorageInventory,
} from "../services/storageInventoryService.js";
import {
  previewQuarantine,
  executeQuarantine,
  listQuarantine,
  restoreQuarantinedFile,
} from "../services/storageQuarantineService.js";
import { sanitizeInventoryFile } from "../../../shared/storageInventory.js";
import { resolveUploadRoot } from "../services/uploadRoot.js";
import {
  assertValidDocumentUpload,
  UploadValidationError,
} from "../services/uploadValidation.js";
import { sendSafeUploadFile } from "../services/secureFileServe.js";

const uploadDir = resolveUploadRoot();
if (uploadDir) fs.mkdirSync(uploadDir, { recursive: true });
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: multerFileFilter({ allowDocs: true }),
});

const router = Router();

function clientKey(name) {
  return (name || "Без имени").trim().toLowerCase().replace(/\s+/g, " ");
}

function loadProfile(key) {
  return db.prepare("SELECT * FROM client_profiles WHERE client_key = ?").get(key);
}

function upsertProfile(key, displayName, patch = {}) {
  const cur = loadProfile(key);
  const status = patch.status ?? cur?.status ?? "new";
  const comment = patch.comment ?? cur?.comment ?? "";
  db.prepare(`
    INSERT INTO client_profiles (client_key, display_name, status, comment, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_key) DO UPDATE SET
      display_name = excluded.display_name,
      status = excluded.status,
      comment = excluded.comment,
      updated_at = datetime('now')
  `).run(key, displayName, status, comment);
  return loadProfile(key);
}

router.get("/clients", (_req, res) => {
  const rows = db.prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY client, name").all();
  const map = new Map();
  for (const r of rows) {
    const display = (r.client || "Без имени").trim();
    const key = clientKey(display);
    if (!map.has(key)) {
      const prof = loadProfile(key);
      map.set(key, {
        key,
        name: display,
        city: r.city,
        status: prof?.status || "new",
        comment: prof?.comment || "",
        projects: [],
      });
    }
    const items = loadProjectItems(r.id);
    const t = projectTotals(items);
    map.get(key).projects.push({
      ...rowToProject(r, []),
      totals: t,
    });
  }
  res.json([...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru")));
});

router.patch("/clients/profile", (req, res) => {
  const name = (req.body.clientName || req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "clientName required" });
  const key = clientKey(name);
  const allowed = ["status", "comment"];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  if (patch.status === "buying" && !loadProfile(key)?.purchase_started_at) {
    db.prepare("UPDATE client_profiles SET purchase_started_at = datetime('now') WHERE client_key = ?").run(key);
  }
  if (patch.status === "installed" || patch.status === "launched" || patch.status === "done") {
    db.prepare("UPDATE client_profiles SET installation_done_at = datetime('now') WHERE client_key = ?").run(key);
  }
  const prof = upsertProfile(key, name, patch);
  res.json({
    key,
    name,
    status: prof.status,
    comment: prof.comment,
    updatedAt: prof.updated_at,
  });
});

router.get("/suppliers", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT supplier, COUNT(*) as cnt FROM materials 
       WHERE supplier != '' AND status = 'active' GROUP BY supplier ORDER BY cnt DESC`
    )
    .all();
  res.json(rows.map((r) => ({ name: r.supplier, materialCount: r.cnt })));
});

router.get("/modules", (_req, res) => {
  const modules = listModulesAdmin();
  const mats = listMaterials();
  res.json(
    modules.map((m) => ({
      ...m,
      materialCount: mats.filter((x) => materialInModule(x, m.name)).length,
    }))
  );
});

router.post("/modules", (req, res) => {
  try {
    const mod = createModule(req.body);
    const mats = listMaterials();
    res.status(201).json({ ...mod, materialCount: 0 });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/modules/:id", (req, res) => {
  try {
    const mod = updateModule(req.params.id, req.body);
    if (!mod) return res.status(404).json({ error: "Not found" });
    const mats = listMaterials();
    res.json({ ...mod, materialCount: mats.filter((x) => materialInModule(x, mod.name)).length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/modules/:id/archive", (req, res) => {
  const mod = archiveModule(req.params.id);
  if (!mod) return res.status(404).json({ error: "Not found" });
  res.json(mod);
});

router.post("/modules/:id/restore", (req, res) => {
  const mod = restoreModule(req.params.id);
  if (!mod) return res.status(404).json({ error: "Not found" });
  res.json(mod);
});

router.post("/modules/:id/duplicate", (req, res) => {
  try {
    const result = duplicateModule(req.params.id);
    if (!result) return res.status(404).json({ error: "Not found" });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/archive", (_req, res) => {
  const rows = db.prepare("SELECT * FROM projects WHERE status = 'archived' ORDER BY updated_at DESC").all();
  res.json(rows.map((r) => rowToProject(r, loadProjectItems(r.id))));
});

router.get("/settings", (_req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    companyName: obj.companyName || "Daogreen",
    contactPhone: obj.contactPhone || "",
    contactEmail: obj.contactEmail || "",
    contactTelegram: obj.contactTelegram || "",
    brandColor: obj.brandColor || "#116355",
    farmSectionOrder: obj.farmSectionOrder || "",
    farmSectionNames: obj.farmSectionNames || "",
    farmSections: obj.farmSections || "",
    farmSectionCatalogs: obj.farmSectionCatalogs || "",
    farmSectionVersions: obj.farmSectionVersions || "",
    stellageModuleCatalogs: obj.stellageModuleCatalogs || "",
    stellageModuleMeta: obj.stellageModuleMeta || "",
    materialCategories: obj.materialCategories || "",
    clientSectionsJson: obj.clientSectionsJson || "",
    refFarmSectionGroups: obj.refFarmSectionGroups || "",
    refTags: obj.refTags || "",
    refUnits: obj.refUnits || "",
    refPurchaseStatuses: obj.refPurchaseStatuses || "",
    refResponsibleRoles: obj.refResponsibleRoles || "",
    refFarmTypes: obj.refFarmTypes || "",
    refStellageGroups: obj.refStellageGroups || "",
    clientLinkTtlDays: obj.clientLinkTtlDays || "0",
    logoUrl: obj.logoUrl || "",
    ...brandSettingsResponse(obj),
    ...publishRulesSettingsPayload(obj),
  });
});

router.get("/backup", (_req, res) => {
  const p = getDbPath();
  if (!fs.existsSync(p)) return res.status(404).json({ error: "DB not found" });
  res.download(p, `daogreen-backup-${new Date().toISOString().slice(0, 10)}.db`);
});

router.get("/analytics", (_req, res) => {
  res.json(getAnalytics());
});

router.get("/reports", (_req, res) => {
  res.json(getReportsR1Payload());
});

router.get("/admin-users", (_req, res) => {
  res.json(listAdminUsers());
});

router.post("/admin-users", (req, res) => {
  const { name, apiKey, active } = req.body;
  if (!name?.trim() || !apiKey?.trim()) return res.status(400).json({ error: "name and apiKey required" });
  res.status(201).json(upsertAdminUser({ name: name.trim(), apiKey: apiKey.trim(), active: active !== false }));
});

router.delete("/admin-users/:id", (req, res) => {
  deactivateAdminUser(req.params.id);
  res.json({ ok: true });
});

router.get("/projects/:id/documents", (req, res) => {
  const rows = db
    .prepare("SELECT id, type, filename, url, uploaded_at as uploadedAt FROM files WHERE project_id = ? ORDER BY uploaded_at DESC")
    .all(req.params.id);
  res.json(
    rows.map((r) => ({
      ...r,
      accessUrl: `/api/admin/files/${r.id}`,
    })),
  );
});

router.get("/files/:fileId", (req, res) => {
  const row = db
    .prepare("SELECT id, project_id, type, filename, url FROM files WHERE id = ?")
    .get(req.params.fileId);
  if (!row) return res.status(404).json({ error: "Not found" });
  const inline = /\.(png|jpe?g|webp|pdf)$/i.test(row.filename || row.url || "");
  return sendSafeUploadFile(res, {
    url: row.url,
    filename: row.filename,
    inline,
    cacheControl: "private, no-store",
  });
});

router.post("/projects/:id/documents", docUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  try {
    assertValidDocumentUpload(req.file);
    const id = nanoid(12);
    const ext = path.extname(req.file.originalname).toLowerCase() || "";
    const filename = `${nanoid(10)}${ext}`;
    const url = await saveFile(req.file.buffer, filename, {
      visibility: "private",
      subdir: `projects/${req.params.id}`,
    });
    const type = req.body.type || "other";
    db.prepare(
      "INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, ?, ?, ?)",
    ).run(id, req.params.id, type, req.file.originalname, url);
    res.status(201).json({
      id,
      type,
      filename: req.file.originalname,
      url,
      accessUrl: `/api/admin/files/${id}`,
      uploadedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof UploadValidationError) {
      return res.status(e.status || 400).json({ error: e.code, code: e.code, message: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

router.delete("/documents/:id", (req, res) => {
  const row = db.prepare("SELECT id, url FROM files WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  try {
    assertCanDeleteOrOverwriteAsset({ url: row.url });
  } catch (e) {
    if (e.code === "ASSET_PINNED_BY_RELEASE") {
      return res.status(409).json({ error: e.message, code: e.code, details: e.details });
    }
    throw e;
  }
  // Remove DB row; delete binary only when not pinned (already asserted).
  try {
    deleteLocalUploadFile(row.url);
  } catch (e) {
    if (e.code === "ASSET_PINNED_BY_RELEASE") {
      return res.status(409).json({ error: e.message, code: e.code, details: e.details });
    }
    if (e.code !== "INVALID_UPLOAD_URL") throw e;
  }
  db.prepare("DELETE FROM files WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

/** Delete a local /uploads asset by URL (scheme/rack images not tracked in files table). */
router.delete("/uploads", (req, res) => {
  const url = String(req.query.url || req.body?.url || "").trim();
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const result = deleteLocalUploadFile(url);
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.code === "ASSET_PINNED_BY_RELEASE") {
      return res.status(409).json({ error: e.message, code: e.code, details: e.details });
    }
    if (e.code === "INVALID_UPLOAD_URL") {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    throw e;
  }
});

router.patch("/settings", (req, res) => {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, typeof value === "string" ? value : JSON.stringify(value ?? ""));
  }
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    companyName: obj.companyName || "Daogreen",
    contactPhone: obj.contactPhone || "",
    contactEmail: obj.contactEmail || "",
    contactTelegram: obj.contactTelegram || "",
    brandColor: obj.brandColor || "#116355",
    farmSectionOrder: obj.farmSectionOrder || "",
    farmSectionNames: obj.farmSectionNames || "",
    farmSections: obj.farmSections || "",
    farmSectionCatalogs: obj.farmSectionCatalogs || "",
    farmSectionVersions: obj.farmSectionVersions || "",
    stellageModuleCatalogs: obj.stellageModuleCatalogs || "",
    stellageModuleMeta: obj.stellageModuleMeta || "",
    materialCategories: obj.materialCategories || "",
    clientSectionsJson: obj.clientSectionsJson || "",
    refFarmSectionGroups: obj.refFarmSectionGroups || "",
    refTags: obj.refTags || "",
    refUnits: obj.refUnits || "",
    refPurchaseStatuses: obj.refPurchaseStatuses || "",
    refResponsibleRoles: obj.refResponsibleRoles || "",
    refFarmTypes: obj.refFarmTypes || "",
    refStellageGroups: obj.refStellageGroups || "",
    clientLinkTtlDays: obj.clientLinkTtlDays || "0",
    logoUrl: obj.logoUrl || "",
    ...brandSettingsResponse(obj),
    ...publishRulesSettingsPayload(obj),
  });
});

/** Read-only uploads inventory — never deletes or mutates files. */
router.get("/storage/inventory", (req, res) => {
  if (isStorageInventoryScanning()) {
    return res.status(409).json({ error: "Scan in progress", code: "STORAGE_SCAN_IN_PROGRESS" });
  }
  const result = queryStorageInventory(req.query || {});
  res.json(result);
});

router.post("/storage/inventory/scan", async (req, res) => {
  try {
    if (isStorageInventoryScanning()) {
      return res.status(409).json({ error: "Scan in progress", code: "STORAGE_SCAN_IN_PROGRESS" });
    }
    const maxFiles = req.body?.maxFiles;
    const timeoutMs = req.body?.timeoutMs;
    const full = await runStorageInventoryScan({ maxFiles, timeoutMs });
    // Return summary + first page by default (full list available via GET with filters)
    const page = queryStorageInventory({ page: 1, pageSize: Number(req.body?.pageSize) || 50 });
    res.json({
      ok: true,
      readOnly: true,
      summary: full.summary,
      scanMeta: {
        scanStartedAt: full.summary?.scanStartedAt,
        scanCompletedAt: full.summary?.scanCompletedAt,
        durationMs: full.summary?.durationMs,
        timedOut: full.timedOut,
        truncated: full.truncated,
      },
      ...page,
      files: page.files,
      duplicateGroupDetails: full.summary?.duplicateGroupDetails || [],
      lastScanAvailable: !!getLastStorageInventory(),
    });
  } catch (e) {
    if (e.code === "STORAGE_SCAN_IN_PROGRESS") {
      return res.status(409).json({ error: e.message, code: e.code });
    }
    res.status(500).json({ error: e.message || "Scan failed" });
  }
});

router.get("/storage/inventory/file", (req, res) => {
  const assetPath = String(req.query?.assetPath || req.query?.url || "").trim();
  if (!assetPath.startsWith("/uploads/")) {
    return res.status(400).json({ error: "assetPath must be a /uploads/ URL", code: "INVALID_ASSET_PATH" });
  }
  // Reject absolute / traversal attempts
  if (assetPath.includes("..") || assetPath.includes("\\") || /^[A-Za-z]:/.test(assetPath)) {
    return res.status(400).json({ error: "Invalid assetPath", code: "INVALID_ASSET_PATH" });
  }
  const last = getLastStorageInventory();
  if (!last) {
    return res.status(404).json({ error: "No scan result", code: "NEEDS_SCAN" });
  }
  const file = last.files.find((f) => f.assetPath === assetPath || f.url === assetPath);
  if (!file) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, readOnly: true, file: sanitizeInventoryFile(file) });
});

function quarantineHttpError(res, e) {
  const status = e.status || (e.code === "NOT_FOUND" ? 404 : 400);
  return res.status(status).json({
    error: e.message || "Quarantine error",
    code: e.code || "STORAGE_QUARANTINE_ERROR",
    details: e.details || undefined,
  });
}

/** Preview eligible pure ORPHANs for quarantine (no move). */
router.post("/storage/quarantine/preview", async (req, res) => {
  try {
    const assetPaths = req.body?.assetPaths || req.body?.paths || [];
    const actor = req.adminUser?.id || req.adminUser?.login || "admin";
    const result = await previewQuarantine({ assetPaths, actor });
    res.json(result);
  } catch (e) {
    quarantineHttpError(res, e);
  }
});

/** Move confirmed pure ORPHANs into quarantine (all-or-nothing). */
router.post("/storage/quarantine", async (req, res) => {
  try {
    const actor = req.adminUser?.id || req.adminUser?.login || "admin";
    const result = await executeQuarantine({
      assetPaths: req.body?.assetPaths || req.body?.paths || [],
      confirmationToken: req.body?.confirmationToken,
      confirmationPhrase: req.body?.confirmationPhrase,
      actor,
      reason: req.body?.reason || "pure ORPHAN",
    });
    res.json(result);
  } catch (e) {
    quarantineHttpError(res, e);
  }
});

router.get("/storage/quarantine", (req, res) => {
  try {
    const result = listQuarantine({
      status: req.query?.status || "QUARANTINED",
      page: req.query?.page,
      pageSize: req.query?.pageSize,
    });
    res.json(result);
  } catch (e) {
    quarantineHttpError(res, e);
  }
});

router.post("/storage/quarantine/:id/restore", async (req, res) => {
  try {
    const actor = req.adminUser?.id || req.adminUser?.login || "admin";
    const result = await restoreQuarantinedFile(req.params.id, { actor });
    res.json(result);
  } catch (e) {
    quarantineHttpError(res, e);
  }
});

export default router;
