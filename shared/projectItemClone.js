/** Клонирование позиций проекта — снимок без связи с источником */

const CLIENT_PURCHASE_FIELDS_RESET = {
  status: "not_bought",
  actualPrice: null,
  clientComment: "",
};

/** Поля, которые не копируются в новый проект */
const STRIP_ON_CLONE = new Set([
  "id",
  "projectId",
  "project_id",
  "createdAt",
  "updatedAt",
]);

export function cloneProjectItem(it, { newId, mode = "new_purchase" } = {}) {
  const base = { ...it };
  for (const k of STRIP_ON_CLONE) delete base[k];
  if (newId) base.id = newId;
  if (mode === "new_purchase") {
    Object.assign(base, CLIENT_PURCHASE_FIELDS_RESET);
  }
  return base;
}

export function cloneProjectItems(items, { idGen, mode = "new_purchase" } = {}) {
  return cloneProjectItemsWithIdMap(items, { idGen, mode }).items;
}

/** Клон позиций + карта старый id → новый id (для rooms.selectedItemId и т.п.) */
export function cloneProjectItemsWithIdMap(items, { idGen, mode = "new_purchase" } = {}) {
  const idMap = new Map();
  const cloned = (items || []).map((it, idx) => {
    const oldId = it?.id;
    const newId = idGen ? idGen(it, idx) : undefined;
    if (oldId && newId) idMap.set(oldId, newId);
    return cloneProjectItem(it, { newId, mode });
  });
  return { items: cloned, idMap };
}

export function remapRoomsSelectedItemIds(rooms, idMap) {
  if (!idMap?.size) return rooms || [];
  return (rooms || []).map((room) => {
    const sid = room?.selectedItemId;
    if (!sid) return room;
    const mapped = idMap.get(sid);
    if (mapped) return { ...room, selectedItemId: mapped };
    return { ...room, selectedItemId: "", actualCoolingKw: "" };
  });
}

export function stripProjectForClone(project, { mode = "new_purchase" } = {}) {
  const {
    id,
    clientToken,
    version,
    lastClientActivityAt,
    clientTokenExpiresAt,
    purchaseStartedAt,
    installationDoneAt,
    createdAt,
    updatedAt,
    items,
    ...meta
  } = project;
  return {
    ...meta,
    version: 1,
    lastClientActivityAt: null,
    clientTokenExpiresAt: "",
    purchaseStartedAt: mode === "new_purchase" ? "" : purchaseStartedAt || "",
    installationDoneAt: "",
  };
}

export function templateItemFromProjectItem(it) {
  const {
    id,
    materialId,
    status,
    actualPrice,
    clientComment,
    projectId,
    ...rest
  } = it;
  return {
    ...rest,
    materialId: materialId || "",
    status: "not_bought",
    actualPrice: null,
    clientComment: "",
  };
}
