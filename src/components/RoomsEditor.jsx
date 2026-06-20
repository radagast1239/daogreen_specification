import React from "react";
import { newRoom } from "../lib/roomHelpers.js";

export default function RoomsEditor({ rooms, onChange, compact = false }) {
  const list = rooms?.length ? rooms : [];

  const setName = (id, name) => {
    onChange(list.map((r) => (r.id === id ? { ...r, name } : r)));
  };

  const add = () => onChange([...list, newRoom(`Комната ${list.length + 1}`)]);

  const remove = (id) => {
    if (list.length <= 1) return;
    if (!window.confirm("Удалить комнату? Позиции с этой комнатой останутся без привязки.")) return;
    onChange(list.filter((r) => r.id !== id));
  };

  return (
    <div className={compact ? "" : "card"} style={{ padding: compact ? 0 : 14, marginBottom: compact ? 0 : 12 }}>
      {!compact && (
        <div className="between wrap" style={{ gap: 8, marginBottom: 10 }}>
          <div>
            <h4 style={{ margin: 0, fontSize: 14 }}>Комнаты фермы</h4>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
              Добавьте комнаты и подпишите их — затем укажите, какая позиция в какую комнату идёт.
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={add}>
            ＋ Комната
          </button>
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        {list.map((r, i) => (
          <div key={r.id} className="row" style={{ gap: 4, alignItems: "center" }}>
            <input
              value={r.name}
              onChange={(e) => setName(r.id, e.target.value)}
              placeholder={`Комната ${i + 1}`}
              style={{ width: compact ? 140 : 180, fontSize: 13 }}
            />
            {list.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" title="Удалить" onClick={() => remove(r.id)}>
                ✕
              </button>
            )}
          </div>
        ))}
        {compact && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={add}>
            ＋
          </button>
        )}
      </div>
    </div>
  );
}
