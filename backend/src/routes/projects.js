import { Router } from "express";
import path from "path";
import {
  db,
  loadProject,
  loadProjectByToken,
  loadProjectItems,
  loadSlimItemsForProjects,
  rowToProject,
} from "../db.js";
import { shouldPreserveStoredPlan } from "../plannerPlanState.js";
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
} from "../services/activityLog.js";
import { clientPurchaseStatuses } from "../services/referenceData.js";
import { clientAuthMiddleware } from "../services/clientAuth.js";
import { loadClientBrand } from "../services/clientBrand.js";
import { refreshFrameBomProject } from "../services/frameBomRefresh.js";
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
import { diffRefreshPatch } from "../../../shared/refreshItemFromMaterial.js";
import {
  cloneProjectItem,
  cloneProjectItemsWithIdMap,
  remapRoomsSelectedItemIds,
  stripProjectForClone,
  templateItemFromProjectItem,
} from "../../../shared/projectItemClone.js";
import { compareProjectItems } from "../../../shared/projectCompare.js";
import { buildImportPreview } from "../../../shared/importFromProject.js";
import {
  buildPublishedReleaseMeta,
  isLegacyReleaseIncomplete,
  isPublishWorkflowStatus,
  parsePublishedRelease,
} from "../../../shared/projectPublishedRelease.js";
import {
  resolveCurrencyPersistFromBody,
  defaultCurrencyPersist,
} from "../../../shared/projectCurrency.js";
import {
  normalizeProjectClientLanguage,
  resolveClientLanguagePatch,
} from "../../../shared/projectClientLanguage.js";
import { validateProjectItemsForSave, validateSingleProjectItem } from "../services/projectItemValidation.js";
import {
  buildClientProjectFromRelease,
  buildHistoricalClientPreview,
  buildReleaseSnapshotJson,
  getProjectReleaseInfo,
  listVersionSummaries,
  loadLatestVersionRow,
  loadPublishedSnapshotItems,
  loadPublishedReleaseSnapshot,
  loadVersionRow,
  prepareClientMutationItemResponse,
  prepareReleaseSnapshotPayload,
  resolveClientDocumentsForRelease,
  shouldPublishOnStatusChange,
} from "../services/publishedReleaseService.js";
import { diffReleaseSnapshots, buildPublishAutoSummaryText } from "../../../shared/releaseHistoryDiff.js";
import { normalizeReleaseComment } from "../../../shared/releaseComment.js";
import { clientExportHeader } from "../../../shared/publishedClientMeta.js";
import * as XLSX from "xlsx";
import { assertCanDeleteOrOverwriteAsset } from "../services/publishedAssetRetention.js";
import { publishedPlannedTotal } from "../../../shared/publishedPurchaseTotals.js";
import { pinClientDocumentsForRelease } from "../services/releaseDocumentPinning.js";
import { sendSafeUploadFile } from "../services/secureFileServe.js";
import {
  findProjectScopedImageAsset,
  findManifestImageById,
} from "../services/projectScopedMedia.js";

const router = Router();

const INSERT_PROJECT = db.prepare(`
  INSERT INTO projects (
    id, name, client, city, area, height, sowing_area, type, currency, vat, comment,
    status, client_token, selected_modules, zones, stellage_configs, manual_params, rooms, version,
    planner_plan, planner_sync_at
  ) VALUES (
    @id, @name, @client, @city, @area, @height, @sowing_area, @type, @currency, @vat, @comment,
    @status, @client_token, @selected_modules, @zones, @stellage_configs, @manual_params, @rooms, @version,
    @planner_plan, @planner_sync_at
  )
`);

const UPDATE_PROJECT = db.prepare(`
  UPDATE projects SET
    name=@name, client=@client, city=@city, area=@area, height=@height,
    sowing_area=@sowing_area, type=@type, currency=@currency, vat=@vat, comment=@comment,
    status=@status, selected_modules=@selected_modules, zones=@zones,
    stellage_configs=@stellage_configs, manual_params=@manual_params, rooms=@rooms, version=@version,
    planner_plan=@planner_plan, planner_sync_at=@planner_sync_at,
    last_client_activity_at=@last_client_activity_at,
    revision=revision + 1, updated_at=datetime('now')
  WHERE id=@id AND revision=@expected_revision
`);

export const PROJECT_REVISION_CONFLICT = "PROJECT_REVISION_CONFLICT";

function revisionConflict(projectId, expectedRevision, currentRevision) {
  const error = new Error("Проект был изменён в другой вкладке или другим пользователем.");
  error.code = PROJECT_REVISION_CONFLICT;
  error.projectId = projectId;
  error.expectedRevision = expectedRevision;
  error.currentRevision = currentRevision;
  return error;
}

function parseExpectedRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
}

function requireExpectedRevision(projectId, value) {
  const expected = parseExpectedRevision(value);
  if (expected == null) {
    const error = new Error("expectedRevision is required");
    error.code = "EXPECTED_REVISION_REQUIRED";
    error.projectId = projectId;
    throw error;
  }
  return expected;
}

function assertRevision(projectId, expectedRevision) {
  const current = db.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId);
  if (!current) return null;
  if (Number(current.revision) !== expectedRevision) {
    throw revisionConflict(projectId, expectedRevision, Number(current.revision));
  }
  return current;
}

function bumpRevision(projectId, expectedRevision) {
  const result = db.prepare(`
    UPDATE projects SET revision = revision + 1, updated_at = datetime('now')
    WHERE id = ? AND revision = ?
  `).run(projectId, expectedRevision);
  if (result.changes !== 1) {
    const current = db.prepare("SELECT revision FROM projects WHERE id = ?").get(projectId);
    if (!current) return false;
    throw revisionConflict(projectId, expectedRevision, Number(current.revision));
  }
  return true;
}

function mutateWithRevision(projectId, expectedValue, callback) {
  const expectedRevision = requireExpectedRevision(projectId, expectedValue);
  const run = db.transaction(() => {
    const existing = assertRevision(projectId, expectedRevision);
    if (!existing) return null;
    const value = callback();
    bumpRevision(projectId, expectedRevision);
    return { value, revision: expectedRevision + 1 };
  });
  return run();
}

function revisionErrorResponse(res, error) {
  if (error?.code !== PROJECT_REVISION_CONFLICT) return false;
  res.status(409).json({ error: {
    code: error.code,
    projectId: error.projectId,
    expectedRevision: error.expectedRevision,
    currentRevision: error.currentRevision,
    message: error.message,
  } });
  return true;
}

const INSERT_ITEM = db.prepare(`
  INSERT INTO project_items (
    id, project_id, material_id, module, section, name, name_overridden, unit, category,
    supplier, link, link_alt, photo_url, client_note, tech_note,
    qty, price, vat_rate, visible, approved, enabled, needs_approval,
    status, actual_price, client_comment, sort_order, responsible,
    cooling_kw, cooling_btu, exhaust_m3, room_id, internal_note, delivery_days, item_role, pipe_cuts, breaker_specs, flow_specs, split_specs,     client_section, client_subsection,
    included_in_project, visible_to_client, item_type, subcategory, purchase_key,
    purchase_priority, replacement_link, replacement_photo_url, replacement_price,
    replacement_comment, replacement_proposed_at, source, source_type, source_key, source_object_ids,
    name_en, description_en, unit_en
  ) VALUES (
    @id, @project_id, @material_id, @module, @section, @name, @name_overridden, @unit, @category,
    @supplier, @link, @link_alt, @photo_url, @client_note, @tech_note,
    @qty, @price, @vat_rate, @visible, @approved, @enabled, @needs_approval,
    @status, @actual_price, @client_comment, @sort_order, @responsible,
    @cooling_kw, @cooling_btu, @exhaust_m3, @room_id, @internal_note, @delivery_days, @item_role, @pipe_cuts, @breaker_specs, @flow_specs, @split_specs,     @client_section, @client_subsection,
    @included_in_project, @visible_to_client, @item_type, @subcategory, @purchase_key,
    @purchase_priority, @replacement_link, @replacement_photo_url, @replacement_price,
    @replacement_comment, @replacement_proposed_at, @source, @source_type, @source_key, @source_object_ids,
    @name_en, @description_en, @unit_en
  )
`);

const UPDATE_ITEM = db.prepare(`
  UPDATE project_items SET
    module=@module, section=@section, name=@name, name_overridden=@name_overridden, unit=@unit, category=@category,
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
    replacement_comment=@replacement_comment, replacement_proposed_at=@replacement_proposed_at,
    source=@source, source_type=@source_type, source_key=@source_key, source_object_ids=@source_object_ids,
    name_en=@name_en, description_en=@description_en, unit_en=@unit_en
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
    name_overridden: normalized.nameOverridden ? 1 : 0,
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
    source: normalized.source || "",
    source_type: normalized.sourceType || "",
    source_key: normalized.sourceKey || "",
    source_object_ids: JSON.stringify(normalized.sourceObjectIds || []),
    name_en: String(normalized.nameEn || normalized.name_en || "").trim(),
    description_en: String(normalized.descriptionEn || normalized.description_en || "").trim(),
    unit_en: String(normalized.unitEn || normalized.unit_en || "").trim(),
  };
}

/**
 * Внутренняя версия saveItems: выполняет валидацию и SQL, но НЕ открывает
 * транзакцию — предполагается, что вызывающий код уже находится внутри неё.
 *
 * Нужна для атомарного сохранения проекта: db.transaction() (см. db.js) делает
 * `BEGIN IMMEDIATE`, поэтому вложенный вызов публичного saveItems() внутри
 * другой транзакции упал бы с "cannot start a transaction within a transaction".
 */
export function saveItemsWithin(projectId, items, options = {}) {
  validateProjectItemsForSave(items, {
    allowLegacyMissingMaterialId: options.allowLegacyMissingMaterialId !== false,
  });
  const list = Array.isArray(items) ? items : [];
  db.prepare("DELETE FROM project_items WHERE project_id = ?").run(projectId);
  let inserted = 0;
  for (const it of list) {
    INSERT_ITEM.run(itemToParams(it, projectId));
    inserted += 1;
  }
  if (inserted !== list.length) {
    throw new Error(`Item insert count mismatch: expected ${list.length}, got ${inserted}`);
  }
  touchProject(projectId);
}

/**
 * Публичное поведение не изменилось: замена позиций проекта в одной транзакции.
 * (touchProject теперь коммитится вместе с позициями, а не отдельной записью.)
 */
export function saveItems(projectId, items, options = {}) {
  const run = db.transaction(() => saveItemsWithin(projectId, items, options));
  run();
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
    planner_plan: JSON.stringify(p.plan || {}),
    planner_sync_at: p.plannerSyncAt || "",
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

function stripIncomingCurrencyMeta(manualParams) {
  if (!manualParams || typeof manualParams !== "object") return {};
  const { currencyMeta: _ignored, ...rest } = manualParams;
  return rest;
}

function mergeCurrencyIntoManualParams(manualParams, currencyPersist) {
  const mp = { ...(manualParams || {}) };
  if (currencyPersist?.manualParamsPatch?.currencyMeta) {
    mp.currencyMeta = currencyPersist.manualParamsPatch.currencyMeta;
  }
  return mp;
}

export function createProject(body) {
  const materials = listMaterials();
  const modules = listModules();
  const selected = body.selectedModules || [];
  const items = body.items?.length
    ? body.items
    : buildItemsFromModules(materials, modules, selected);

  const currencyPersist = resolveCurrencyPersistFromBody(body) || defaultCurrencyPersist();
  const manualParams = mergeCurrencyIntoManualParams(
    stripIncomingCurrencyMeta(body.manualParams || {}),
    currencyPersist,
  );
  manualParams.clientLanguage = resolveClientLanguagePatch(body)
    ?? normalizeProjectClientLanguage(manualParams.clientLanguage);

  const id = uid("p");
  INSERT_PROJECT.run(projectInsertRow({
    ...body,
    id,
    currency: currencyPersist.currency,
    manualParams,
    clientToken: clientToken(),
    selectedModules: selected,
  }));
  saveItems(id, items);
  return loadProject(id);
}

/**
 * Полное сохранение проекта — АТОМАРНО: одна SQLite-транзакция на весь запрос.
 *
 * Раньше стадии коммитились по отдельности:
 *   1) saveItems()            → BEGIN/COMMIT (позиции уже сохранены)
 *   2) publishReleaseIfNeeded → INSERT spec_versions + UPDATE projects.version
 *   3) UPDATE_PROJECT.run()   → metadata/manualParams/статус
 * Падение на (2) или (3) оставляло позиции заменёнными, а проект — нет.
 *
 * Теперь все стадии выполняются внутри одной транзакции: либо всё COMMIT,
 * либо всё ROLLBACK и БД остаётся ровно в состоянии до запроса.
 */
export function updateProject(id, patch) {
  const expectedRevision = requireExpectedRevision(id, patch?.expectedRevision);

  const run = db.transaction(() => {
    const cur = loadProject(id);
    if (!cur) return null;
    assertRevision(id, expectedRevision);
    const { expectedRevision: _expectedRevision, ...safePatch } = patch;
    if (safePatch.items) {
      saveItemsWithin(id, safePatch.items);
    }

    // Внутри транзакции чтение видит собственные незакоммиченные записи,
    // поэтому publish-валидация по-прежнему проверяет НОВЫЕ позиции.
    const base = safePatch.items ? loadProject(id) : cur;
    const currencyPersist = resolveCurrencyPersistFromBody(safePatch);
    const patchMp = safePatch.manualParams
      ? stripIncomingCurrencyMeta(safePatch.manualParams)
      : null;
    let manualParams = {
      ...(base.manualParams || {}),
      ...(patchMp || {}),
    };
    const clientLanguage = resolveClientLanguagePatch(patch);
    if (clientLanguage !== undefined) manualParams.clientLanguage = clientLanguage;
    // Keep existing currencyMeta unless this patch validates a new currency.
    if (base.manualParams?.currencyMeta && !currencyPersist) {
      manualParams.currencyMeta = base.manualParams.currencyMeta;
    }
    if (currencyPersist) {
      manualParams = mergeCurrencyIntoManualParams(manualParams, currencyPersist);
    }
    let merged = {
      ...base,
      ...safePatch,
      id,
      manualParams,
      ...(currencyPersist ? { currency: currencyPersist.currency } : {}),
    };
    delete merged.currencyCode;
    delete merged.currencySymbol;
    delete merged.currencyName;
    delete merged.currencyCustom;
    delete merged.currencyInfo;

    if (safePatch.status != null && safePatch.status !== base.status && isPublishWorkflowStatus(safePatch.status)) {
      // Build the release from the complete PATCH candidate. This keeps images and
      // metadata changed in the same request inside the immutable release_v2 snapshot.
      const pub = publishReleaseIfNeeded(id, merged, safePatch.status);
      if (pub.publishedRelease) {
        manualParams = { ...manualParams, publishedRelease: pub.publishedRelease };
        merged = { ...merged, manualParams };
      }
    }

    const row = projectUpdateRow(merged);
    // PHASE 0B: не затирать повреждённый planner_plan пустым `{}` при апдейте,
    // где новый план не передан. Исходные байты остаются нетронутыми в SQLite.
    const storedRow = db.prepare("SELECT planner_plan FROM projects WHERE id = ?").get(id);
    if (shouldPreserveStoredPlan(storedRow?.planner_plan, safePatch)) {
      row.planner_plan = storedRow.planner_plan;
    }
    row.expected_revision = expectedRevision;
    const updated = UPDATE_PROJECT.run(row);
    if (updated.changes !== 1) {
      const current = db.prepare("SELECT revision FROM projects WHERE id = ?").get(id);
      throw revisionConflict(id, expectedRevision, Number(current?.revision || 0));
    }
    return true;
  });

  const found = run();
  if (!found) return null;
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

  // Copy currency + currencyMeta; allow body override via validated currency fields.
  const currencyPersist = resolveCurrencyPersistFromBody({
    currency: src.currency,
    currencyCode: src.currencyCode,
    currencySymbol: src.currencySymbol,
    currencyName: src.currencyName,
    currencyCustom: src.currencyCustom,
    manualParams: { currencyMeta: src.manualParams?.currencyMeta },
    ...body,
  }) || defaultCurrencyPersist();

  const clonedMp = stripIncomingCurrencyMeta(src.manualParams || {});
  // Drop published release pointer from clone.
  delete clonedMp.publishedRelease;

  return createProject({
    ...meta,
    name: (body.name || `${src.name} (копия)`).trim(),
    client: body.client != null ? body.client : "",
    city: body.city != null ? body.city : src.city,
    area: body.area != null ? body.area : src.area,
    currency: currencyPersist.currency,
    currencyCode: currencyPersist.manualParamsPatch.currencyMeta.code,
    currencySymbol: currencyPersist.manualParamsPatch.currencyMeta.symbol,
    currencyName: currencyPersist.manualParamsPatch.currencyMeta.name,
    currencyCustom: currencyPersist.manualParamsPatch.currencyMeta.custom,
    items,
    selectedModules: src.selectedModules,
    zones: src.zones,
    stellageConfigs: (src.stellageConfigs || []).map((rack) => ({
      ...rack,
      extraImages: (Array.isArray(rack.extraImages) ? rack.extraImages : []).map((image, sortOrder) => ({
        ...image,
        id: uid("rack_img"),
        sortOrder,
      })),
    })),
    manualParams: mergeCurrencyIntoManualParams(clonedMp, currencyPersist),
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
  saveItemsWithin(id, items);
  return loadProject(id);
}

function createVersionRecord(projectId, project, {
  force = false,
  createdBy = "admin",
  snapshotPayload = null,
  releaseComment = null,
} = {}) {
  // Validate comment before any DB write so failed publish leaves no row.
  const comment = normalizeReleaseComment(releaseComment);

  if (!force) {
    const check = validateProjectForPublish(projectId);
    if (check.status === "blocked") {
      const err = new Error("Publish validation failed");
      err.code = "PUBLISH_VALIDATION";
      err.problems = check.critical?.length ? check.critical : check.problems;
      throw err;
    }
  }
  const versionId = uid("v");
  const liveDocuments = getClientProjectDocuments(projectId);
  const { documentManifest } = pinClientDocumentsForRelease({
    projectId,
    versionId,
    liveDocuments,
  });
  // Hash/read assets before the version-row write.
  const payload = prepareReleaseSnapshotPayload(project, { documentManifest });
  const snapshotJson = JSON.stringify(payload);

  const prev = db
    .prepare("SELECT * FROM spec_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1")
    .get(projectId);
  const prevItems = prev ? releaseSnapshotItemsFromRow(prev) : [];
  const itemSummary = compareVersions(prevItems, project.items || []);
  let autoSummaryText;
  let imagesAdded = 0;
  let imagesRemoved = 0;
  let imagesChanged = 0;
  let drawingsAdded = 0;
  let drawingsRemoved = 0;
  let drawingsReplaced = 0;
  let coolingChanged = false;
  let farmPowerChanged = false;
  const currency = String(project.currency || "₽");
  if (prev?.snapshot) {
    let prevSnap;
    try {
      prevSnap = JSON.parse(prev.snapshot);
    } catch {
      prevSnap = [];
    }
    const diff = diffReleaseSnapshots(prevSnap, payload);
    autoSummaryText = buildPublishAutoSummaryText(diff, currency);
    imagesAdded = diff.images?.added?.length || 0;
    imagesRemoved = diff.images?.removed?.length || 0;
    imagesChanged = diff.images?.changed?.length || 0;
    drawingsAdded = diff.drawings?.added?.length || 0;
    drawingsRemoved = diff.drawings?.removed?.length || 0;
    drawingsReplaced = diff.drawings?.replaced?.length || 0;
    coolingChanged = !!(
      diff.cooling?.powerChanged ||
      (diff.cooling?.roomsAdded?.length || 0) ||
      (diff.cooling?.roomsRemoved?.length || 0)
    );
    farmPowerChanged = !!(
      diff.farmPower?.tariffChanged ||
      diff.farmPower?.devicesChanged ||
      diff.farmPower?.costChanged
    );
    // Prefer snapshot totals (client-planned) when available
    if (diff.totals && Number.isFinite(diff.totals.delta)) {
      itemSummary.sumBefore = diff.totals.from;
      itemSummary.sumAfter = diff.totals.to;
      itemSummary.delta = diff.totals.delta;
    }
  } else {
    const total = publishedPlannedTotal(payload.items || project.items || []);
    itemSummary.sumBefore = 0;
    itemSummary.sumAfter = total;
    itemSummary.delta = total;
    autoSummaryText = "Первая публикация проекта.";
  }

  const summary = {
    ...itemSummary,
    autoSummaryText,
    imagesAdded,
    imagesRemoved,
    imagesChanged,
    drawingsAdded,
    drawingsRemoved,
    drawingsReplaced,
    coolingChanged,
    farmPowerChanged,
  };
  const versionNumber = prev ? Number(prev.version_number) + 1 : 1;

  db.prepare(`
    INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot, release_comment)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    projectId,
    versionNumber,
    createdBy,
    JSON.stringify(summary),
    snapshotJson,
    comment,
  );

  db.prepare("UPDATE projects SET version = ?, updated_at = datetime('now') WHERE id = ?").run(
    versionNumber,
    projectId,
  );

  return {
    id: versionId,
    projectId,
    versionNumber,
    summary,
    summaryText: autoSummaryText,
    releaseComment: comment,
    createdAt: new Date().toISOString(),
    createdBy,
    schema: payload.schema,
    assetsPinned: !!payload.assetsPinned,
  };
}

function releaseSnapshotItemsFromRow(row) {
  try {
    const raw = JSON.parse(row?.snapshot || "[]");
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.items)) return raw.items;
    return [];
  } catch {
    return [];
  }
}

function publishReleaseIfNeeded(projectId, project, targetStatus) {
  const existing = parsePublishedRelease(project?.manualParams);
  if (existing && !shouldPublishOnStatusChange(project, targetStatus)) {
    return { publishedRelease: existing, version: null, skipped: true };
  }
  const version = createVersionRecord(projectId, project, { force: false });
  return {
    publishedRelease: buildPublishedReleaseMeta(version, targetStatus),
    version,
    skipped: false,
  };
}

function persistPublishedRelease(projectId, publishedRelease) {
  const row = db.prepare("SELECT manual_params FROM projects WHERE id = ?").get(projectId);
  if (!row) return;
  let mp = {};
  try {
    mp = JSON.parse(row.manual_params || "{}");
  } catch {
    mp = {};
  }
  mp.publishedRelease = publishedRelease;
  db.prepare("UPDATE projects SET manual_params = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(mp),
    projectId,
  );
}

export function createVersion(id, createdBy = "admin", { force = false, releaseComment = null } = {}) {
  const p = loadProject(id);
  if (!p) return null;
  // Prepare snapshot (may throw PUBLISH_ASSET_MISSING) before mutating DB / revision.
  // Do not open a nested transaction here — callers (mutateWithRevision, updateProject,
  // backfill) already wrap writes. Opening BEGIN inside an active txn fails on node:sqlite.
  // Normalize comment early so validation errors happen before snapshot work when possible.
  normalizeReleaseComment(releaseComment);
  const snapshotPayload = prepareReleaseSnapshotPayload(p);
  const version = createVersionRecord(id, p, { force, createdBy, snapshotPayload, releaseComment });
  const publishedRelease = buildPublishedReleaseMeta(version, p.status);
  persistPublishedRelease(id, publishedRelease);
  return version;
}

export function listVersions(id) {
  const summaries = listVersionSummaries(id);
  if (!summaries) return [];
  return summaries;
}

function touchProject(projectId) {
  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);
}

export function patchItem(projectId, itemId, patch) {
  const p = loadProject(projectId);
  if (!p) return null;
  let item = p.items.find((i) => i.id === itemId);
  if (!item) return null;
  const effectivePatch = { ...patch };
  if (patch.name_overridden !== undefined && patch.nameOverridden === undefined) effectivePatch.nameOverridden = !!patch.name_overridden;
  if (item.materialId && patch.name !== undefined && effectivePatch.nameOverridden === undefined) effectivePatch.nameOverridden = true;
  item = normalizeItemFlags({ ...item, ...effectivePatch });
  item.name_overridden = !!item.nameOverridden;
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

export function planRefreshItemsFromMaterial(project, { itemIds = [], fields = [] } = {}) {
  if (!project) return { plans: [], skipped: [], results: [] };
  const refreshFields = resolveRefreshFields(fields);
  const ids = itemIds.length ? itemIds : (project.items || []).map((i) => i.id);
  const plans = [];
  const skipped = [];
  const results = [];

  for (const itemId of ids) {
    const item = (project.items || []).find((i) => i.id === itemId);
    if (!item?.materialId) {
      skipped.push({ itemId, reason: "no_material" });
      results.push({ itemId, changed: false, changedFields: [], item: item || null, reason: "no_material" });
      continue;
    }
    const mat = getMaterialById(item.materialId);
    if (!mat) {
      skipped.push({ itemId, reason: "material_missing" });
      results.push({ itemId, changed: false, changedFields: [], item, reason: "material_missing" });
      continue;
    }
    const matPatch = patchFromMaterial(mat, refreshFields);
    if (!Object.keys(matPatch).length) {
      skipped.push({ itemId, reason: "no_fields" });
      results.push({ itemId, changed: false, changedFields: [], item, reason: "no_fields" });
      continue;
    }
    const changedFields = diffRefreshPatch(item, matPatch);
    if (!changedFields.length) {
      results.push({ itemId, changed: false, changedFields: [], item });
      continue;
    }
    plans.push({ itemId, patch: matPatch, changedFields, before: item });
    results.push({ itemId, changed: true, changedFields, item });
  }

  return { plans, skipped, results };
}

export function refreshItemsFromMaterial(projectId, { itemIds = [], fields = [] } = {}) {
  const p = loadProject(projectId);
  if (!p) return { updated: [], skipped: [], results: [] };
  const { plans, skipped, results: plannedResults } = planRefreshItemsFromMaterial(p, { itemIds, fields });
  const updated = [];
  const results = [];

  for (const row of plannedResults) {
    if (!row.changed) {
      results.push(row);
      continue;
    }
    const plan = plans.find((entry) => entry.itemId === row.itemId);
    const next = patchItem(projectId, row.itemId, plan.patch);
    updated.push(next);
    results.push({ itemId: row.itemId, changed: true, changedFields: row.changedFields, item: next });
  }

  return { updated, skipped, results };
}

export function addItem(projectId, item) {
  const it = { ...item, id: item.id || uid("it") };
  validateSingleProjectItem(it, { allowLegacyMissingMaterialId: false });
  INSERT_ITEM.run(itemToParams(it, projectId));
  touchProject(projectId);
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
  const releaseInfo = getProjectReleaseInfo(p);
  res.json({
    ...p,
    ...releaseInfo,
  });
});

api.post("/", (req, res) => {
  try {
    res.status(201).json(createProject(req.body));
  } catch (e) {
    if (revisionErrorResponse(res, e)) return;
    if (e.code === "PROJECT_CURRENCY_INVALID" || e.code === "PROJECT_CLIENT_LANGUAGE_INVALID") {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    res.status(400).json({ error: e.message });
  }
});

api.patch("/:id", (req, res) => {
  try {
    const p = updateProject(req.params.id, req.body);
    if (!p) return res.status(404).json({ error: "Not found" });
    res.json({ ...p, ...getProjectReleaseInfo(p) });
  } catch (e) {
    if (revisionErrorResponse(res, e)) return;
    if (e.code === "PUBLISH_VALIDATION") {
      return res.status(422).json({ error: e.message, problems: e.problems, code: e.code });
    }
    if (e.code === "ITEM_VALIDATION") {
      return res.status(400).json({ error: e.message, details: e.details, code: e.code });
    }
    if (e.code === "PROJECT_CURRENCY_INVALID" || e.code === "PROJECT_CLIENT_LANGUAGE_INVALID") {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    return res.status(400).json({ error: e.message, code: e.code });
  }
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
  try {
    const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => importToProject(req.params.id, req.body || {}));
    if (!changed?.value) return res.status(404).json({ error: "Not found" });
    res.json({ ...changed.value, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
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
  try {
    const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => applySectionTemplate(req.params.id, req.body?.templateId, { targetModule: req.body?.targetModule }));
    if (!changed?.value) return res.status(404).json({ error: "Not found" });
    res.json({ ...changed.value, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.post("/:id/approve-all", (req, res) => {
  try {
    const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => {
      const p = approveAll(req.params.id);
      if (p) logProjectEvent({ projectId: req.params.id, actor: "admin", summary: "Daogreen: утверждены все позиции для клиента", clientVisible: false });
      return p;
    });
    if (!changed?.value) return res.status(404).json({ error: "Not found" });
    res.json({ ...loadProject(req.params.id), revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.post("/:id/versions", (req, res) => {
  try {
    const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () =>
      createVersion(req.params.id, req.body?.createdBy, {
        force: !!req.body?.force,
        releaseComment: req.body?.releaseComment,
      })
    );
    const v = changed?.value;
    if (!v) return res.status(404).json({ error: "Not found" });
    logProjectEvent({
      projectId: req.params.id,
      actor: "admin",
      summary: `Daogreen: опубликована версия ${v.versionNumber}`,
      clientVisible: false,
    });
    res.status(201).json({ ...v, revision: changed.revision });
  } catch (e) {
    if (revisionErrorResponse(res, e)) return;
    if (e.code === "RELEASE_COMMENT_TOO_LONG") {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    if (e.code === "PUBLISH_VALIDATION") {
      return res.status(422).json({ error: e.message, problems: e.problems });
    }
    if (e.code === "PUBLISH_ASSET_MISSING") {
      return res.status(422).json({ error: e.message, code: e.code, details: e.details });
    }
    throw e;
  }
});

api.get("/:id/publish-check", (req, res) => {
  res.json(validateProjectForPublish(req.params.id));
});

api.get("/:id/versions", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(listVersions(req.params.id));
});

api.get("/:id/versions/:versionId", (req, res) => {
  const ver = loadVersionRow(req.params.id, req.params.versionId);
  if (!ver) return res.status(404).json({ error: "Not found" });
  const snapshotItems = releaseSnapshotItemsFromRow({ snapshot: ver.snapshot });
  res.json({
    ...ver,
    snapshotItems,
    itemCount: snapshotItems.length,
  });
});

/** Historical client DTO — admin only (router already behind adminAuth). Read-only. */
api.get("/:id/versions/:versionId/client-preview", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const preview = buildHistoricalClientPreview(req.params.id, req.params.versionId, p);
  if (!preview) return res.status(404).json({ error: "Not found", code: "VERSION_NOT_FOUND" });
  const branding = loadBrandingSettings();
  res.json({
    ...preview,
    branding,
    brandingNote: "live_global_branding",
  });
});

api.get("/:id/versions/:versionId/diff", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const versionId = req.params.versionId;
  const otherId = String(req.query.compareTo || req.query.other || "").trim();
  const verB = loadVersionRow(req.params.id, versionId);
  if (!verB) return res.status(404).json({ error: "Not found", code: "VERSION_NOT_FOUND" });

  let verA = null;
  if (otherId) {
    verA = loadVersionRow(req.params.id, otherId);
    if (!verA) return res.status(404).json({ error: "Compare version not found", code: "VERSION_NOT_FOUND" });
  } else {
    // Default: previous version by number
    const prev = db
      .prepare(
        `SELECT id FROM spec_versions
         WHERE project_id = ? AND version_number < ?
         ORDER BY version_number DESC, created_at DESC, id DESC LIMIT 1`
      )
      .get(req.params.id, verB.versionNumber);
    if (prev) verA = loadVersionRow(req.params.id, prev.id);
  }

  if (!verA) {
    return res.json({
      versionA: null,
      versionB: { id: verB.id, versionNumber: verB.versionNumber, createdAt: verB.createdAt },
      diff: { hasChanges: false, empty: true, message: "Нет предыдущей версии для сравнения" },
    });
  }

  let snapA;
  let snapB;
  try {
    snapA = JSON.parse(verA.snapshot || "[]");
    snapB = JSON.parse(verB.snapshot || "[]");
  } catch {
    return res.status(500).json({ error: "Invalid snapshot" });
  }
  const diff = diffReleaseSnapshots(snapA, snapB);
  res.json({
    versionA: {
      id: verA.id,
      versionNumber: verA.versionNumber,
      createdAt: verA.createdAt,
      releaseComment: verA.releaseComment || null,
      summaryText: verA.summary?.autoSummaryText || null,
    },
    versionB: {
      id: verB.id,
      versionNumber: verB.versionNumber,
      createdAt: verB.createdAt,
      releaseComment: verB.releaseComment || null,
      summaryText: verB.summary?.autoSummaryText || null,
    },
    diff,
  });
});

/** Historical Excel — built from immutable snapshot DTO (not live draft). */
api.get("/:id/versions/:versionId/excel", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const preview = buildHistoricalClientPreview(req.params.id, req.params.versionId, p);
  if (!preview) return res.status(404).json({ error: "Not found", code: "VERSION_NOT_FOUND" });
  const project = preview.project;
  const header = clientExportHeader(project);
  const items = project.items || [];
  const rows = [
    ["Версия", preview.versionNumber, "от", preview.publishedAt],
    ["Проект", header.name],
    ["Клиент", header.client],
    ["Город", header.city],
    ["Адрес", header.address || ""],
    ["Валюта", header.currency],
    ["НДС", header.vat ? "да" : "нет"],
    [],
    ["Название", "Кол-во", "Цена", "Сумма", "Раздел", "Ссылка"],
    ...items.map((it) => [
      it.name || "",
      Number(it.qty) || 0,
      Number(it.price) || 0,
      Math.round((Number(it.qty) || 0) * (Number(it.price) || 0)),
      [it.clientSection, it.clientSubsection].filter(Boolean).join(" / "),
      it.link || "",
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "История");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const safe = String(header.name || "project").replace(/[^\w\-]+/g, "_").slice(0, 40);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="Daogreen_v${preview.versionNumber}_${safe}.xlsx"`
  );
  res.send(buf);
});

/**
 * Historical PDF export data — same immutable DTO used by client PDF builder.
 * Returns JSON for admin UI to generate PDF without duplicating layout logic.
 * Query ?format=json (default). Binary PDF generation stays in the frontend builder.
 */
api.get("/:id/versions/:versionId/pdf", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const preview = buildHistoricalClientPreview(req.params.id, req.params.versionId, p);
  if (!preview) return res.status(404).json({ error: "Not found", code: "VERSION_NOT_FOUND" });
  const branding = loadBrandingSettings();
  const header = clientExportHeader(preview.project);
  res.json({
    historical: true,
    versionId: preview.versionId,
    versionNumber: preview.versionNumber,
    publishedAt: preview.publishedAt,
    schema: preview.schema,
    assetsPinned: preview.assetsPinned,
    header,
    project: preview.project,
    items: preview.project.items || [],
    documents: preview.documents || [],
    branding,
    exportHint: "Use frontend generateClientPurchasePdf with this project DTO",
  });
});

api.post("/:id/items/bulk-patch", (req, res) => {
  try {
  const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => {
  const p = loadProject(req.params.id);
  if (!p) return null;
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
  return result;
  });
  if (!changed?.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...changed.value, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.post("/:id/items/refresh-from-material", (req, res) => {
  try {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const expectedRevision = requireExpectedRevision(req.params.id, req.body?.expectedRevision);
  assertRevision(req.params.id, expectedRevision);
  const itemIds = req.body?.itemIds || (req.body?.itemId ? [req.body.itemId] : []);
  const fields = req.body?.fields || [];
  const planned = planRefreshItemsFromMaterial(p, { itemIds, fields });
  if (!planned.plans.length) {
    return res.json({
      updated: [],
      skipped: planned.skipped,
      results: planned.results,
      revision: expectedRevision,
    });
  }
  const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => {
  const beforeMap = new Map((p.items || []).map((it) => [it.id, it]));
  const result = refreshItemsFromMaterial(req.params.id, { itemIds, fields });
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
  return result;
  });
  if (!changed?.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...changed.value, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.patch("/:id/items/:itemId", (req, res) => {
  try {
  const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => {
  const p = loadProject(req.params.id);
  if (!p) return null;
  const before = p.items.find((i) => i.id === req.params.itemId);
  const { expectedRevision: _expectedRevision, ...itemPatch } = req.body || {};
  const it = patchItem(req.params.id, req.params.itemId, itemPatch);
  if (!it) return null;
  logItemPatch({
    projectId: req.params.id,
    itemId: it.id,
    itemName: it.name,
    actor: "admin",
    before,
    patch: itemPatch,
  });
  return it;
  });
  if (!changed?.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...changed.value, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.post("/:id/items/:itemId/replacement-review", reviewItemReplacement);

api.get("/:id/activity", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(listActivity(req.params.id, { clientOnly: false }));
});

api.post("/:id/items", (req, res) => {
  try {
    const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => {
      const { expectedRevision: _expectedRevision, ...item } = req.body || {};
      return addItem(req.params.id, item);
    });
    if (!changed?.value) return res.status(404).json({ error: "Not found" });
    res.status(201).json({ ...changed.value, revision: changed.revision });
  } catch (e) {
    if (revisionErrorResponse(res, e)) return;
    if (e.code === "ITEM_VALIDATION") {
      return res.status(400).json({ error: e.message, details: e.details, code: e.code });
    }
    return res.status(400).json({ error: e.message });
  }
});

api.delete("/:id/items/:itemId", (req, res) => {
  try {
    const changed = mutateWithRevision(req.params.id, req.query?.expectedRevision, () => removeItem(req.params.id, req.params.itemId));
    if (!changed) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.post("/:id/frame-bom/refresh", (req, res) => {
  try {
    const result = refreshFrameBomProject(req.params.id, req.body || {}, { saveItemsWithin });
    res.json({
      ...result.project,
      revision: result.revision,
      summary: result.summary,
      plan: result.plan,
    });
  } catch (e) {
    const known = [
      "FRAME_BOM_REFRESH_CONFLICT",
      "FRAME_BOM_REFRESH_UNSAFE_DELETE",
      "FRAME_BOM_REFRESH_INVALID",
      "PROJECT_REVISION_CONFLICT",
    ];
    if (known.includes(e?.code)) {
      const status = e.status || (e.code === "FRAME_BOM_REFRESH_INVALID" ? 400 : 409);
      return res.status(status).json({
        error: e.code,
        code: e.code,
        message: e.message,
      });
    }
    return res.status(400).json({ error: e.message });
  }
});

function linkExpiresAt() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'clientLinkTtlDays'").get();
  const days = Number(row?.value) || 0;
  if (!days) return "";
  return new Date(Date.now() + days * 86400000).toISOString();
}

api.post("/:id/regenerate-token", (req, res) => {
  try {
  const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => {
  const token = clientToken();
  const expires = linkExpiresAt();
  db.prepare(
    "UPDATE projects SET client_token = ?, client_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(token, expires, req.params.id);
  return { clientToken: token, clientTokenExpiresAt: expires };
  });
  if (!changed) return res.status(404).json({ error: "Not found" });
  res.json({ ...changed.value, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.post("/:id/archive", (req, res) => {
  try { const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => db.prepare("UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(req.params.id));
  if (!changed) return res.status(404).json({ error: "Not found" }); res.json({ ok: true, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

api.post("/:id/restore", (req, res) => {
  try { const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => db.prepare("UPDATE projects SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(req.params.id));
  if (!changed) return res.status(404).json({ error: "Not found" }); res.json({ ok: true, revision: changed.revision });
  } catch (e) { if (!revisionErrorResponse(res, e)) res.status(400).json({ error: e.message, code: e.code }); }
});

/** Admin ID-scoped project image (schemes / rack extras) — no raw /uploads reopen. */
api.get("/:id/media/assets/:assetId", (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  const found = findProjectScopedImageAsset(p, req.params.assetId);
  if (!found.ok) {
    const status = found.code === "INVALID_ASSET_ID" ? 400 : 404;
    return res.status(status).json({ error: found.code === "INVALID_ASSET_ID" ? "Invalid asset id" : "Not found", code: found.code });
  }
  const url = String(found.url || "");
  if (!url.startsWith("/uploads/")) {
    return res.status(404).json({ error: "Not found" });
  }
  return sendSafeUploadFile(res, {
    url,
    filename: path.basename(url),
    inline: true,
    cacheControl: "private, max-age=300",
  });
});

export default api;

function loadBrandingSettings() {
  return loadClientBrand(db);
}

/** Client-visible project files: excludes hidden frame_drawings (is_client_visible=0). */
export function getClientProjectDocuments(projectId) {
  const documents = db.prepare(`
    SELECT
      f.id,
      f.type,
      f.filename,
      f.url,
      f.uploaded_at as uploadedAt,
      fd.title as drawingTitle,
      fd.source_type as drawingSourceType,
      fd.stellage_id as stellageId,
      fd.module_id as moduleId,
      fd.module_rack_key as moduleRackKey,
      fd.preset_id as presetId,
      fd.version as drawingVersion,
      fd.rack_type as rackType
    FROM files f
    LEFT JOIN frame_drawings fd ON fd.file_id = f.id
    WHERE f.project_id = ?
      AND (
        f.type != 'frame_drawing'
        OR (fd.id IS NOT NULL AND fd.is_client_visible = 1)
      )
    ORDER BY f.uploaded_at DESC
  `).all(projectId);

  const latestFrameDrawingByTarget = new Map();
  return documents.filter((document) => {
    if (document.type !== "frame_drawing") return true;
    const targetKey =
      document.moduleRackKey ||
      document.stellageId ||
      document.presetId ||
      document.id;
    const current = latestFrameDrawingByTarget.get(targetKey);
    if (!current) {
      latestFrameDrawingByTarget.set(targetKey, document);
      return true;
    }
    const currentVersion = Number(current.drawingVersion || 0);
    const candidateVersion = Number(document.drawingVersion || 0);
    if (candidateVersion <= currentVersion) return false;
    const currentIndex = documents.indexOf(current);
    if (currentIndex >= 0) documents[currentIndex].__supersededFrameDrawing = true;
    latestFrameDrawingByTarget.set(targetKey, document);
    return true;
  }).filter((document) => !document.__supersededFrameDrawing);
}

function attachClientImageAccessUrls(manifest, token) {
  const mapEntry = (img) => {
    const id = String(img?.id || "").trim();
    if (!id) return { ...img };
    return {
      ...img,
      accessUrl: `/api/client/p/${encodeURIComponent(token)}/images/${encodeURIComponent(id)}`,
    };
  };
  return {
    projectSchemes: (manifest?.projectSchemes || []).map(mapEntry),
    rackImages: (manifest?.rackImages || []).map(mapEntry),
  };
}

function serveClientProject(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }

  const release = parsePublishedRelease(p.manualParams);
  if (!release) {
    return res.status(403).json({
      error: "Project not published for client",
      code: "NOT_PUBLISHED",
    });
  }

  const parsedSnapshot = loadPublishedReleaseSnapshot(p);
  const snapshotItems = parsedSnapshot?.items || [];
  if (!snapshotItems.length) {
    return res.status(403).json({
      error: "Published release snapshot missing",
      code: "PUBLISHED_SNAPSHOT_MISSING",
    });
  }

  const clientProject = buildClientProjectFromRelease(p, parsedSnapshot, { overlayLive: true });
  if (clientProject?.clientImages) {
    clientProject.clientImages = attachClientImageAccessUrls(
      clientProject.clientImages,
      req.clientToken,
    );
  }
  const versions = listVersions(p.id);
  const versionInfoRaw = versions.find((v) => v.id === release.versionId) || versions[0] || null;
  // Admin-only fields must never reach the client DTO.
  const versionInfo = versionInfoRaw
    ? (({ releaseComment: _rc, ...safe }) => safe)(versionInfoRaw)
    : null;
  const documents = resolveClientDocumentsForRelease(parsedSnapshot).map((d) => {
    const { url: _internalUrl, ...safe } = d;
    return {
      ...safe,
      // Keep filename/type for UI; open via token-scoped route only.
      accessUrl: `/api/client/p/${encodeURIComponent(req.clientToken)}/files/${encodeURIComponent(d.id)}`,
    };
  });
  const activity = listActivity(p.id, { clientOnly: true });

  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    project: clientProject,
    projectId: p.id,
    revision: Number(p.revision) || 1,
    versionInfo,
    publishedRelease: release,
    // Intentional live global branding (non-commercial overlay) — see publishedLiveOverlays.js
    branding: loadBrandingSettings(),
    brandingSource: "live_global_settings",
    purchaseStatuses: clientPurchaseStatuses(),
    documents,
    activity,
  });
}

function loadClientProjectOrRespond(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    res.status(410).json({ error: "Link expired" });
    return null;
  }
  return p;
}

function clientWriteError(res, error) {
  if (revisionErrorResponse(res, error)) return true;
  if (error?.code === "EXPECTED_REVISION_REQUIRED") {
    res.status(400).json({ error: error.message, code: error.code, projectId: error.projectId });
    return true;
  }
  return false;
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

function clientSnapshotItem(project, itemId) {
  const items = loadPublishedSnapshotItems(project);
  return items.find((i) => i.id === itemId) || null;
}

function patchClientItem(req, res) {
  try {
    const p = loadClientProjectOrRespond(req, res);
    if (!p) return;
    const snapBefore = clientSnapshotItem(p, req.params.itemId);
    if (!snapBefore || !lineVisibleToClient(snapBefore)) {
      return res.status(403).json({ error: "Item not available" });
    }
    const before = p.items.find((i) => i.id === req.params.itemId) || snapBefore;
    const { expectedRevision: _expectedRevision, ...rawBody } = req.body || {};
    const patch = clientPatchAllowed(rawBody);
    if (patch.status !== undefined && !validateClientStatus(patch.status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const changed = mutateWithRevision(p.id, req.body?.expectedRevision, () => {
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
      return it;
    });
    if (!changed?.value) return res.status(404).json({ error: "Not found" });
    res.json({
      ...prepareClientMutationItemResponse(snapBefore, changed.value),
      revision: changed.revision,
      projectId: p.id,
    });
  } catch (e) {
    if (!clientWriteError(res, e)) res.status(400).json({ error: e.message, code: e.code });
  }
}

function bulkPatchClientItems(req, res) {
  try {
    const p = loadClientProjectOrRespond(req, res);
    if (!p) return;
    const patch = clientPatchAllowed(req.body?.patch || req.body);
    const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
    if (!itemIds.length) return res.status(400).json({ error: "itemIds required" });
    if (patch.status !== undefined && !validateClientStatus(patch.status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const visibleIds = itemIds.filter((id) => {
      const snap = clientSnapshotItem(p, id);
      return snap && lineVisibleToClient(snap);
    });
    if (!visibleIds.length) return res.status(403).json({ error: "No items available" });
    const changed = mutateWithRevision(p.id, req.body?.expectedRevision, () => {
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
      return result;
    });
    if (!changed?.value) return res.status(404).json({ error: "Not found" });
    res.json({
      updated: changed.value.updated.map((it) =>
        prepareClientMutationItemResponse(clientSnapshotItem(p, it.id) || it, it)),
      skipped: changed.value.skipped,
      revision: changed.revision,
      projectId: p.id,
    });
  } catch (e) {
    if (!clientWriteError(res, e)) res.status(400).json({ error: e.message, code: e.code });
  }
}

function proposeClientReplacement(req, res) {
  try {
    const p = loadClientProjectOrRespond(req, res);
    if (!p) return;
    const before = p.items.find((i) => i.id === req.params.itemId) || clientSnapshotItem(p, req.params.itemId);
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
    const changed = mutateWithRevision(p.id, req.body?.expectedRevision, () => {
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
      return it;
    });
    if (!changed?.value) return res.status(404).json({ error: "Not found" });
    res.json({
      ...prepareClientMutationItemResponse(clientSnapshotItem(p, changed.value.id) || before, changed.value),
      revision: changed.revision,
      projectId: p.id,
    });
  } catch (e) {
    if (!clientWriteError(res, e)) res.status(400).json({ error: e.message, code: e.code });
  }
}

function reviewItemReplacement(req, res) {
  try {
  const changed = mutateWithRevision(req.params.id, req.body?.expectedRevision, () => {
  const p = loadProject(req.params.id);
  if (!p) return null;
  const before = p.items.find((i) => i.id === req.params.itemId);
  if (!before) return null;
  const action = req.body?.action;
  if (!["accept", "reject"].includes(action)) {
    const error = new Error("action must be accept or reject");
    error.code = "INVALID_REPLACEMENT_ACTION";
    throw error;
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
    patch: { replacementReview: action, ...req.body, expectedRevision: undefined },
  });
  return it;
  });
  if (!changed?.value) return res.status(404).json({ error: "Not found" });
  res.json({ ...changed.value, revision: changed.revision });
  } catch (e) {
    if (!revisionErrorResponse(res, e)) res.status(e.code === "INVALID_REPLACEMENT_ACTION" ? 400 : 400).json({ error: e.message, code: e.code });
  }
}

function patchClientCooling(req, res) {
  const p = loadClientProjectOrRespond(req, res);
  if (!p) return;
  return res.status(403).json({
    error: "CLIENT_ENGINEERING_MUTATION_FORBIDDEN",
    code: "CLIENT_ENGINEERING_MUTATION_FORBIDDEN",
  });
}

function serveClientReleaseFile(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const release = parsePublishedRelease(p.manualParams);
  if (!release) {
    return res.status(403).json({ error: "Project not published for client", code: "NOT_PUBLISHED" });
  }
  const parsedSnapshot = loadPublishedReleaseSnapshot(p);
  if (!parsedSnapshot?.items?.length) {
    return res.status(403).json({ error: "Published release snapshot missing", code: "PUBLISHED_SNAPSHOT_MISSING" });
  }
  if (isLegacyReleaseIncomplete(parsedSnapshot)) {
    return res.status(404).json({ error: "Not found" });
  }

  const assetId = String(req.params.assetId || "").trim();
  if (!assetId || assetId.includes("..") || assetId.includes("/") || assetId.includes("\\")) {
    return res.status(400).json({ error: "Invalid asset id" });
  }

  const docs = resolveClientDocumentsForRelease(parsedSnapshot);
  const entry = docs.find((d) => d.id === assetId || d.sourceFileId === assetId);
  if (!entry) {
    return res.status(404).json({ error: "Not found" });
  }

  // Pinned release files only — reject non-release paths (no live fallback).
  const url = String(entry.url || "");
  if (!url.startsWith(`/uploads/releases/${p.id}/`)) {
    return res.status(404).json({ error: "Not found" });
  }

  return sendSafeUploadFile(res, {
    url,
    filename: entry.filename,
    inline: true,
    cacheControl: "private, max-age=300",
  });
}

/**
 * Client release-scoped image by frozen imageManifest id.
 * Resolves URL from the snapshot entry only (no live project scheme lookup).
 */
function serveClientReleaseImage(req, res) {
  const p = loadProjectByToken(req.clientToken);
  if (!p) return res.status(404).json({ error: "Not found" });
  if (p.clientTokenExpiresAt && new Date(p.clientTokenExpiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  const release = parsePublishedRelease(p.manualParams);
  if (!release) {
    return res.status(403).json({ error: "Project not published for client", code: "NOT_PUBLISHED" });
  }
  const parsedSnapshot = loadPublishedReleaseSnapshot(p);
  if (!parsedSnapshot?.items?.length) {
    return res.status(403).json({ error: "Published release snapshot missing", code: "PUBLISHED_SNAPSHOT_MISSING" });
  }
  if (isLegacyReleaseIncomplete(parsedSnapshot)) {
    return res.status(404).json({ error: "Not found" });
  }

  const imageId = String(req.params.imageId || "").trim();
  if (!imageId || imageId.includes("..") || imageId.includes("/") || imageId.includes("\\")) {
    return res.status(400).json({ error: "Invalid image id" });
  }

  const entry = findManifestImageById(parsedSnapshot.imageManifest, imageId);
  if (!entry) {
    return res.status(404).json({ error: "Not found" });
  }

  const url = String(entry.url || "").trim();
  if (/^https:\/\//i.test(url)) {
    return res.redirect(302, url);
  }
  if (!url.startsWith("/uploads/")) {
    return res.status(404).json({ error: "Not found" });
  }

  // Prefer release-pinned paths; for older snapshots that froze live upload URLs,
  // still serve ONLY the frozen manifest URL (membership = release scope), never live project lookup.
  return sendSafeUploadFile(res, {
    url,
    filename: path.basename(url) || "image",
    inline: true,
    cacheControl: "private, max-age=300",
  });
}

// Client router — основной путь /api/client/p/:token
export const clientRouter = Router();
clientRouter.use(clientAuthMiddleware);

clientRouter.get("/p/:token", serveClientProject);
clientRouter.get("/p/:token/files/:assetId", serveClientReleaseFile);
clientRouter.get("/p/:token/images/:imageId", serveClientReleaseImage);
clientRouter.get("/p/:token/media", async (req, res) => {
  try {
    const { loadProxyImage } = await import("../services/imageProxy.js");
    // Client media: public catalog only — private prefixes fail closed.
    const { buffer, contentType } = await loadProxyImage(req.query.url, { allowPrivate: false });
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Image fetch failed" });
  }
});
clientRouter.patch("/p/:token/items/bulk", bulkPatchClientItems);
clientRouter.patch("/p/:token/items/:itemId", patchClientItem);
clientRouter.post("/p/:token/items/:itemId/propose-replacement", proposeClientReplacement);
clientRouter.patch("/p/:token/cooling", patchClientCooling);
