import { db, loadProjectItems } from "../db.js";
import { parsePublishRulesSettings, validateItemsForPublish } from "../../../shared/publishRules.js";

export function loadPublishRulesConfig() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return parsePublishRulesSettings(obj);
}

export function validateProjectForPublish(projectId) {
  const items = loadProjectItems(projectId);
  return validateItemsForPublish(items, loadPublishRulesConfig());
}

export function publishRulesSettingsPayload(obj = {}) {
  const cfg = parsePublishRulesSettings(obj);
  return {
    publishRules: JSON.stringify(cfg.rules),
    clientLinkTemplate: cfg.clientLinkTemplate,
  };
}
