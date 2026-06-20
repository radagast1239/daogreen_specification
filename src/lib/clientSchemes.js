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

export function resolveClientSchemes(manualParams = {}) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const vis = mp.clientSchemeVisible && typeof mp.clientSchemeVisible === "object"
    ? mp.clientSchemeVisible
    : defaultClientSchemeVisible();
  return CLIENT_SCHEME_DEFS.map((def) => ({
    ...def,
    url: mp[def.key] || "",
    clientVisible: vis[def.key] !== false,
  })).filter((s) => s.url);
}

export function clientVisibleSchemes(manualParams = {}) {
  return resolveClientSchemes(manualParams).filter((s) => s.clientVisible);
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
