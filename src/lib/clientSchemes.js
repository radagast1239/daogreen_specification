/** Project/client schemes — stored in project.manualParams.
 * Canonical: manualParams.projectSchemes[{id,title,url,clientVisible,sortOrder}]
 * Legacy: 5 fixed URL keys (floorPlanUrl, …) still hydrate on read.
 */

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

export const SCHEME_SLOT_KEYS = CLIENT_SCHEME_DEFS.map((d) => d.key);

export function defaultClientSchemeVisible() {
  return Object.fromEntries(CLIENT_SCHEME_DEFS.map((d) => [d.key, true]));
}

export function newSchemeId() {
  return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function asMp(manualParams) {
  return manualParams && typeof manualParams === "object" ? manualParams : {};
}

/** Normalize one entry; `key` mirrors `id` for FloorPlanPin / findSchemeIndexByKey. */
export function normalizeSchemeEntry(raw, index = 0) {
  const id = String(raw?.id || raw?.key || "").trim() || newSchemeId();
  const url = String(raw?.url || "").trim();
  const titleRaw = String(raw?.title || raw?.name || "").trim();
  const sortOrder = Number.isFinite(Number(raw?.sortOrder)) ? Number(raw.sortOrder) : index;
  const clientVisible = raw?.clientVisible !== false;
  const label = titleRaw || schemeDisplayTitle({ title: titleRaw, url, label: raw?.label }, index);
  return {
    id,
    key: id,
    title: titleRaw || label,
    label,
    url,
    clientVisible,
    sortOrder,
  };
}

/** Legacy 5 slots → projectSchemes array (always returns entries for slots with url, or empty). */
export function hydrateFromLegacySlots(manualParams = {}) {
  const mp = asMp(manualParams);
  const vis =
    mp.clientSchemeVisible && typeof mp.clientSchemeVisible === "object"
      ? mp.clientSchemeVisible
      : defaultClientSchemeVisible();
  const names = mp.schemeNames && typeof mp.schemeNames === "object" ? mp.schemeNames : {};
  return CLIENT_SCHEME_DEFS.map((def, index) => {
    const url = String(mp[def.key] || "").trim();
    if (!url) return null;
    const title = String(names[def.key] || "").trim() || def.label;
    return normalizeSchemeEntry(
      {
        id: def.key,
        title,
        url,
        clientVisible: vis[def.key] !== false,
        sortOrder: index,
        label: def.label,
      },
      index,
    );
  }).filter(Boolean);
}

/**
 * Canonical list of project schemes (including empty-url drafts).
 * If `projectSchemes` is an array → source of truth (even empty).
 * Else hydrate from legacy URL keys.
 */
export function listProjectSchemes(manualParams = {}) {
  const mp = asMp(manualParams);
  if (Array.isArray(mp.projectSchemes)) {
    return mp.projectSchemes
      .map((raw, i) => normalizeSchemeEntry(raw, i))
      .sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)))
      .map((s, i) => ({ ...s, sortOrder: i, label: schemeDisplayTitle(s, i), title: s.title || schemeDisplayTitle(s, i) }));
  }
  return hydrateFromLegacySlots(mp);
}

/** Replace projectSchemes; does not clear legacy keys (left as historical). */
export function patchProjectSchemes(manualParams, nextList) {
  const mp = { ...asMp(manualParams) };
  const list = (Array.isArray(nextList) ? nextList : []).map((raw, i) =>
    normalizeSchemeEntry({ ...raw, sortOrder: i }, i),
  );
  mp.projectSchemes = list.map((s, i) => ({
    id: s.id,
    title: String(s.title || "").trim(),
    url: String(s.url || "").trim(),
    clientVisible: s.clientVisible !== false,
    sortOrder: i,
  }));
  return mp;
}

export function addProjectScheme(manualParams, partial = {}) {
  const list = listProjectSchemes(manualParams);
  const entry = normalizeSchemeEntry(
    {
      id: partial.id || newSchemeId(),
      title: partial.title || `Схема ${list.length + 1}`,
      url: partial.url || "",
      clientVisible: partial.clientVisible !== false,
      sortOrder: list.length,
    },
    list.length,
  );
  return patchProjectSchemes(manualParams, [...list, entry]);
}

export function updateProjectScheme(manualParams, id, patch) {
  const list = listProjectSchemes(manualParams);
  const next = list.map((s) =>
    s.id === id || s.key === id ? normalizeSchemeEntry({ ...s, ...patch, id: s.id }, s.sortOrder) : s,
  );
  return patchProjectSchemes(manualParams, next);
}

export function removeProjectScheme(manualParams, id) {
  const list = listProjectSchemes(manualParams).filter((s) => s.id !== id && s.key !== id);
  return patchProjectSchemes(manualParams, list);
}

export function moveProjectScheme(manualParams, id, direction) {
  const list = [...listProjectSchemes(manualParams)];
  const idx = list.findIndex((s) => s.id === id || s.key === id);
  if (idx < 0) return asMp(manualParams);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= list.length) return asMp(manualParams);
  const tmp = list[idx];
  list[idx] = list[swap];
  list[swap] = tmp;
  return patchProjectSchemes(manualParams, list);
}

/** Все 5 legacy-слотов (с пустыми url) — для editor / hydrate. */
export function listAllSchemeSlots(manualParams = {}) {
  const mp = asMp(manualParams);
  return CLIENT_SCHEME_DEFS.map((def) => ({
    ...def,
    url: String(mp[def.key] || "").trim(),
  }));
}

/** Заполненные схемы (legacy slots или projectSchemes). */
export function filledSchemeSlots(manualParams = {}) {
  return listProjectSchemes(manualParams).filter((s) => s.url);
}

export function countFilledSchemes(manualParams = {}) {
  return filledSchemeSlots(manualParams).length;
}

/**
 * Hydrate slot map from project.manualParams (stable legacy keys only).
 * @returns {Record<string, string>}
 */
export function hydrateSchemeSlotsFromManualParams(manualParams = {}) {
  const mp = asMp(manualParams);
  return Object.fromEntries(SCHEME_SLOT_KEYS.map((key) => [key, String(mp[key] || "").trim()]));
}

export function resolveClientSchemes(manualParams = {}) {
  return listProjectSchemes(manualParams)
    .filter((s) => s.url)
    .map((s, index) => ({
      ...s,
      key: s.id || s.key,
      title: schemeDisplayTitle(s, index),
      label: schemeDisplayTitle(s, index),
    }));
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
  const idx = (schemes || []).findIndex((s) => s.key === key || s.id === key);
  return idx >= 0 ? idx : 0;
}

/** Patch one legacy slot only — never clears other scheme keys. */
export function patchManualSchemes(manualParams, key, url) {
  if (!SCHEME_SLOT_KEYS.includes(key)) {
    return { ...asMp(manualParams) };
  }
  const mp = { ...asMp(manualParams) };
  mp[key] = url || "";
  if (!Array.isArray(mp.projectSchemes)) return mp;
  const list = listProjectSchemes(mp);
  const idx = list.findIndex((s) => s.id === key);
  if (idx >= 0) {
    list[idx] = { ...list[idx], url: url || "" };
    return patchProjectSchemes(mp, list);
  }
  if (url) {
    list.push(
      normalizeSchemeEntry(
        {
          id: key,
          title: CLIENT_SCHEME_DEFS.find((d) => d.key === key)?.label || key,
          url,
        },
        list.length,
      ),
    );
    return patchProjectSchemes(mp, list);
  }
  return mp;
}

export function patchSchemeVisibility(manualParams, key, visible) {
  const mp = asMp(manualParams);
  if (Array.isArray(mp.projectSchemes) || listProjectSchemes(mp).some((s) => s.id === key || s.key === key)) {
    return updateProjectScheme(mp, key, { clientVisible: visible });
  }
  const next = { ...mp };
  next.clientSchemeVisible = {
    ...defaultClientSchemeVisible(),
    ...(next.clientSchemeVisible || {}),
    [key]: visible,
  };
  return next;
}

/**
 * FloorPlanField read: when projectSchemes[] exists, first entry url; else legacy floorPlanUrl.
 */
export function getFloorPlanUrl(manualParams = {}) {
  const mp = asMp(manualParams);
  if (Array.isArray(mp.projectSchemes)) {
    const first = listProjectSchemes(mp)[0];
    return String(first?.url || "").trim();
  }
  return String(mp.floorPlanUrl || "").trim();
}

/**
 * FloorPlanField write: sync projectSchemes[0] when array model active; always mirror floorPlanUrl.
 */
export function setFloorPlanUrl(manualParams, url) {
  const mp = asMp(manualParams);
  const nextUrl = String(url || "").trim();
  if (Array.isArray(mp.projectSchemes)) {
    const list = listProjectSchemes(mp);
    let next;
    if (!list.length) {
      next = addProjectScheme(mp, {
        id: "floorPlanUrl",
        title: CLIENT_SCHEME_DEFS[0]?.label || "Общая схема помещения",
        url: nextUrl,
        clientVisible: true,
      });
    } else {
      next = updateProjectScheme(mp, list[0].id, { url: nextUrl });
    }
    return { ...next, floorPlanUrl: nextUrl };
  }
  return { ...mp, floorPlanUrl: nextUrl };
}
