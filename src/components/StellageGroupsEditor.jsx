import React, { useState } from "react";
import { slugId } from "../lib/referenceData.js";

/** Группы состава стеллажа — названия и порядок (глобально для всех типов) */
export default function StellageGroupsEditor({ groups, onChange, compact = false }) {
  const [newLabel, setNewLabel] = useState("");

  const move = (id, dir) => {
    const list = [...groups];
    const i = list.findIndex((g) => g.id === id);
    if (i < 0) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    onChange(list.map((g, idx) => ({ ...g, order: idx + 1 })));
  };

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    let id = slugId(label);
    if (groups.some((g) => g.id === id)) id = `${id}_${groups.length + 1}`;
    onChange([...groups, { id, label, order: groups.length + 1 }]);
    setNewLabel("");
  };

  return (
    <div className={compact ? "" : "card"} style={{ padding: compact ? 0 : 16, marginBottom: compact ? 0 : 14 }}>
      {!compact && (
        <>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Группы состава стеллажа</h3>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
            Порядок и названия групп в таблице: Каркас и крепёж, Дренаж, Вентиляция, Опции и т.д. Применяется ко всем
            типам стеллажей.
          </p>
        </>
      )}
      <table className="spec" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th>Группа</th>
            <th className="right" style={{ width: 100 }} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={g.id}>
              <td className="muted num">{i + 1}</td>
              <td>
                <input
                  className="spec-cell-input stellage-group-name-input"
                  value={g.label}
                  onChange={(e) =>
                    onChange(groups.map((x) => (x.id === g.id ? { ...x, label: e.target.value } : x)))
                  }
                />
              </td>
              <td className="right">
                <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(g.id, "up")}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={i === groups.length - 1}
                  onClick={() => move(g.id, "down")}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(groups.filter((x) => x.id !== g.id))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ gap: 8 }}>
        <input
          placeholder="Новая группа"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <button type="button" className="btn btn-sm" onClick={add}>
          ＋
        </button>
      </div>
    </div>
  );
}
