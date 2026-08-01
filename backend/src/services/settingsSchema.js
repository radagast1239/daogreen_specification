/**
 * Explicit allowlist/schema for PATCH /api/admin/settings.
 *
 * The settings table is a generic key/value store. Only keys listed here may be
 * written through the admin UI endpoint. Everything else — migration state,
 * session/security version, internal flags, DB metadata, release/deploy data,
 * filesystem paths, etc. — is rejected atomically.
 */

/** UI-editable settings keys with type/range constraints. */
export const UI_EDITABLE_SETTINGS_SCHEMA = {
  // Brand / contacts (ClientBrandTab + SettingsPage overview/links)
  companyName: { type: "string", maxLength: 200, empty: true },
  contactPhone: { type: "string", maxLength: 200, empty: true },
  contactEmail: { type: "string", maxLength: 200, empty: true },
  contactTelegram: { type: "string", maxLength: 200, empty: true },
  brandColor: { type: "string", maxLength: 50, empty: true },
  brandAccentColor: { type: "string", maxLength: 50, empty: true },
  brandBgColor: { type: "string", maxLength: 50, empty: true },
  logoUrl: { type: "string", maxLength: 1000, empty: true },
  clientHeroEyebrow: { type: "string", maxLength: 500, empty: true },
  clientTrustLines: { type: "string", maxLength: 20000, empty: false, jsonType: "array" },
  clientVisibleTabs: { type: "string", maxLength: 2000, empty: false, jsonType: "array" },
  clientPdfColumns: { type: "string", maxLength: 2000, empty: false, jsonType: "array" },
  clientPdfFooter: { type: "string", maxLength: 1000, empty: true },
  clientPdfShowQr: { type: "string", enum: ["true", "false"], empty: true },

  // Client sections / purchase sections (PublishRulesTab + DirectoriesTab)
  clientSectionsJson: { type: "string", maxLength: 200000, empty: false, jsonType: "array" },

  // Material categories (SettingsPage + DirectoriesTab)
  materialCategories: { type: "string", maxLength: 50000, empty: false, jsonType: "array" },

  // Client link TTL (SettingsPage links tab)
  clientLinkTtlDays: { type: "string", pattern: /^\d+$/, maxLength: 10, empty: true },

  // Publish rules (PublishRulesTab)
  publishRules: { type: "string", maxLength: 50000, empty: false, jsonType: "object" },
  clientLinkTemplate: { type: "string", maxLength: 10000, empty: true },

  // Reference data (DirectoriesTab)
  refTags: { type: "string", maxLength: 50000, empty: false, jsonType: "array" },
  refUnits: { type: "string", maxLength: 50000, empty: false, jsonType: "array" },
  refPurchaseStatuses: { type: "string", maxLength: 100000, empty: false, jsonType: "array" },
  refResponsibleRoles: { type: "string", maxLength: 100000, empty: false, jsonType: "array" },
  refFarmTypes: { type: "string", maxLength: 50000, empty: false, jsonType: "array" },
  refStellageGroups: { type: "string", maxLength: 100000, empty: false, jsonType: "array" },
  refFarmSectionGroups: { type: "string", maxLength: 100000, empty: false, jsonType: "array" },

  // Farm sections / templates (ModulesPage farm + stellage tabs)
  farmSections: { type: "string", maxLength: 200000, empty: false, jsonType: "array" },
  farmSectionCatalogs: { type: "string", maxLength: 2000000, empty: false, jsonType: "record" },
  farmSectionVersions: { type: "string", maxLength: 1000000, empty: false, jsonType: "record" },
  stellageModuleCatalogs: { type: "string", maxLength: 2000000, empty: false, jsonType: "record" },
  stellageModuleMeta: { type: "string", maxLength: 500000, empty: false, jsonType: "record" },
};

/** Keys that are never writable through the UI settings endpoint. */
export const SERVER_OWNED_SETTINGS_KEYS = new Set([
  // Auth / security
  "adminSessionVersion",
  // Migration markers
  "migration_client_visible_default_v2",
  // Legacy farm-section keys (replaced by farmSections; kept read-only for migration fallbacks)
  "farmSectionOrder",
  "farmSectionNames",
]);

const FORBIDDEN_KEY_PREFIXES = ["__proto__", "constructor", "prototype"];

function isForbiddenKey(key) {
  if (typeof key !== "string") return true;
  if (FORBIDDEN_KEY_PREFIXES.includes(key)) return true;
  return false;
}

const MAGIC_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Recursively check whether a JSON value contains dangerous keys that could be
 * used for prototype pollution when the value is later spread or used as a map.
 */
function hasMagicKey(value) {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (current && typeof current === "object") {
      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
      } else {
        for (const key of Object.keys(current)) {
          if (MAGIC_KEYS.has(key)) return true;
          stack.push(current[key]);
        }
      }
    }
  }
  return false;
}

function validateJsonSetting(_key, raw, jsonType) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "json_parse" };
  }

  if (jsonType === "array") {
    if (!Array.isArray(parsed)) return { ok: false, reason: "json_type" };
    return { ok: true };
  }

  if (jsonType === "object" || jsonType === "record") {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "json_type" };
    }
    if (hasMagicKey(parsed)) return { ok: false, reason: "json_magic_key" };
    return { ok: true };
  }

  return { ok: false, reason: "unsupported_json_type" };
}

function normalizeSettingValue(value, schema) {
  if (value === null || value === undefined) {
    return { ok: true, value: schema.empty ? "" : null };
  }

  if (schema.type === "string") {
    if (typeof value === "string") return { ok: true, value };

    // Accept booleans for enum keys that store "true" / "false".
    if (schema.enum && typeof value === "boolean") {
      return { ok: true, value: value ? "true" : "false" };
    }

    // Accept finite numbers for numeric-string keys.
    if (schema.pattern && /^\\d+$/.source === schema.pattern.source && typeof value === "number") {
      if (Number.isFinite(value) && value >= 0) return { ok: true, value: String(Math.floor(value)) };
      return { ok: false, reason: "range" };
    }

    // Objects, arrays, symbols, functions are scalar type errors.
    return { ok: false, reason: "type" };
  }

  return { ok: false, reason: "unsupported_type" };
}

function validateSettingValue(key, value, schema) {
  if (value === null || value === undefined) {
    if (!schema.empty) return { ok: false, reason: "null_not_allowed" };
    return { ok: true, value: "" };
  }

  if (schema.type === "string") {
    if (typeof value !== "string") return { ok: false, reason: "type" };
    const str = value;
    if (str.length > schema.maxLength) return { ok: false, reason: "maxLength" };
    if (schema.pattern && !schema.pattern.test(str)) return { ok: false, reason: "pattern" };
    if (schema.enum && !schema.enum.includes(str)) return { ok: false, reason: "enum" };
    if (schema.jsonType) {
      const jsonResult = validateJsonSetting(key, str, schema.jsonType);
      if (!jsonResult.ok) return { ok: false, reason: jsonResult.reason };
    }
    return { ok: true, value: str };
  }

  return { ok: false, reason: "unsupported_type" };
}

/**
 * Validate a settings patch payload against the explicit UI allowlist.
 *
 * @param {object} body
 * @returns {object}
 *   - ok: boolean
 *   - values: Map<string, string>|undefined  — normalized values to write
 *   - forbiddenKeys: string[]|undefined
 *   - invalidKeys: Array<{key, reason}>|undefined
 */
export function validateSettingsPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      forbiddenKeys: ["__invalid_body_type"],
      invalidKeys: [],
    };
  }

  const keys = Object.keys(body);
  const forbiddenKeys = [];
  const invalidKeys = [];
  const values = new Map();

  for (const key of keys) {
    if (isForbiddenKey(key) || SERVER_OWNED_SETTINGS_KEYS.has(key) || !(key in UI_EDITABLE_SETTINGS_SCHEMA)) {
      forbiddenKeys.push(key);
      continue;
    }

    const schema = UI_EDITABLE_SETTINGS_SCHEMA[key];
    const normalized = normalizeSettingValue(body[key], schema);
    if (!normalized.ok) {
      invalidKeys.push({ key, reason: normalized.reason });
      continue;
    }

    const result = validateSettingValue(key, normalized.value, schema);
    if (!result.ok) {
      invalidKeys.push({ key, reason: result.reason });
      continue;
    }

    values.set(key, result.value);
  }

  if (forbiddenKeys.length || invalidKeys.length) {
    return {
      ok: false,
      forbiddenKeys,
      invalidKeys,
    };
  }

  return { ok: true, values };
}
