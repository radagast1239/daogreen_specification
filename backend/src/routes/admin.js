import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { nanoid } from "nanoid";
import { fileURLToPath } from "url";
import { db, getDbPath } from "../db.js";
import { listMaterials, listModulesAdmin, createModule, updateModule, archiveModule, restoreModule, duplicateModule } from "./materials.js";
import { loadProject, loadProjectItems, rowToProject } from "../db.js";
import { projectTotals } from "../services/buildItems.js";
import { getAnalytics } from "../services/analytics.js";
import { listAdminUsers, upsertAdminUser, deactivateAdminUser } from "../auth.js";
import { brandSettingsResponse } from "../services/clientBrand.js";
import { publishRulesSettingsPayload } from "../services/publishRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "../uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const docUpload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, uploadDir),
    filename: (_r, file, cb) => cb(null, `${nanoid(10)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
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
      materialCount: mats.filter((x) => x.module === m.name).length,
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
    res.json({ ...mod, materialCount: mats.filter((x) => x.module === mod.name).length });
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
    materialCategories: obj.materialCategories || "",
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
  res.json(rows);
});

router.post("/projects/:id/documents", docUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  const id = nanoid(12);
  const url = `/uploads/${req.file.filename}`;
  const type = req.body.type || "other";
  db.prepare(
    "INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.params.id, type, req.file.originalname, url);
  res.status(201).json({ id, type, filename: req.file.originalname, url, uploadedAt: new Date().toISOString() });
});

router.delete("/documents/:id", (req, res) => {
  db.prepare("DELETE FROM files WHERE id = ?").run(req.params.id);
  res.status(204).end();
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
    materialCategories: obj.materialCategories || "",
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

export default router;