import React, { useMemo } from "react";
import { num } from "../store/helpers.js";
import { isFarmGeneralItem, roomLabel } from "../lib/roomHelpers.js";
import { roomAcRecommendedKw, roomAcRecommendedBtu, roomAcRecommendedElecKw } from "../../shared/roomAcSpec.js";
import Collapsible from "./Collapsible.jsx";

function resolveItemRoomId(item, rooms, itemRoomBySelection) {
  if (item?.roomId) return item.roomId;
  return itemRoomBySelection.get(item?.id) || "_none";
}

export default function RoomCoolingSummary({ project, forceOpen = false }) {
  const rows = useMemo(() => {
    const rooms = project.rooms || [];
    const items = project.items || [];
    const itemRoomBySelection = new Map();
    for (const room of rooms) {
      if (room?.selectedItemId) itemRoomBySelection.set(room.selectedItemId, room.id);
    }

    const map = new Map();
    for (const it of items) {
      if (!isFarmGeneralItem(project, it)) continue;
      const rid = resolveItemRoomId(it, rooms, itemRoomBySelection);
      if (!map.has(rid)) {
        map.set(rid, { roomId: rid, kw: 0, btu: 0, exhaust: 0, items: 0 });
      }
      const r = map.get(rid);
      r.kw += Number(it.coolingKw) || 0;
      r.btu += Number(it.coolingBtu) || 0;
      r.exhaust += Number(it.exhaustM3) || 0;
      r.items += 1;
    }
    return [...map.values()].map((r) => {
      const room = rooms.find((rm) => rm.id === r.roomId);
      if (!room) return r;
      return {
        ...r,
        kw: r.kw || roomAcRecommendedKw(room) || 0,
        btu: r.btu || roomAcRecommendedBtu(room) || 0,
        consumption: roomAcRecommendedElecKw(room) || 0,
      };
    });
  }, [project]);

  const total = rows.reduce(
    (a, r) => ({ kw: a.kw + r.kw, btu: a.btu + r.btu, exhaust: a.exhaust + r.exhaust }),
    { kw: 0, btu: 0, exhaust: 0 }
  );

  if (!rows.length) return null;

  const body = (
    <div className="card" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div
          key={r.roomId}
          style={{
            padding: "8px 12px",
            background: "var(--bg-info, #eef6ff)",
            border: "1px solid var(--border-info, #cfe3fb)",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <b>Комната {roomLabel(project.rooms, r.roomId) || "—"}</b>
          {" · "}
          холод <span className="num">{num(r.kw)}</span> кВт
          {" · "}
          <span className="num">{num(r.btu)}</span> BTU
          {" · "}
          потребление ~<span className="num">{num(r.consumption)}</span> кВт
          {r.exhaust > 0 && (
            <>
              {" · "}вытяжка <span className="num">{num(r.exhaust)}</span> м³/ч
            </>
          )}
        </div>
      ))}
    </div>
  );

  if (forceOpen) return body;

  return (
    <Collapsible title="Сводка по комнатам (охлаждение / вытяжка)" defaultOpen={false}>
      {body}
    </Collapsible>
  );
}
