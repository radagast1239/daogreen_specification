import { db, loadProjectItems, rowToMaterial } from "../db.js";
import { parsePublishRulesSettings } from "../../../shared/publishRules.js";
import { configureClientSections, parseClientSectionsJson } from "../../../shared/clientSections.js";
import { enrichItemsForPublishCheck, runPrePublishCheck } from "../../../shared/projectReadiness.js";

function loadSettingsObject() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function loadPublishRulesConfig() {
  const obj = loadSettingsObject();
  configureClientSections(parseClientSectionsJson(obj.clientSectionsJson));
  return parsePublishRulesSettings(obj);
}

function materialsByIdForItems(items) {
  const ids = [...new Set((items || []).map((it) => it.materialId).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM materials WHERE id IN (${placeholders})`).all(...ids);
  return new Map(rows.map((row) => [row.id, rowToMaterial(row)]));
}

export function validateProjectForPublishFromItems(_projectId, items) {
  const config = loadPublishRulesConfig();
  const enriched = enrichItemsForPublishCheck(items, materialsByIdForItems(items));
  return runPrePublishCheck(enriched, config);
}

export function validateProjectForPublish(projectId) {
  return validateProjectForPublishFromItems(projectId, loadProjectItems(projectId));
}

export function publishRulesSettingsPayload(obj = {}) {
  const cfg = parsePublishRulesSettings(obj);
  return {
    publishRules: JSON.stringify(cfg.rules),
    clientLinkTemplate: cfg.clientLinkTemplate,
  };
}
