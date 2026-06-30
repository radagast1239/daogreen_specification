import React, { useMemo } from "react";
import {
  addRoomAcUnit,
  actualCoolingFromRoom,
  flattenRoomAcSpecRows,
  moveAcUnitRoom,
  patchRoomAcUnits,
  removeRoomAcUnit,
} from "../../shared/roomAcSpec.js";
import {
  enrichRoom,
  recommendedCoolingKw,
  roomVolume,
} from "../../shared/roomCoolingCalc.js";
import { num } from "../store/helpers.js";
import { useDebouncedSync } from "../lib/useDebouncedSync.js";

function parseNumInput(raw) {
  if (raw === "" || raw == null) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

export default function RoomCoolingEditor({ rooms, onChange }) {
  const [list, setList] = useDebouncedSync(rooms?.length ? rooms : [], onChange, 450);

  const specRows = useMemo(() => flattenRoomAcSpecRows(list), [list]);

  const patch = (id, data, { immediate = false } = {}) => {
    const next = list.map((r) => (r.id === id ? enrichRoom({ ...r, ...data }) : r));
    if (immediate) onChange(next);
    else setList(next);
  };

  const patchUnit = (roomId, unitId, data, { immediate = false } = {}) => {
    const next = patchRoomAcUnits(list, roomId, unitId, data).map(enrichRoom);
    if (immediate) onChange(next);
    else setList(next);
  };

  const addUnit = (roomId, { immediate = true } = {}) => {
    const next = addRoomAcUnit(list, roomId).map(enrichRoom);
    if (immediate) onChange(next);
    else setList(next);
  };

  const removeUnit = (roomId, unitId) => {
    onChange(removeRoomAcUnit(list, roomId, unitId).map(enrichRoom));
  };

  const changeUnitRoom = (fromRoomId, unitId, toRoomId) => {
    onChange(moveAcUnitRoom(list, unitId, fromRoomId, toRoomId).map(enrichRoom));
  };

  if (!list.length) return null;

  const defaultAddRoomId = list[list.length - 1]?.id || list[0]?.id;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <h4 style={{ margin: 0, fontSize: 14 }}>Расчёт нагрузки по комнатам</h4>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Площадь, освещение и теплопритоки — для ориентира «Рек. кВт».
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
                <th className="right">Факт. кВт</th>
              </tr>
            </thead>
            <tbody>
              {list.map((raw) => {
                const r = enrichRoom(raw);
                const vol = roomVolume(r);
                const rec = recommendedCoolingKw(r);
                const actual = actualCoolingFromRoom(r);
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
                    <td className="right num">{actual > 0 ? num(actual) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 14, overflow: "hidden" }}>
        <div
          className="between wrap"
          style={{ gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}
        >
          <div>
            <h4 style={{ margin: 0, fontSize: 14 }}>Спецификация кондиционеров для клиента</h4>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              По одной строке на каждый кондиционер: комната, кол-во и мощность. «＋ кондиционер» — следующая
              позиция (в той же или другой комнате).
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => defaultAddRoomId && addUnit(defaultAddRoomId)}
          >
            ＋ кондиционер
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="spec" style={{ margin: 0, fontSize: 12 }}>
            <thead>
              <tr>
                <th>Комната</th>
                <th className="right">Рек. кВт</th>
                <th className="right">шт</th>
                <th className="right">кВт</th>
                <th>Ссылка</th>
                <th>Комментарий</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {specRows.map(({ unit, roomId, roomName, recommendedKw, rowKey }) => (
                <tr key={rowKey}>
                  <td>
                    <select
                      className="spec-cell-input"
                      value={roomId}
                      onChange={(e) => changeUnitRoom(roomId, unit.id, e.target.value)}
                      style={{ minWidth: 140, fontSize: 11 }}
                    >
                      {list.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="right num muted">{num(recommendedKw) || "—"}</td>
                  <td className="right">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 52 }}
                      value={unit.qty ?? ""}
                      onChange={(e) =>
                        patchUnit(roomId, unit.id, { qty: parseNumInput(e.target.value) })
                      }
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="spec-cell-input spec-cell-input--num"
                      style={{ width: 64 }}
                      value={unit.coolingKw ?? ""}
                      onChange={(e) =>
                        patchUnit(roomId, unit.id, { coolingKw: parseNumInput(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="url"
                      className="spec-cell-input"
                      placeholder="https://…"
                      value={unit.link || ""}
                      onChange={(e) => patchUnit(roomId, unit.id, { link: e.target.value })}
                      style={{ minWidth: 120 }}
                    />
                  </td>
                  <td>
                    <input
                      className="spec-cell-input"
                      value={unit.comment || ""}
                      placeholder={roomName}
                      onChange={(e) => patchUnit(roomId, unit.id, { comment: e.target.value })}
                      style={{ minWidth: 100 }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Удалить строку"
                      disabled={specRows.length <= 1}
                      onClick={() => removeUnit(roomId, unit.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
