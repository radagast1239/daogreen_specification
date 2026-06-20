import { Router } from "express";
import { db } from "../db.js";
import { listMaterials, listModules } from "./materials.js";
import { loadProject, loadProjectItems, rowToProject } from "../db.js";
import { projectTotals } from "../services/buildItems.js";

const router = Router();

router.get("/clients", (_req, res) => {
  const rows = db.prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY client, name").all();
  const map = new Map();
  for (const r of rows) {
    const key = (r.client || "Без имени").trim();
    if (!map.has(key)) map.set(key, { name: key, projects: [], city: r.city });
    const items = loadProjectItems(r.id);
    const t = projectTotals(items);
    map.get(key).projects.push({
      ...rowToProject(r, []),
      totals: t,
    });
  }
  res.json([...map.values()]);
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
  const modules = listModules();
  const mats = listMaterials();
  res.json(
    modules.map((m) => ({
      ...m,
      materialCount: mats.filter((x) => x.module === m.name).length,
    }))
  );
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
  });
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
  });
});

export default router;
