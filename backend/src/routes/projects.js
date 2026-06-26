import { Router } from "express";
import {
  db,
  loadProject,
  loadProjectByToken,
  loadProjectItems,
  loadSlimItemsForProjects,
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
import { validateProjectForPublish, validateProjectForPublishFromItems } from "../services/publishRules.js";
import { getAnalytics } from "../services/analytics.js";
import {
  listActivity,
  logItemPatch,
  logProjectEvent,
  sanitizeItemForClient,
  sanitizeProjectForClient,
} from "../services/activityLog.js";
import { clientPurchaseStatuses } from "../services/referenceData.js";
import { clientAuthMiddleware } from "../services/clientAuth.js";
import { loadClientBrand } from "../services/clientBrand.js";
import { clientCatalogForProject } from "../services/clientCatalog.js";
import { normalizePipeCuts, resolvePipeCuts } from "../../../shared/profilePipeCuts.js";
import { normalizeBreakerSpecs, resolveBreakerSpecs } from "../../../shared/breakerSpecs.js";
import {
  normalizeFlowSpecs,
  resolveFlowSpecs,
  aggregateFlowM3,
  primaryFlowLink,
  isFlowSpecName,
} from "../../../shared/flowSpecs.js";
import {
  normalizeSplitSpecs,
  resolveSplitSpecs,
  aggregateSplitCoolingKw,
  isSplitSystemName,
} from "../../../shared/splitSpecs.js";
import { structuredClientNote } from "../../../shared/structuredClientNote.js";
import { itemFlagsToDb, normalizeItemFlags, resolveItemType, lineVisibleToClient } from "../../../shared/itemTypes.js";
import {
  getMaterialById,
  patchFromMaterial,
  resolveRefreshFields,
} from "../services/refreshItemFromMaterial.js";
import {
  cloneProjectItem,
  cloneProjectItemsWithIdMap,
  remapRoomsSelectedItemIds,
  stripProjectForClone,
  templateItemFromProjectItem,
} from "../../../shared/projectItemClone.js";
import { compareProjectItems } from "../../../shared/projectCompare.js";
import { buildImportPreview } from "../../../shared/importFromProject.js";

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
    cooling_kw, cooling_btu, exhaust_m3, room_id, internal_note, delivery_days, item_role, pipe_cuts, breaker_specs, flow_specs, split_specs,     client_section, client_subsection,
    included_in_project, visible_to_client, item_type, subcategory, purchase_key,
    purchase_priority, replacement_link, replacement_photo_url, replacement_price,
    replacement_comment, replacement_proposed_at
  ) VALUES (
    @id, @project_id, @material_id, @module, @section, @name, @unit, @category,
    @supplier, @link, @link_alt, @photo_url, @client_note, @tech_note,
    @qty, @price, @vat_rate, @visible, @approved, @enabled, @needs_approval,
    @status, @actual_price, @client_comment, @sort_order, @responsible,
    @cooling_kw, @cooling_btu, @exhaust_m3, @room_id, @internal_note, @delivery_days, @item_role, @pipe_cuts, @breaker_specs, @flow_specs, @split_specs,     @client_section, @client_subsection,
    @included_in_project, @visible_to_client, @item_type, @subcategory, @purchase_key,
    @purchase_priority, @replacement_link, @replacement_photo_url, @replacement_price,
    @replacement_comment, @replacement_proposed_at
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
    room_id=@room_id, internal_note=@internal_note, delivery_days=@delivery_days, item_role=@item_role,
    pipe_cuts=@pipe_cuts, breaker_specs=@breaker_specs, flow_specs=@flow_specs, split_specs=@split_specs,
    client_section=@client_section, client_subsection=@client_subsection,
    included_in_project=@included_in_project, visible_to_client=@visible_to_client, item_type=@item_type,
    subcategory=@subcategory, purchase_key=@purchase_key,
    purchase_priority=@purchase_priority, replacement_link=@replacement_link,
    replacement_photo_url=@replacement_photo_url, replacement_price=@replacement_price,
    replacement_comment=@replacement_comment, replacement_proposed_at=@replacement_proposed_at
  WHERE id=@id AND project_id=@project_id
`);

function itemToParams(it, projectId) {
  const normalized = normalizeItemFlags(it);
  const flags = itemFlagsToDb(normalized);
  const cuts = normalizePipeCuts(normalized.pipeCuts ?? resolvePipeCuts(normalized));
  const breakerSpecs = normalizeBreakerSpecs(normalized.breakerSpecs ?? resolveBreakerSpecs(normalized));
  const flowSpecs = normalizeFlowSpecs(normalized.flowSpecs ?? resolveFlowSpecs(normalized));
  const splitSpecs = normalizeSplitSpecs(normalized.splitSpecs ?? resolveSplitSpecs(normalized));
  const enriched = { ...normalized, pipeCuts: cuts, breakerSpecs, flowSpecs, splitSpecs };
  const clientNote = structuredClientNote(enriched);
  let link = normalized.link || "";
  let coolingKw = Number(normalized.coolingKw) || 0;
  let exhaustM3 = Number(normalized.exhaustM3) || 0;
  if (isFlowSpecName(normalized.name)) {
    exhaustM3 = aggregateFlowM3(flowSpecs);
    link = primaryFlowLink(flowSpecs, link);
  }
  if (isSplitSystemName(normalized.name)) {
    coolingKw = aggregateSplitCoolingKw(splitSpecs);
  }
  return {
    id: normalized.id,
    project_id: projectId,
    material_id: normalized.materialId || null,
    module: normalized.module,
    section: normalized.section || normalized.module,
    name: normalized.name,
    unit: normalized.unit || "шт.",
    category: normalized.category || "Прочее",
    supplier: normalized.supplier || "",
    link,
    link_alt: normalized.linkAlt || "",
    photo_url: normalized.imageUrl || normalized.photoUrl || "",
    client_note: clientNote,
    tech_note: normalized.techNote || "",
    qty: Number(normalized.qty) || 0,
    price: Number(normalized.price) || 0,
    vat_rate: Number(normalized.vatRate) || 0,
    visible: flags.visible,
    approved: flags.approved,
    enabled: flags.enabled,
    needs_approval: normalized.needsApproval ? 1 : 0,
    status: normalized.status || "not_bought",
    actual_price: normalized.actualPrice != null ? Number(normalized.actualPrice) : null,
    client_comment: normalized.clientComment || "",
    sort_order: normalized.sortOrder || 0,
    responsible: normalized.responsible || "general",
    cooling_kw: coolingKw,
    cooling_btu: normalized.coolingBtu || "",
    exhaust_m3: exhaustM3,
    room_id: normalized.roomId || "",
    internal_note: normalized.internalNote || "",
    delivery_days: Number(normalized.deliveryDays) || 0,
    item_role: normalized.itemRole || "purchase",
    pipe_cuts: JSON.stringify(cuts),
    breaker_specs: JSON.stringify(breakerSpecs),
    flow_specs: JSON.stringify(flowSpecs),
    split_specs: JSON.stringify(splitSpecs),
    client_section: normalized.clientSection || "",
    client_subsection: normalized.clientSubsection || "",
    included_in_project: flags.included_in_project,
    visible_to_client: flags.visible_to_client,
    item_type: resolveItemType(normalized),
    subcategory: normalized.subcategory || "",
    purchase_key: normalized.purchaseKey || normalized.purchase_key || "",
    purchase_priority: normalized.purchasePriority || "",
    replacement_link: normalized.replacementLink || "",
    replacement_photo_url: normalized.replacementPhotoUrl || "",
    replacement_price:
      normalized.replacementPrice != null && normalized.replacementPrice !== ""
        ? Number(normalized.replacementPrice)
        : null,
    replacement_comment: normalized.replacementComment || "",
    replacement_proposed_at: normalized.replacementProposedAt || "",
  };
}

function saveItems(projectId, items) {
  const run = db.transaction((pid, list) => {
    db.prepare("DELETE FROM project_items WHERE project_id = ?").run(pid);
    for (const it of list) INSERT_ITEM.run(itemToParams(it, pid));
  });
  run(projectId, items);
}

export function saveItemsAppend(projectId, items) {
  const maxSort = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) as m FROM project_items WHERE project_id = ?")
    .get(projectId)?.m || 0;
  let order = maxSort + 1;
  for (const it of items) {
    const row = itemToParams({ ...it, sortOrder: it.sortOrder ?? order++ }, projectId);
    INSERT_ITEM.run(row);
  }
  touchProject(projectId);
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
  const itemsByProject = loadSlimItemsForProjects(rows.map((r) => r.id));
  return rows.map((r) => {
    const items = itemsByProject.get(r.id) || [];
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

export function duplicateProject(id, body = {}) {
  const src = loadProject(id);
  if (!src) return null;

  const mode = body.mode === "copy_as_is" ? "copy_as_is" : "new_purchase";
  const meta = stripProjectForClone(src, { mode });
  const { items, idMap } = cloneProjectItemsWithIdMap(src.items, {
    idGen: () => uid("it"),
    mode,
  });

  return createProject({
    ...meta,
    name: (body.name || `${src.name} (копия)`).trim(),
    client: body.client != null ? body.client : "",
    city: body.city != null ? body.city : src.city,
    area: body.area != null ? body.area : src.area,
    items,
    selectedModules: src.selectedModules,
    zones: src.zones,
    stellageConfigs: src.stellageConfigs,
    manualParams: src.manualParams,
    rooms: remapRoomsSelectedItemIds(src.rooms, idMap),
  });
}

function presetRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    presetType: row.preset_type,
    moduleName: row.module_name || "",
    items: JSON.parse(row.items_json || "[]"),
    note: row.note || "",
  };
}

export function previewImportToProject(targetId, body = {}) {
  const target = loadProject(targetId);
  const source = loadProject(body.sourceProjectId);
  if (!target || !source) return null;
  return buildImportPreview({
    sourceItems: source.items,
    targetItems: target.items,
    kind: body.kind || "section",
    module: body.module || "",
    itemIds: body.itemIds || [],
    targetModule: body.targetModule || body.module || "",
  });
}

export function importToProject(targetId, body = {}) {
  const target = loadProject(targetId);
  const source = loadProject(body.sourceProjectId);
  if (!target || !source) return null;

  const preview = previewImportToProject(targetId, body);
  const skipExisting = body.skipExisting !== false;
  const toAdd = skipExisting
    ? preview.added.map((r) => preview.toImport.find((i) => i.id === r.itemId))
    : preview.toImport;

  const targetModule = body.targetModule || body.module || "";
  const cloned = toAdd.filter(Boolean).map((it) => {
    const copy = cloneProjectItem(it, { newId: uid("it"), mode: "new_purchase" });
    if (targetModule) {
      copy.module = targetModule;
      copy.section = targetModule;
    }
    return copy;
  });

  if (!cloned.length) return { project: target, added: [], preview };
  saveItemsAppend(targetId, cloned);
  logProjectEvent({
    projectId: targetId,
    actor: "admin",
    summary: `Daogreen: импорт из «${source.name}» — ${cloned.length} поз.`,
    clientVisible: false,
  });
  return { project: loadProject(targetId), added: cloned, preview };
}

export function compareProjects(baseId, otherId) {
  const base = loadProject(baseId);
  const other = loadProject(otherId);
  if (!other || !base) return null;
  const diff = compareProjectItems(base.items, other.items);
  return {
    base: { id: base.id, name: base.name },
    other: { id: other.id, name: other.name },
    ...diff,
  };
}

export function saveSectionAsTemplate(projectId, module, { name, note = "" } = {}) {
  const p = loadProject(projectId);
  if (!p || !name?.trim()) return null;
  const items = (p.items || []).filter((it) => (it.module || "").trim() === (module || "").trim());
  if (!items.length) return null;

  const templateItems = items
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((it, idx) => ({ ...templateItemFromProjectItem(it), sortOrder: idx }));

  const id = uid("pr");
  db.prepare(`
    INSERT INTO spec_presets (
      id, name, preset_type, module_id, module_name, section_id, sort_order, items_json, params_json, note, updated_at
    ) VALUES (?, ?, 'project_section', '', ?, '', 0, ?, '{}', ?, datetime('now'))
  `).run(id, name.trim(), module, JSON.stringify(templateItems), note || "");

  logProjectEvent({
    projectId,
    actor: "admin",
    summary: `Daogreen: сохранён шаблон «${name.trim()}» (${module})`,
    clientVisible: false,
  });
  return presetRowToObj(db.prepare("SELECT * FROM spec_presets WHERE id = ?").get(id));
}

export function applySectionTemplate(projectId, templateId, { targetModule } = {}) {
  const p = loadProject(projectId);
  const row = db.prepare("SELECT * FROM spec_presets WHERE id = ? AND preset_type = 'project_section'").get(templateId);
  if (!p || !row) return null;

  const preset = presetRowToObj(row);
  const module = targetModule || preset.moduleName || "Импорт";
  const cloned = (preset.items || []).map((it, idx) =>
    cloneProjectItem(
      { ...it, module, section: module, sortOrder: (p.items?.length || 0) + idx },
      { newId: uid("it"), mode: "new_purchase" }
    )
  );

  saveItemsAppend(projectId, cloned);
  return { project: loadProject(projectId), added: cloned, preset };
}

export function listSectionTemplates() {
  return db
    .prepare("SELECT * FROM spec_presets WHERE preset_type = 'project_section' ORDER BY name")
    .all()
    .map(presetRowToObj);
}

export function approveAll(id) {
  const p = loadProject(id);
  if (!p) return null;
  const items = p.items.map((it) =>
    normalizeItemFlags({
      ...it,
      approved: true,
      visibleToClient: it.includedInProject !== false,
    })
  );
  saveItems(id, items);
  touchProject(id);
  return loadProject(id);
}

export function createVersion(id, createdBy = "admin", { force = false } = {}) {
  const p = loadProject(id);
  if (!p) return null;
  if (!force) {
    const check = validateProjectForPublish(id);
    if (check.status === "blocked") {
      const err = new Error("Publish validation failed");
      err.code = "PUBLISH_VALIDATION";
      err.problems = check.critical?.length ? check.critical : check.problems;
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

function touchProject(projectId) {
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
}

export function patchItem(projectId, itemId, patch) {
  const p = loadProject(projectId);
  if (!p) return null;
  let item = p.items.find((i) => i.id === itemId);
  if (!item) return null;
  item = normalizeItemFlags({ ...item, ...patch });
  if (patch.qty !== undefined && patch.qty === 0) item.includedInProject = false;
  UPDATE_ITEM.run(updateItemParams(item, projectId));
  touchProject(projectId);
  return item;
}

export function bulkPatchItems(projectId, { itemIds = [], patch = {} } = {}) {
  const p = loadProject(projectId);
  if (!p) return { updated: [], skipped: [], before: [] };
  const ids = new Set(itemIds);
  const updated = [];
  const skipped = [];
  const before = [];
  const found = new Set();
  for (const it of p.items) {
    if (!ids.has(it.id)) continue;
    found.add(it.id);
    before.push({ ...it });
    updated.push(patchItem(projectId, it.id, patch));
  }
  for (const id of ids) {
    if (!found.has(id)) skipped.push({ itemId: id, reason: "not_found" });
  }
  if (updated.length) touchProject(projectId);
  return { updated: updated.filter(Boolean), skipped, before, patch };
}

export function refreshItemsFromMaterial(projectId, { itemIds = [], fields = [] } = {}) {
  const p = loadProject(projectId);
  if (!p) return { updated: [], skipped: [] };
  const refreshFields = resolveRefreshFields(fields);
  const ids = itemIds.length ? itemIds : p.items.map((i) => i.id);
  const updated = [];
  const skipped = [];

  for (const itemId of ids) {
    const item = p.items.find((i) => i.id === itemId);
    if (!item?.materialId) {
      skipped.push({ itemId, reason: "no_material" });
      continue;
    }
    const mat = getMaterialById(item.materialId);
    if (!mat) {
      skipped.push({ itemId, reason: "material_missing" });
      continue;
    }
    const matPatch = patchFromMaterial(mat, refreshFields);
    if (!Object.keys(matPatch).length) {
      skipped.push({ itemId, reason: "no_fields" });
      continue;
    }
    updated.push(patchItem(projectId, itemId, matPatch));
  }

  return { updated, skipped };
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
  const rows = db
    .prepare("SELECT * FROM projects WHERE status != 'archived' ORDER BY created_at DESC")
    .all();
  const materials = listMaterials();
  const problems = [];
  const publishCheck = [];
  const needHelp = [];
  const inactiveClient = [];
  const stuckPurchase = [];
  let noPhoto = 0;
  let noPrice = 0;
  let noLink = 0;

  for (const m of materials) {
    if (!m.photoUrl && !m.imageUrl) noPhoto++;
    if (!m.basePrice) noPrice++;
    if (!m.link) noLink++;
  }

  const now = Date.now();
  const day = 86400000;
  const projects = [];

  for (const r of rows) {
    const items = loadProjectItems(r.id);
    const totals = projectTotals(items);
    const p = { ...rowToProject(r, []), itemCount: items.length, totals };
    projects.push(p);
    const progress = totals.progress || 0;

    const check = validateProjectForPublishFromItems(p.id, items);
    if (check.status === "blocked") {
      const row = {
        projectId: p.id,
        name: p.name,
        client: p.client,
        type: "publish_check",
        issueCount: check.counts?.criticalCount || check.critical?.length || 0,
        clientItems: check.counts?.clientItems || 0,
      };
      publishCheck.push(row);
      problems.push(row);
    }

    const help = items.filter((i) => i.status === "need_help" && lineVisibleToClient(i));
    if (help.length) {
      const row = { projectId: p.id, name: p.name, client: p.client, type: "need_help", count: help.length };
      needHelp.push(row);
      problems.push(row);
    }

    const lastAct = p.lastClientActivityAt ? new Date(p.lastClientActivityAt).getTime() : 0;
    const staleDays = lastAct ? Math.floor((now - lastAct) / day) : null;
    const stale = !lastAct || now - lastAct > 14 * day;
    if (stale && progress < 100 && progress > 0) {
      const row = {
        projectId: p.id,
        name: p.name,
        client: p.client,
        type: "inactive_client",
        days: staleDays ?? 999,
        progress,
      };
      inactiveClient.push(row);
      problems.push(row);
    }

    if (progress >= 5 && progress < 92 && stale && (p.clientToken || help.length === 0)) {
      const row = {
        projectId: p.id,
        name: p.name,
        client: p.client,
        type: "stuck_purchase",
        progress,
        days: staleDays ?? 999,
      };
      stuckPurchase.push(row);
      problems.push(row);
    }
  }

  let analyticsPreview = { avgBudgetByType: [], timelineCount: 0 };
  try {
    const a = getAnalytics();
    analyticsPreview = {
      avgBudgetByType: (a.avgBudgetByType || []).slice(0, 5),
      timelineCount: (a.purchaseToInstallDays || []).length,
      costPerM2Count: (a.costPerM2 || []).length,
    };
  } catch {
    /* ignore */
  }

  return {
    projectCount: projects.length,
    materialCount: materials.length,
    noPhoto,
    noPrice,
    noLink,
    problems,
    groups: { publishCheck, needHelp, inactiveClient, stuckPurchase },
    analyticsPreview,
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

api.get("/section-templates/list", (_req, res) => {
  res.json(listSectionTemplates());
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
  const p = duplicateProject(req.params.id, req.body || {});
  if (!p) return res.status(404).json({ error: "Not found" });
  logProjectEvent({
    projectId: p.id,
    actor: "admin",
    summary: `Daogreen: проект создан на основе прошлого (${req.body?.mode === "copy_as_is" ? "как есть" : "новая закупка"})`,
    clientVisible: false,
  });
  res.status(201).json(p);
});

api.post("/:id/import-preview", (req, res) => {
  const preview = previewImportToProject(req.params.id, req.body || {});
  if (!preview) return res.status(404).json({ error: "Not found" });
  res.json(preview);
});

api.post("/:id/import-from-project", (req, res) => {
  const result = importToProject(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json(result);
});

api.get("/:id/compare/:otherId", (req, res) => {
  const diff = compareProjects(req.params.id, req.params.otherId);
  if (!diff) return res.status(404).json({ error: "Not found" });
  res.json(diff);
});

api.post("/:id/sections/:module/save-template", (req, res) => {
  const tpl = saveSectionAsTemplate(req.params.id, decodeURIComponent(req.params.module), req.body || {});
  if (!tpl) return res.status(400).json({ error: "Cannot save template" });
  res.status(201).json(tpl);
});

api.post("/:id/apply-section-template", (req, res) => {
  const result = applySectionTemplate(req.params.id, req.body?.templateId, {
    targetModule: req.body?.targetModule,
  });
  if (!result) return res.status(404).json({ error: "Not found" });
  res.json(result);
});

api.post("/:id/approve-all", (req, res) => {
  const p = approveAll(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  logProjectEvent({
    projectId: req.params.id,
    actor: "admin",
    summary: "Daogreen: утверждены все позиции для клиента",
    clientVisible: false,
  });
  res.json(p);
});

api.post("/:id/versions", (req, res) => {
  try {
    const v = createVersion(req.params.id, req.body?.createdBy, { force: !!req.body?.force });
    if (!v) return res.status(404).json({ error: "Not found" });
    logProjectEvent({
      projectId: req.params.id,
      actor: "admin",
      summary: `Daogreen: опубликована версия ${v.versionNumber}`,
      clientVisible: false,
    });
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

api.post("/:id/items/bulk-patch", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const result = bulkPatchItems(req.params.id, {
    itemIds: req.body?.itemIds || [],
    patch: req.body?.patch || {},
  });
  for (const prev of result.before || []) {
    logItemPatch({
      projectId: req.params.id,
      itemId: prev.id,
      itemName: prev.name,
      actor: "admin",
      before: prev,
      patch: result.patch,
    });
  }
  res.json(result);
});

api.post("/:id/items/refresh-from-material", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const beforeMap = new Map((p.items || []).map((it) => [it.id, it]));
  const result = refreshItemsFromMaterial(req.params.id, {
    itemIds: req.body?.itemIds || (req.body?.itemId ? [req.body.itemId] : []),
    fields: req.body?.fields || [],
  });
  for (const it of result.updated || []) {
    const before = beforeMap.get(it.id);
    if (!before) continue;
    const patch = {};
    for (const key of Object.keys(it)) {
      if (before[key] !== it[key]) patch[key] = it[key];
    }
    if (Object.keys(patch).length) {
      logItemPatch({
        projectId: req.params.id,
        itemId: it.id,
        itemName: it.name,
        actor: "admin",
        before,
        patch,
      });
    }
  }
  res.json(result);
});

api.patch("/:id/items/:itemId", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const before = p.items.find((i) => i.id === req.params.itemId);
  const it = patchItem(req.params.id, req.params.itemId, req.body);
  if (!it) return res.status(404).json({ error: "Not found" });
  logItemPatch({
    projectId: req.params.id,
    itemId: it.id,
    itemName: it.name,
    actor: "admin",
    before,
    patch: req.body,
  });
  res.json(it);
});

api.post("/:id/items/:itemId/replacement-review", reviewItemReplacement);

api.get("/:id/activity", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(listActivity(req.params.id, { clientOnly: false }));
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
  return loadClientBrand(db);
}

function serveClientProject(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const versions = listVersions(p.id);
  const documents = db
    .prepare("SELECT id, type, filename, url, uploaded_at as uploadedAt FROM files WHERE project_id = ? ORDER BY uploaded_at DESC")
    .all(p.id);
  const activity = listActivity(p.id, { clientOnly: true });
  res.json({
    project: sanitizeProjectForClient(p),
    versionInfo: versions[0] || null,
    branding: loadBrandingSettings(),
    purchaseStatuses: clientPurchaseStatuses(),
    documents,
    activity,
    catalog: clientCatalogForProject(p),
  });
}

function clientPatchAllowed(body = {}) {
  const allowed = ["status", "actualPrice", "clientComment"];
  const patch = {};
  for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
  return patch;
}

function validateClientStatus(status) {
  if (status === undefined) return true;
  const valid = new Set(clientPurchaseStatuses().map((s) => s.id));
  return valid.has(status);
}

function patchClientItem(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const before = p.items.find((i) => i.id === req.params.itemId);
  if (!before || !lineVisibleToClient(before)) {
    return res.status(403).json({ error: "Item not available" });
  }
  const patch = clientPatchAllowed(req.body);
  if (patch.status !== undefined && !validateClientStatus(patch.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const it = patchItem(p.id, req.params.itemId, patch);
  logItemPatch({
    projectId: p.id,
    itemId: it.id,
    itemName: it.name,
    actor: "client",
    before,
    patch,
  });
  const bought = ["bought", "delivered", "have"].includes(patch.status);
  if (bought && !p.purchaseStartedAt) {
    db.prepare("UPDATE projects SET purchase_started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(
      p.id
    );
  }
  db.prepare(
    "UPDATE projects SET last_client_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(p.id);
  res.json(sanitizeItemForClient(it));
}

function bulkPatchClientItems(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const patch = clientPatchAllowed(req.body?.patch || req.body);
  const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
  if (!itemIds.length) return res.status(400).json({ error: "itemIds required" });
  if (patch.status !== undefined && !validateClientStatus(patch.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const visibleIds = itemIds.filter((id) => {
    const it = p.items.find((i) => i.id === id);
    return it && lineVisibleToClient(it);
  });
  if (!visibleIds.length) return res.status(403).json({ error: "No items available" });
  const result = bulkPatchItems(p.id, { itemIds: visibleIds, patch });
  for (const it of result.updated) {
    const before = result.before.find((b) => b.id === it.id);
    if (before) {
      logItemPatch({
        projectId: p.id,
        itemId: it.id,
        itemName: it.name,
        actor: "client",
        before,
        patch,
      });
    }
  }
  if (patch.status && ["bought", "delivered", "have"].includes(patch.status) && !p.purchaseStartedAt) {
    db.prepare("UPDATE projects SET purchase_started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(
      p.id
    );
  }
  db.prepare(
    "UPDATE projects SET last_client_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(p.id);
  res.json({ updated: result.updated.map(sanitizeItemForClient), skipped: result.skipped });
}

function proposeClientReplacement(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const before = p.items.find((i) => i.id === req.params.itemId);
  if (!before || !lineVisibleToClient(before)) {
    return res.status(403).json({ error: "Item not available" });
  }
  const patch = {
    status: "replacement_check",
    replacementLink: String(req.body?.link || "").trim(),
    replacementPhotoUrl: String(req.body?.photoUrl || "").trim(),
    replacementPrice:
      req.body?.price != null && req.body.price !== "" ? Number(req.body.price) : null,
    replacementComment: String(req.body?.comment || "").trim(),
    replacementProposedAt: new Date().toISOString(),
  };
  const it = patchItem(p.id, req.params.itemId, patch);
  logItemPatch({
    projectId: p.id,
    itemId: it.id,
    itemName: it.name,
    actor: "client",
    before,
    patch: { status: "replacement_check", replacementProposed: true },
  });
  db.prepare(
    "UPDATE projects SET last_client_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(p.id);
  res.json(sanitizeItemForClient(it));
}

function reviewItemReplacement(req, res) {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const before = p.items.find((i) => i.id === req.params.itemId);
  if (!before) return res.status(404).json({ error: "Item not found" });
  const action = req.body?.action;
  if (!["accept", "reject"].includes(action)) {
    return res.status(400).json({ error: "action must be accept or reject" });
  }
  const patch = {
    status: "not_bought",
    replacementLink: "",
    replacementPhotoUrl: "",
    replacementPrice: null,
    replacementComment: "",
    replacementProposedAt: "",
  };
  if (action === "accept") {
    if (req.body?.link != null) patch.link = String(req.body.link).trim();
    if (req.body?.supplier != null) patch.supplier = String(req.body.supplier).trim();
    if (req.body?.price != null) patch.price = Number(req.body.price) || 0;
  }
  if (req.body?.adminNote) {
    patch.clientComment = [before.clientComment, req.body.adminNote].filter(Boolean).join(" · ");
  }
  const it = patchItem(p.id, req.params.itemId, patch);
  logItemPatch({
    projectId: p.id,
    itemId: it.id,
    itemName: it.name,
    actor: "admin",
    before,
    patch: { replacementReview: action, ...req.body },
  });
  res.json(it);
}

function patchClientCooling(req, res) {
  const p = loadProjectByToken(req.clientToken);
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
  const oldSf = cf.safetyFactor;
  cf.safetyFactor = sf;
  mp.coolingFarm = cf;
  db.prepare("UPDATE projects SET manual_params = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(mp),
    p.id
  );
  if (oldSf !== sf) {
    logProjectEvent({
      projectId: p.id,
      actor: "client",
      summary: `Клиент: запасной коэфф. ${oldSf ?? "—"} → ${sf}`,
    });
  }
  db.prepare(
    "UPDATE projects SET last_client_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(p.id);
  res.json({ manualParams: mp });
}

// Client router — основной путь /api/client/p/:token
export const clientRouter = Router();
clientRouter.use(clientAuthMiddleware);

clientRouter.get("/p/:token", serveClientProject);
clientRouter.patch("/p/:token/items/bulk", bulkPatchClientItems);
clientRouter.patch("/p/:token/items/:itemId", patchClientItem);
clientRouter.post("/p/:token/items/:itemId/propose-replacement", proposeClientReplacement);
clientRouter.patch("/p/:token/cooling", patchClientCooling);
