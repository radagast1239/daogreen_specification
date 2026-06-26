import React, { useMemo } from "react";
import { num } from "../store/helpers.js";
import { isFarmGeneralItem, roomLabel } from "../lib/roomHelpers.js";
import Collapsible from "./Collapsible.jsx";

function resolveItemRoomId(item, rooms, itemRoomBySelection) {
  if (item?.roomId) return item.roomId;
  return itemRoomBySelection.get(item?.id) || "_none";
}

export default function RoomCoolingSummary({ project }) {
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
    return [...map.values()];
  }, [project]);

  const total = rows.reduce(
    (a, r) => ({ kw: a.kw + r.kw, btu: a.btu + r.btu, exhaust: a.exhaust + r.exhaust }),
    { kw: 0, btu: 0, exhaust: 0 }
  );

  if (!rows.length) return null;

  return (
    <Collapsible title="Сводка по комнатам (охлаждение / вытяжка)" defaultOpen>
      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table className="spec">
          <thead>
            <tr>
              <th>Комната</th>
              <th className="right">кВт</th>
              <th className="right">BTU</th>
              <th className="right">м³/ч</th>
              <th className="right">Позиций</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.roomId}>
                <td>{roomLabel(project.rooms, r.roomId) || "—"}</td>
                <td className="right num">{num(r.kw)}</td>
                <td className="right num">{num(r.btu)}</td>
                <td className="right num">{num(r.exhaust)}</td>
                <td className="right num">{r.items}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td>Итого</td>
              <td className="right num">{num(total.kw)}</td>
              <td className="right num">{num(total.btu)}</td>
              <td className="right num">{num(total.exhaust)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Collapsible>
  );
}
