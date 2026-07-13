/** Схемы для клиента — хранятся в project.manualParams */

export const CLIENT_SCHEME_DEFS = [
  {
    key: "floorPlanUrl",
    label: "Общая схема помещения",
    hint: "План с зонами и стеллажами",
  },
  {
    key: "schemePipesUrl",
    label: "Схема труб",
    hint: "Магистрали, подводы, коллекторы",
  },
  {
    key: "schemeStellagesUrl",
    label: "Расстановка стеллажей",
    hint: "План размещения стеллажей",
  },
  {
    key: "schemeTechnicalUrl",
    label: "Технические помещения",
    hint: "Насосная, электрощитовая и т.д.",
  },
  {
    key: "schemeElectricalUrl",
    label: "Электрика",
    hint: "Линии, щиты, розетки",
  },
];

export function defaultClientSchemeVisible() {
  return Object.fromEntries(CLIENT_SCHEME_DEFS.map((d) => [d.key, true]));
}

/** Имя файла из URL схемы (без query). */
export function schemeFilenameFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const path = raw.split("?")[0].split("#")[0];
    const name = path.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(name).trim();
  } catch {
    return "";
  }
}

/**
 * Название схемы: label → room/drawing name → filename → «Схема N».
 * roomName / drawingName — опциональные поля, если появятся в данных.
 */
export function schemeDisplayTitle(scheme, index = 0) {
  const custom = String(scheme?.title || scheme?.name || "").trim();
  if (custom) return custom;
  const label = String(scheme?.label || "").trim();
  if (label) return label;
  const room = String(scheme?.roomName || scheme?.drawingName || "").trim();
  if (room) return room;
  const file = schemeFilenameFromUrl(scheme?.url || scheme?.filename);
  if (file) return file;
  return `Схема ${Math.max(1, Number(index) + 1 || 1)}`;
}

export function resolveClientSchemes(manualParams = {}) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const vis = mp.clientSchemeVisible && typeof mp.clientSchemeVisible === "object"
    ? mp.clientSchemeVisible
    : defaultClientSchemeVisible();
  const names = mp.schemeNames && typeof mp.schemeNames === "object" ? mp.schemeNames : {};
  return CLIENT_SCHEME_DEFS.map((def, index) => ({
    ...def,
    url: mp[def.key] || "",
    clientVisible: vis[def.key] !== false,
    title: schemeDisplayTitle(
      { ...def, title: names[def.key] || "", url: mp[def.key] || "" },
      index
    ),
  })).filter((s) => s.url);
}

/** Все загруженные схемы для админ-просмотрщика (без фильтра клиентской видимости). */
export function listUploadedSchemes(manualParams = {}) {
  return resolveClientSchemes(manualParams);
}

export function clientVisibleSchemes(manualParams = {}) {
  return resolveClientSchemes(manualParams).filter((s) => s.clientVisible);
}

export function findSchemeIndexByKey(schemes, key) {
  if (!key) return 0;
  const idx = (schemes || []).findIndex((s) => s.key === key);
  return idx >= 0 ? idx : 0;
}

export function patchManualSchemes(manualParams, key, url) {
  const mp = { ...(manualParams || {}) };
  mp[key] = url || "";
  return mp;
}

export function patchSchemeVisibility(manualParams, key, visible) {
  const mp = { ...(manualParams || {}) };
  mp.clientSchemeVisible = {
    ...defaultClientSchemeVisible(),
    ...(mp.clientSchemeVisible || {}),
    [key]: visible,
  };
  return mp;
}
