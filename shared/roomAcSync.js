import { isSplitSystemName } from "./splitSpecs.js";
import {
  AC_ITEM_NAME,
  AC_ITEM_SECTION,
  AC_CLIENT_SECTION,
  AC_CLIENT_SUBSECTION,
  AC_ITEM_KIND,
  buildAcLineFromRoom,
  splitSpecsFromAcUnits,
} from "./roomAcSpec.js";

/** Синхронизация room.acUnits → позиции сплит-систем в проекте */
export async function syncRoomAcSpecItems(project, rooms, actions) {
  const items = project.items || [];
  const acByRoom = new Map();
  for (const it of items) {
    if (!isSplitSystemName(it.name) || !it.roomId) continue;
    acByRoom.set(it.roomId, it);
  }

  for (const room of rooms || []) {
    const specs = splitSpecsFromAcUnits(room.acUnits);
    const existing = acByRoom.get(room.id) || items.find((it) => it.id === room.acItemId);

    if (!specs.length) {
      if (existing) await actions.itemDelete(project.id, existing.id);
      continue;
    }

    const line = buildAcLineFromRoom(room);
    if (!line) continue;

    const payload = {
      name: AC_ITEM_NAME,
      kind: AC_ITEM_KIND,
      module: AC_ITEM_SECTION,
      section: AC_ITEM_SECTION,
      clientSection: AC_CLIENT_SECTION,
      clientSubsection: AC_CLIENT_SUBSECTION,
      roomId: room.id,
      splitSpecs: line.splitSpecs,
      coolingKw: line.coolingKw,
      clientNote: line.clientNote,
      link: line.link || "",
      techNote: line.techNote || "",
      qty: 1,
      unit: "шт.",
      category: AC_ITEM_SECTION,
      includedInProject: true,
      visibleToClient: true,
      visible: true,
      approved: true,
      enabled: true,
    };

    if (existing) {
      await actions.itemUpdate(project.id, existing.id, payload);
      acByRoom.delete(room.id);
    } else {
      const created = await actions.itemAdd(project.id, payload);
      if (created?.id) {
        await actions.projectUpdate(project.id, {
          rooms: (rooms || []).map((r) =>
            r.id === room.id ? { ...r, acItemId: created.id } : r
          ),
        });
      }
    }
  }
}
