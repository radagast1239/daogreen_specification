import { Router } from "express";
import { db } from "../db.js";
import { listMaterials, listModules } from "./materials.js";
import { loadProject, loadProjectItems, rowToProject } from "../db.js";
import { projectTotals } from "../services/buildItems.js";

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