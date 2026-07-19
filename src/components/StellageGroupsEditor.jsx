import React, { useState } from "react";
import { slugId } from "../lib/referenceData.js";
import { emptySearchMessage, filterByQuery } from "../lib/modulesListView.js";
import { ModulesSearch, RowActionsMenu, TechDetails } from "./modulesUi.jsx";

/** Группы состава стеллажа — названия и порядок (глобально для всех типов) */
export default function StellageGroupsEditor({ groups, onChange, compact = false }) {
  const [newLabel, setNewLabel] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);

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

  const visible = filterByQuery(groups, query, (g) => `${g.label} ${g.id}`);
  const emptyMsg = emptySearchMessage(query, visible.length);

  return (
    <div className={compact ? "" : "card modules-card"} style={{ padding: compact ? 0 : 16, marginBottom: compact ? 0 : 14 }}>
      {!compact && (
        <>
          <div className="modules-card__head">
            <h3 style={{ margin: 0, fontSize: 15 }}>Группы состава стеллажа</h3>
            <ModulesSearch value={query} onChange={setQuery} placeholder="Поиск групп…" />
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "8px 0 12px" }}>
            Порядок и названия групп в таблице состава. Применяется ко всем типам стеллажей.
          </p>
        </>
      )}
      {compact && (
        <div className="modules-list-toolbar" style={{ marginBottom: 8 }}>
          <ModulesSearch value={query} onChange={setQuery} placeholder="Поиск групп…" />
        </div>
      )}
      {emptyMsg ? (
        <p className="muted modules-empty">{emptyMsg}</p>
      ) : (
        <table className="spec modules-compact-table" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Группа</th>
              <th className="right" style={{ width: 200 }} />
            </tr>
          </thead>
          <tbody>
            {visible.map((g, i) => {
              const fullIndex = groups.findIndex((x) => x.id === g.id);
              const editing = editingId === g.id;
              return (
                <tr key={g.id} className={editing ? "modules-row--editing" : undefined}>
                  <td className="muted num">{i + 1}</td>
                  <td>
                    {editing ? (
                      <div className="modules-row__edit">
                        <input
                          className="spec-cell-input stellage-group-name-input"
                          value={g.label}
                          autoFocus
                          onChange={(e) =>
                            onChange(groups.map((x) => (x.id === g.id ? { ...x, label: e.target.value } : x)))
                          }
                        />
                        <TechDetails>
                          <code>{g.id}</code>
                        </TechDetails>
                      </div>
                    ) : (
                      <strong>{g.label}</strong>
                    )}
                  </td>
                  <td className="right modules-row__actions">
                    {editing ? (
                      <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)}>
                        Готово
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingId(g.id)}>
                          Редактировать
                        </button>
                        <RowActionsMenu
                          items={[
                            {
                              id: "edit",
                              label: "Редактировать",
                              onClick: () => setEditingId(g.id),
                            },
                            {
                              id: "up",
                              label: "Переместить выше",
                              disabled: fullIndex <= 0,
                              onClick: () => move(g.id, "up"),
                            },
                            {
                              id: "down",
                              label: "Переместить ниже",
                              disabled: fullIndex < 0 || fullIndex >= groups.length - 1,
                              onClick: () => move(g.id, "down"),
                            },
                            {
                              id: "delete",
                              label: "Удалить",
                              danger: true,
                              onClick: () => onChange(groups.filter((x) => x.id !== g.id)),
                            },
                          ]}
                        />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="row" style={{ gap: 8 }}>
        <input
          placeholder="Новая группа"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <button type="button" className="btn btn-sm" onClick={add}>
          + Новая группа
        </button>
      </div>
    </div>
  );
}
