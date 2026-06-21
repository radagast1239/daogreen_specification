import React, { useState } from "react";
import { slugClientSectionId } from "../../../shared/clientSections.js";

function moveItem(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function ClientSectionsEditor({ sections, onChange }) {
  const [expanded, setExpanded] = useState(null);
  const [newLabel, setNewLabel] = useState("");
  const [newSub, setNewSub] = useState({});

  const visibleCount = sections.filter((s) => !s.hidden).length;

  const update = (index, patch) => {
    onChange(sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addSection = () => {
    const label = newLabel.trim();
    if (!label) return;
    const ids = new Set(sections.map((s) => s.id));
    const id = slugClientSectionId(label, ids);
    onChange([...sections, { id, label, subsections: [], hidden: false }]);
    setNewLabel("");
    setExpanded(sections.length);
  };

  const addSubsection = (index) => {
    const name = (newSub[index] || "").trim();
    if (!name) return;
    const subs = sections[index].subsections || [];
    if (subs.includes(name)) return;
    update(index, { subsections: [...subs, name] });
    setNewSub({ ...newSub, [index]: "" });
  };

  const removeSubsection = (index, name) => {
    update(index, { subsections: (sections[index].subsections || []).filter((s) => s !== name) });
  };

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Разделы закупки для клиента: названия, порядок, подразделы. Скрытые разделы не показываются в выборе, но
        сохраняются у уже привязанных материалов.
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        Активных разделов: <strong>{visibleCount}</strong> из {sections.length}
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        {sections.map((sec, index) => (
          <div
            key={sec.id}
            className="card"
            style={{
              padding: 12,
              opacity: sec.hidden ? 0.55 : 1,
              borderColor: sec.hidden ? "var(--line)" : undefined,
            }}
          >
            <div className="row between wrap" style={{ gap: 8, alignItems: "center" }}>
              <div className="row" style={{ gap: 6, flex: "1 1 200px" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  title="Выше"
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(sections, index, index - 1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  title="Ниже"
                  disabled={index === sections.length - 1}
                  onClick={() => onChange(moveItem(sections, index, index + 1))}
                >
                  ↓
                </button>
                <input
                  value={sec.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  style={{ flex: 1, minWidth: 140, fontWeight: 600 }}
                />
              </div>
              <code className="muted" style={{ fontSize: 11 }}>
                {sec.id}
              </code>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setExpanded(expanded === index ? null : index)}
                >
                  Подразделы ({(sec.subsections || []).length})
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => update(index, { hidden: !sec.hidden })}
                >
                  {sec.hidden ? "Показать" : "Скрыть"}
                </button>
              </div>
            </div>

            {expanded === index && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
                  {(sec.subsections || []).map((sub) => (
                    <span key={sub} className="chip chip--neutral" style={{ gap: 6 }}>
                      {sub}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ padding: "0 4px", minHeight: 0, fontSize: 12 }}
                        onClick={() => removeSubsection(index, sub)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    placeholder="Новый подраздел…"
                    value={newSub[index] || ""}
                    onChange={(e) => setNewSub({ ...newSub, [index]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSubsection(index))}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-sm" onClick={() => addSubsection(index)}>
                    Добавить
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <input
          placeholder="Название нового раздела…"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSection())}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn" onClick={addSection}>
          Добавить раздел
        </button>
      </div>
    </div>
  );
}
