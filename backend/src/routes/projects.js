import { Router } from "express";
import {
  db,
  loadProject,
  loadProjectByToken,
  loadProjectItems,
  rowToProject,
} from "../db.js";
import {
  uid,
  clientToken,
  buildItemsFromModules,
  compareVersions,
  projectTotals,
} from "../services/buildItems.js";
import { listMaterials, listModules } from "./materials.js";
import { validateProjectForPublish } from "../services/analytics.js";

const router = Router();

const INSERT_PROJECT = db.prepare(`
  INSERT INTO projects (
    id, name, client, city, area, height, sowing_area, type, currency, vat, comment,
    status, client_token, selected_modules, zones, stellage_configs, manual_params, rooms, version
  ) VALUES (
    @id, @name, @client, @city, @area, @height, @sowing_area, @type, @currency, @vat, @comment,
    @status, @client_token, @selected_modules, @zones, @stellage_configs, @manual_params, @rooms, @version
  )
`);

const UPDATE_PROJECT = db.prepare(`
  UPDATE projects SET
    name=@name, client=@client, city=@city, area=@area, height=@height,
    sowing_area=@sowing_area, type=@type, currency=@currency, vat=@vat, comment=@comment,
    status=@status, selected_modules=@selected_modules, zones=@zones,
    stellage_configs=@stellage_configs, manual_params=@manual_params, rooms=@rooms, version=@version,
    last_client_activity_at=@last_client_activity_at, updated_at=datetime('now')
  WHERE id=@id
`);

const INSERT_ITEM = db.prepare(`
  INSERT INTO project_items (
    id, project_id, material_id, module, section, name, unit, category,
    supplier, link, link_alt, photo_url, client_note, tech_note,
    qty, price, vat_rate, visible, approved, enabled, needs_approval,
    status, actual_price, client_comment, sort_order, responsible,
    cooling_kw, cooling_btu, exhaust_m3, room_id, internal_note, delivery_days, item_role
  ) VALUES (
    @id, @project_id, @material_id, @module, @section, @name, @unit, @category,
    @supplier, @link, @link_alt, @photo_url, @client_note, @tech_note,
    @qty, @price, @vat_rate, @visible, @approved, @enabled, @needs_approval,
    @status, @actual_price, @client_comment, @sort_order, @responsible,
    @cooling_kw, @cooling_btu, @exhaust_m3, @room_id, @internal_note, @delivery_days, @item_role
  )
`);

const UPDATE_ITEM = db.prepare(`
  UPDATE project_items SET
    module=@module, section=@section, name=@name, unit=@unit, category=@category,
    supplier=@supplier, link=@link, link_alt=@link_alt, photo_url=@photo_url,
    client_note=@client_note, tech_note=@tech_note,
    qty=@qty, price=@price, vat_rate=@vat_rate,
    visible=@visible, approved=@approved, enabled=@enabled, needs_approval=@needs_approval,
    status=@status, actual_price=@actual_price, client_comment=@client_comment,
    responsible=@responsible, cooling_kw=@cooling_kw, cooling_btu=@cooling_btu, exhaust_m3=@exhaust_m3,
    room_id=@room_id, internal_note=@internal_note, delivery_days=@delivery_days, item_role=@item_role
  WHERE id=@id AND project_id=@project_id
`);

function itemToParams(it, projectId) {
  return {
    id: it.id,
    project_id: projectId,
    material_id: it.materialId || null,
    module: it.module,
    section: it.section || it.module,
    name: it.name,
    unit: it.unit || "шт.",
    category: it.category || "Прочее",
    supplier: it.supplier || "",
    link: it.link || "",
    link_alt: it.linkAlt || "",
    photo_url: it.imageUrl || it.photoUrl || "",
    client_note: it.clientNote || it.comment || "",
    tech_note: it.techNote || "",
    qty: Number(it.qty) || 0,
    price: Number(it.price) || 0,
    vat_rate: Number(it.vatRate) || 0,
    visible: it.visible !== false ? 1 : 0,
    approved: it.approved ? 1 : 0,
    enabled: it.enabled === false || (Number(it.qty) || 0) === 0 ? 0 : 1,
    needs_approval: it.needsApproval ? 1 : 0,
    status: it.status || "not_bought",
    actual_price: it.actualPrice != null ? Number(it.actualPrice) : null,
    client_comment: it.clientComment || "",
    sort_order: it.sortOrder || 0,
    responsible: it.responsible || "general",
    cooling_kw: Number(it.coolingKw) || 0,
    cooling_btu: it.coolingBtu || "",
    exhaust_m3: Number(it.exhaustM3) || 0,
    room_id: it.roomId || "",
    internal_note: it.internalNote || "",
    delivery_days: Number(it.deliveryDays) || 0,
    item_role: it.itemRole || "purchase",
  };
}

function saveItems(projectId, items) {
  db.prepare("DELETE FROM project_items WHERE project_id = ?").run(projectId);
  for (const it of items) INSERT_ITEM.run(itemToParams(it, projectId));
}

function projectRow(p) {
  return {
    id: p.id,
    name: p.name,
    client: p.client || "",
    city: p.city || "",
    area: Number(p.area) || 0,
    height: Number(p.height) || 0,
    sowing_area: Number(p.sowingArea) || 0,
    type: p.type || "проточка",
    currency: p.currency || "₽",
    vat: p.vat ? 1 : 0,
    comment: p.comment || "",
    status: p.status || "active",
    client_token: p.clientToken || clientToken(),
    selected_modules: JSON.stringify(p.selectedModules || []),
    zones: JSON.stringify(p.zones || []),
    stellage_configs: JSON.stringify(p.stellageConfigs || []),
    manual_params: JSON.stringify(p.manualParams || {}),
    rooms: JSON.stringify(p.rooms || []),
    version: p.version || 1,
    last_client_activity_at: p.lastClientActivityAt || null,
  };
}

function projectInsertRow(p) {
  const r = projectRow(p);
  const { last_client_activity_at, ...insert } = r;
  return insert;
}

function projectUpdateRow(p) {
  const r = projectRow(p);
  const { client_token, ...update } = r;
  return update;
}

function updateItemParams(it, projectId) {
  const p = itemToParams(it, projectId);
  const { material_id, sort_order, ...update } = p;
  return update;
}

export function listProjects() {
  const rows = db.prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY created_at DESC").all();
  return rows.map((r) => {
    const items = loadProjectItems(r.id);
    const t = projectTotals(items);
    return { ...rowToProject(r, []), itemCount: items.length, totals: t };
  });
}

export function createProject(body) {
  const materials = listMaterials();
  const modules = listModules();
  const selected = body.selectedModules || [];
  const items = body.items?.length
    ? body.items
    : buildItemsFromModules(materials, modules, selected);

  const id = uid("p");
  INSERT_PROJECT.run(projectInsertRow({
    ...body,
    id,
    clientToken: clientToken(),
    selectedModules: selected,
  }));
  saveItems(id, items);
  return loadProject(id);
}

export function updateProject(id, patch) {
  const cur = loadProject(id);
  if (!cur) return null;
  const merged = { ...cur, ...patch, id };
  const row = projectUpdateRow(merged);
  UPDATE_PROJECT.run(row);
  if (patch.items) saveItems(id, patch.items);
  return loadProject(id);
}

export function deleteProject(id) {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function duplicateProject(id) {
  const src = loadProject(id);
  if (!src) return null;
  return createProject({
    ...src,
    name: src.name + " (копия)",
    items: src.items.map((it) => ({ ...it, id: uid("it") })),
  });
}

export function approveAll(id) {
  const p = loadProject(id);
  if (!p) return null;
  const items = p.items.map((it) => ({ ...it, approved: true }));
  saveItems(id, items);
  return loadProject(id);
}

export function createVersion(id, createdBy = "admin", { force = false } = {}) {
  const p = loadProject(id);
  if (!p) return null;
  if (!force) {
    const check = validateProjectForPublish(id);
    if (!check.ok) {
      const err = new Error("Publish validation failed");
      err.code = "PUBLISH_VALIDATION";
      err.problems = check.problems;
      throw err;
    }
  }
  const prev = db
    .prepare("SELECT * FROM spec_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1")
    .get(id);
  const prevSnapshot = prev ? JSON.parse(prev.snapshot) : [];
  const summary = compareVersions(prevSnapshot, p.items);
  const versionNumber = (prev?.version_number || p.version || 0) + 1;

  const versionId = uid("v");
  db.prepare(`
    INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(versionId, id, versionNumber, createdBy, JSON.stringify(summary), JSON.stringify(p.items));

  db.prepare("UPDATE projects SET version = ?, updated_at = datetime('now') WHERE id = ?").run(
    versionNumber,
    id
  );

  return {
    id: versionId,
    projectId: id,
    versionNumber,
    summary,
    createdAt: new Date().toISOString(),
    createdBy,
  };
}

export function listVersions(id) {
  return db
    .prepare("SELECT * FROM spec_versions WHERE project_id = ? ORDER BY version_number DESC")
    .all(id)
    .map((r) => ({
      id: r.id,
      projectId: r.project_id,
      versionNumber: r.version_number,
      createdAt: r.created_at,
      createdBy: r.created_by,
      summary: JSON.parse(r.summary || "{}"),
    }));
}

export function patchItem(projectId, itemId, patch) {
  const p = loadProject(projectId);
  if (!p) return null;
  const items = p.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  if (patch.qty !== undefined && patch.qty === 0) item.enabled = false;
  UPDATE_ITEM.run(updateItemParams(item, projectId));
  return item;
}

export function addItem(projectId, item) {
  const it = { ...item, id: item.id || uid("it") };
  INSERT_ITEM.run(itemToParams(it, projectId));
  return it;
}

export function removeItem(projectId, itemId) {
  db.prepare("DELETE FROM project_items WHERE id = ? AND project_id = ?").run(itemId, projectId);
}

export function getDashboard() {
  const projects = listProjects();
  const materials = listMaterials();
  const problems = [];
  let noPhoto = 0;
  let noPrice = 0;
  let noLink = 0;

  for (const m of materials) {
    if (!m.photoUrl) noPhoto++;
    if (!m.basePrice) noPrice++;
    if (!m.link) noLink++;
  }

  for (const p of projects) {
    const full = loadProject(p.id);
    const help = full.items.filter((i) => i.status === "need_help" && i.approved && i.visible);
    if (help.length) problems.push({ projectId: p.id, name: p.name, type: "need_help", count: help.length });
    const stale = p.lastClientActivityAt
      ? Date.now() - new Date(p.lastClientActivityAt).getTime() > 14 * 864e5
      : true;
    if (stale && p.totals?.progress < 100)
      problems.push({ projectId: p.id, name: p.name, type: "inactive_client", days: 14 });
  }

  return {
    projectCount: projects.length,
    materialCount: materials.length,
    noPhoto,
    noPrice,
    noLink,
    problems,
    projects,
  };
}

// Express routes
const api = Router();

api.get("/", (_req, res) => res.json(listProjects()));

api.get("/dashboard/summary", (_req, res) => {
  const d = getDashboard();
  res.json(d);
});

api.get("/:id", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
});

api.post("/", (req, res) => {
  try {
    res.status(201).json(createProject(req.body));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.patch("/:id", (req, res) => {
  const p = updateProject(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
});

api.delete("/:id", (req, res) => {
  deleteProject(req.params.id);
  res.status(204).end();
});

api.post("/:id/duplicate", (req, res) => {
  const p = duplicateProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.status(201).json(p);
});

api.post("/:id/approve-all", (req, res) => {
  const p = approveAll(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(p);
});

api.post("/:id/versions", (req, res) => {
  try {
    const v = createVersion(req.params.id, req.body?.createdBy, { force: !!req.body?.force });
    if (!v) return res.status(404).json({ error: "Not found" });
    res.status(201).json(v);
  } catch (e) {
    if (e.code === "PUBLISH_VALIDATION") {
      return res.status(422).json({ error: e.message, problems: e.problems });
    }
    throw e;
  }
});

api.get("/:id/publish-check", (req, res) => {
  res.json(validateProjectForPublish(req.params.id));
});

api.get("/:id/versions", (req, res) => {
  res.json(listVersions(req.params.id));
});

api.patch("/:id/items/:itemId", (req, res) => {
  const it = patchItem(req.params.id, req.params.itemId, req.body);
  if (!it) return res.status(404).json({ error: "Not found" });
  res.json(it);
});

api.post("/:id/items", (req, res) => {
  const it = addItem(req.params.id, req.body);
  res.status(201).json(it);
});

api.delete("/:id/items/:itemId", (req, res) => {
  removeItem(req.params.id, req.params.itemId);
  res.status(204).end();
});

function linkExpiresAt() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'clientLinkTtlDays'").get();
  const days = Number(row?.value) || 0;
  if (!days) return "";
  return new Date(Date.now() + days * 86400000).toISOString();
}

api.post("/:id/regenerate-token", (req, res) => {
  const token = clientToken();
  const expires = linkExpiresAt();
  db.prepare(
    "UPDATE projects SET client_token = ?, client_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(token, expires, req.params.id);
  res.json({ clientToken: token, clientTokenExpiresAt: expires });
});

api.post("/:id/archive", (req, res) => {
  db.prepare("UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

api.post("/:id/restore", (req, res) => {
  db.prepare("UPDATE projects SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default api;

function loadBrandingSettings() {
  const keys = ["companyName", "contactPhone", "contactEmail", "contactTelegram", "brandColor"];
  const rows = db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`)
    .all(...keys);
  const branding = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    companyName: branding.companyName || "Daogreen",
    contactPhone: branding.contactPhone || "",
    contactEmail: branding.contactEmail || "",
    contactTelegram: branding.contactTelegram || "",
    brandColor: branding.brandColor || "#116355",
  };
}

function serveClientProject(req, res) {
  const p = loadProjectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const versions = listVersions(p.id);
  const documents = db
    .prepare("SELECT id, type, filename, url, uploaded_at as uploadedAt FROM files WHERE project_id = ? ORDER BY uploaded_at DESC")
    .all(p.id);
  res.json({ project: p, versionInfo: versions[0] || null, branding: loadBrandingSettings(), documents });
}

function patchClientItem(req, res) {
  const p = loadProjectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const allowed = ["status", "actualPrice", "clientComment"];
  const patch = {};
  for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
  const it = patchItem(p.id, req.params.itemId, patch);
  const bought = ["bought", "delivered", "have"].includes(patch.status);
  if (bought && !p.purchaseStartedAt) {
    db.prepare("UPDATE projects SET purchase_started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(
      p.id
    );
  }
  db.prepare(
    "UPDATE projects SET last_client_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(p.id);
  res.json(it);
}

function patchClientCooling(req, res) {
  const p = loadProjectByToken(req.params.token);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const sf = Number(req.body?.safetyFactor);
  if (!Number.isFinite(sf) || sf < 1 || sf > 2.5) {
    return res.status(400).json({ error: "Invalid safetyFactor" });
  }
  const mp = typeof p.manualParams === "object" && p.manualParams ? { ...p.manualParams } : {};
  const cf = mp.coolingFarm && typeof mp.coolingFarm === "object" ? { ...mp.coolingFarm } : {};
  cf.safetyFactor = sf;
  mp.coolingFarm = cf;
  db.prepare("UPDATE projects SET manual_params = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(mp),
    p.id
  );
  res.json({ manualParams: mp });
}

// Client router — основной путь /api/client/p/:token
export const clientRouter = Router();

clientRouter.get("/p/:token", serveClientProject);
clientRouter.patch("/p/:token/items/:itemId", patchClientItem);
clientRouter.patch("/p/:token/cooling", patchClientCooling);
clientRouter.get("/:token", serveClientProject);
clientRouter.patch("/:token/items/:itemId", patchClientItem);
clientRouter.patch("/:token/cooling", patchClientCooling);
