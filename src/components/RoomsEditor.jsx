import React from "react";
import { newRoom, ROOM_NAME_HINTS } from "../lib/roomHelpers.js";

export default function RoomsEditor({ rooms, onChange, compact = false, showCount = true }) {
  const list = rooms?.length ? rooms : [];

  const patch = (id, data) => onChange(list.map((r) => (r.id === id ? { ...r, ...data } : r)));

  const add = () => {
    const hint = ROOM_NAME_HINTS[list.length] || "";
    onChange([...list, newRoom(hint || `Комната ${list.length + 1}`)]);
  };

  const setCount = (raw) => {
    const n = Math.max(0, Math.min(24, Number(raw) || 0));
    if (n === list.length) return;
    if (n > list.length) {
      const extra = Array.from({ length: n - list.length }, (_, i) => {
        const idx = list.length + i;
        return newRoom(ROOM_NAME_HINTS[idx] || `Комната ${idx + 1}`);
      });
      onChange([...list, ...extra]);
    } else {
      onChange(list.slice(0, n));
    }
  };

  const remove = (id) => {
    if (list.length <= 1) return;
    if (!window.confirm("Удалить комнату? Позиции с этой комнатой останутся без привязки.")) return;
    onChange(list.filter((r) => r.id !== id));
  };

  return (
    <div className={compact ? "" : "card rooms-editor"} style={{ padding: compact ? 0 : 16, marginBottom: compact ? 0 : 14 }}>
      {!compact && (
        <div className="between wrap" style={{ gap: 10, marginBottom: 12 }}>
          <div>
            <h4 style={{ margin: 0, fontSize: 14 }}>Комнаты в помещении</h4>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: 520 }}>
              Подпишите каждую комнату (манипуляционная, водоподготовка, рассадное и т.д.). Площадь — по желанию.
            </p>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            {showCount && (
              <label className="row" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", gap: 6 }}>
                Комнат
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={list.length}
                  onChange={(e) => setCount(e.target.value)}
                  style={{ width: 56 }}
                />
              </label>
            )}
            <button type="button" className="btn btn-sm" onClick={add}>
              ＋ Комната
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Добавьте комнаты — затем на шаге «Ферма целиком» укажете, что в какую идёт.
        </p>
      ) : (
        <div className="rooms-table-wrap">
          <table className="spec rooms-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Название комнаты</th>
                <th style={{ width: 120 }} className="right">Площадь, м²</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.id}>
                  <td className="muted num" style={{ fontSize: 12 }}>{i + 1}</td>
                  <td>
                    <input
                      value={r.name}
                      onChange={(e) => patch(r.id, { name: e.target.value })}
                      placeholder={ROOM_NAME_HINTS[i] || `Комната ${i + 1}`}
                    />
                  </td>
                  <td className="right">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="num"
                      style={{ textAlign: "right" }}
                      value={r.area ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        patch(r.id, { area: e.target.value === "" ? "" : Number(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    {list.length > 1 && (
                      <button type="button" className="btn btn-ghost btn-sm" title="Удалить" onClick={() => remove(r.id)}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
