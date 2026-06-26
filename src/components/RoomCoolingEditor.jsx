import React, { useMemo } from "react";
import { enrichRoom, recommendedCoolingKw, roomVolume, actualCoolingFromItem } from "../../shared/roomCoolingCalc.js";
import { num } from "../store/helpers.js";
import { isSplitSystemName } from "../../shared/splitSpecs.js";
import { useDebouncedSync } from "../lib/useDebouncedSync.js";

function parseNumInput(raw) {
  if (raw === "" || raw == null) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

export default function RoomCoolingEditor({ rooms, items, onChange, onLinkItem }) {
  const [list, setList] = useDebouncedSync(rooms?.length ? rooms : [], onChange, 450);
  const acItems = useMemo(
    () => (items || []).filter((it) => isSplitSystemName(it.name) || Number(it.coolingKw) > 0),
    [items]
  );

  const patch = (id, data, { immediate = false } = {}) => {
    const prev = list.find((r) => r.id === id);
    const next = list.map((r) => {
      if (r.id !== id) return r;
      const merged = enrichRoom({ ...r, ...data });
      if (data.selectedItemId !== undefined) {
        const sel = acItems.find((it) => it.id === data.selectedItemId);
        merged.actualCoolingKw = sel ? actualCoolingFromItem(sel) : "";
      }
      return merged;
    });
    if (data.selectedItemId !== undefined && onLinkItem) {
      const prevId = prev?.selectedItemId;
      const newId = data.selectedItemId;
      if (prevId && prevId !== newId) {
        const prevItem = acItems.find((it) => it.id === prevId);
        if (prevItem?.roomId === id) onLinkItem(prevId, { roomId: "" });
      }
      if (newId) onLinkItem(newId, { roomId: id });
      else if (prevId) {
        const prevItem = acItems.find((it) => it.id === prevId);
        if (prevItem?.roomId === id) onLinkItem(prevId, { roomId: "" });
      }
    }
    if (immediate) onChange(next);
    else setList(next);
  };

  if (!list.length) return null;

  return (
    <div className="card" style={{ padding: 0, marginTop: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>Расчёт кондиционеров по комнатам</h4>
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Нагрузки вручную + освещение. Рекомендуемая мощность — ориентир; кондиционер можно привязать к позиции спецификации.
        </p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="spec" style={{ margin: 0, fontSize: 12 }}>
          <thead>
            <tr>
              <th>Комната</th>
              <th className="right">S, м²</th>
              <th className="right">H, м</th>
              <th className="right">V, м³</th>
              <th className="right">Теплопритоки, Вт</th>
              <th className="right">Свет, Вт</th>
              <th className="right">Люди/обор., Вт</th>
              <th className="right">T°, °C</th>
              <th className="right">Запас, %</th>
              <th className="right">Рек. кВт</th>
              <th>Кондиционер</th>
              <th className="right">Факт. кВт</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {list.map((raw) => {
              const r = enrichRoom(raw);
              const vol = roomVolume(r);
              const rec = recommendedCoolingKw(r);
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="right">
                    <input
                      type="number"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 64 }}
                      value={raw.area ?? ""}
                      onChange={(e) => patch(r.id, { area: parseNumInput(e.target.value) })}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 56 }}
                      value={raw.height ?? ""}
                      onChange={(e) => patch(r.id, { height: parseNumInput(e.target.value) })}
                    />
                  </td>
                  <td className="right num">{num(vol) || "—"}</td>
                  <td className="right">
                    <input
                      type="number"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 72 }}
                      value={raw.heatGainW ?? ""}
                      onChange={(e) => patch(r.id, { heatGainW: parseNumInput(e.target.value) })}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 64 }}
                      value={raw.lightingW ?? ""}
                      onChange={(e) => patch(r.id, { lightingW: parseNumInput(e.target.value) })}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 72 }}
                      value={raw.peopleEquipW ?? ""}
                      onChange={(e) =>
                        patch(r.id, { peopleEquipW: parseNumInput(e.target.value) })
                      }
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 52 }}
                      value={raw.targetTempC ?? ""}
                      onChange={(e) =>
                        patch(r.id, { targetTempC: parseNumInput(e.target.value) })
                      }
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 52 }}
                      value={raw.reservePct ?? ""}
                      onChange={(e) =>
                        patch(r.id, { reservePct: parseNumInput(e.target.value) })
                      }
                    />
                  </td>
                  <td className="right num">{num(rec) || "—"}</td>
                  <td>
                    <select
                      value={r.selectedItemId || ""}
                      onChange={(e) => patch(r.id, { selectedItemId: e.target.value }, { immediate: true })}
                      style={{ maxWidth: 160, fontSize: 11 }}
                    >
                      <option value="">— не выбран —</option>
                      {acItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.coolingKw || "?"} кВт)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="right num">
                    {r.actualCoolingKw != null && r.actualCoolingKw !== ""
                      ? num(r.actualCoolingKw)
                      : r.selectedItemId
                        ? num(actualCoolingFromItem(acItems.find((it) => it.id === r.selectedItemId)))
                        : "—"}
                  </td>
                  <td>
                    <input
                      value={raw.comment || ""}
                      onChange={(e) => patch(r.id, { comment: e.target.value })}
                      style={{ minWidth: 100 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
