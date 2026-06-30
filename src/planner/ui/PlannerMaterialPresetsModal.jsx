import React, { useMemo, useState } from "react";
import {
  MATERIAL_PRESET_GROUPS,
  listEditableKinds,
  listEditableTools,
  loadMaterialPresets,
  updateKindPreset,
  setKindVariants,
  addKindVariant,
  removeKindVariant,
  updateToolPreset,
  updateWallThkPresets,
  updateStructuralWidth,
  resetMaterialPresets,
  invalidateMaterialPresetsCache,
} from "../plannerMaterialPresets.js";
import { STRUCTURAL_KINDS } from "../structuralTypes.js";

function NumInput({ value, onChange, min = 50, step = 10, width = 88 }) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(e) => onChange(Math.max(min, +e.target.value || 0))}
      style={{ width, padding: "4px 6px", borderRadius: 4, border: "1px solid var(--pl-border, #d9e0dc)" }}
    />
  );
}

export function PlannerMaterialPresetsModal({ open, onClose, onChanged }) {
  const [, bump] = useState(0);
  const refresh = () => {
    invalidateMaterialPresetsCache();
    bump((n) => n + 1);
    onChanged?.();
  };

  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(null);

  const prefs = useMemo(() => loadMaterialPresets(), [open, group, query, expanded]);

  if (!open) return null;

  const kinds = listEditableKinds().filter((k) => {
    const q = query.trim().toLowerCase();
    if (q && !k.label.toLowerCase().includes(q) && !k.kind.includes(q)) return false;
    if (group === "all") return true;
    const g = MATERIAL_PRESET_GROUPS.find((x) => x.id === group);
    if (!g) return true;
    if (group === "other") {
      return !MATERIAL_PRESET_GROUPS.slice(0, -1).some((gr) => gr.match(k.kind));
    }
    return g.match(k.kind);
  });

  const tools = listEditableTools().filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return t.registryLabel.toLowerCase().includes(q) || t.id.includes(q);
  });

  const handleReset = () => {
    if (!window.confirm("Сбросить все типовые размеры к заводским?")) return;
    resetMaterialPresets();
    refresh();
  };

  return (
    <div className="planner-visual-modal" role="dialog" aria-modal="true" aria-label="Типовые размеры материалов">
      <button type="button" className="planner-visual-modal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="planner-visual-modal__panel planner-material-modal__panel">
        <div className="planner-visual-modal__head">
          <div>
            <div className="planner-visual-modal__title">Типовые размеры материалов</div>
            <div className="planner-visual-modal__sub">
              Ёмкости, стеллажи, насосы, мебель — используются при установке на план. Сохраняются автоматически.
            </div>
          </div>
          <button type="button" className="planner-visual-modal__close" onClick={onClose}>×</button>
        </div>

        <div className="planner-material-modal__toolbar">
          <input
            type="search"
            placeholder="Поиск…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="planner-material-modal__search"
          />
          <button type="button" className="planner-btn" onClick={handleReset}>Сбросить всё</button>
        </div>

        <div className="planner-material-modal__tabs">
          <button type="button" className={"planner-btn" + (group === "all" ? " planner-btn--primary" : "")} onClick={() => setGroup("all")}>Все</button>
          {MATERIAL_PRESET_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={"planner-btn" + (group === g.id ? " planner-btn--primary" : "")}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="planner-material-modal__scroll">
          <table className="planner-material-modal__table">
            <thead>
              <tr>
                <th>Материал</th>
                <th>Ширина, мм</th>
                <th>Глубина, мм</th>
                <th>Варианты</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <React.Fragment key={k.kind}>
                  <tr>
                    <td>
                      <div className="planner-material-modal__name">{k.label}</div>
                      <div className="planner-material-modal__meta">{k.layerName}{k.wall ? " · настенный" : ""}</div>
                    </td>
                    <td>
                      <NumInput
                        value={k.w}
                        onChange={(w) => { updateKindPreset(k.kind, { w }); refresh(); }}
                      />
                    </td>
                    <td>
                      <NumInput
                        value={k.h}
                        onChange={(h) => { updateKindPreset(k.kind, { h }); refresh(); }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="planner-btn planner-btn--sm"
                        onClick={() => setExpanded(expanded === k.kind ? null : k.kind)}
                      >
                        {k.variants.length ? `${k.variants.length} шт.` : "—"} ▾
                      </button>
                    </td>
                  </tr>
                  {expanded === k.kind && (
                    <tr>
                      <td colSpan={4} className="planner-material-modal__variants">
                        {k.variants.map((v) => (
                          <div key={v.id} className="planner-material-modal__variant-row">
                            <input
                              value={v.label}
                              onChange={(e) => {
                                const next = k.variants.map((x) => (x.id === v.id ? { ...x, label: e.target.value } : x));
                                setKindVariants(k.kind, next);
                                refresh();
                              }}
                              style={{ flex: 1, minWidth: 100, padding: "4px 6px", borderRadius: 4, border: "1px solid var(--pl-border)" }}
                            />
                            <NumInput value={v.w} width={72} onChange={(w) => {
                              const next = k.variants.map((x) => (x.id === v.id ? { ...x, w } : x));
                              setKindVariants(k.kind, next);
                              refresh();
                            }}
                            />
                            <span>×</span>
                            <NumInput value={v.h} width={72} onChange={(h) => {
                              const next = k.variants.map((x) => (x.id === v.id ? { ...x, h } : x));
                              setKindVariants(k.kind, next);
                              refresh();
                            }}
                            />
                            <button type="button" className="planner-btn planner-btn--sm planner-btn--danger" onClick={() => { removeKindVariant(k.kind, v.id); refresh(); }}>✕</button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="planner-btn planner-btn--sm"
                          onClick={() => {
                            addKindVariant(k.kind, { label: "Новый", w: k.w, h: k.h });
                            refresh();
                          }}
                        >
                          + Вариант
                        </button>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {tools.length > 0 && (
            <>
              <div className="planner-side__title" style={{ marginTop: 16 }}>Варианты инструментов (меню листа)</div>
              <table className="planner-material-modal__table">
                <thead>
                  <tr>
                    <th>Инструмент</th>
                    <th>Ширина</th>
                    <th>Глубина</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((t) => (
                    <tr key={t.id}>
                      <td>{t.registryLabel}</td>
                      <td>
                        <NumInput value={t.w} onChange={(w) => { updateToolPreset(t.id, { w }); refresh(); }} />
                      </td>
                      <td>
                        <NumInput value={t.h} onChange={(h) => { updateToolPreset(t.id, { h }); refresh(); }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="planner-side__title" style={{ marginTop: 16 }}>Конструкции и стены</div>
          <div className="planner-material-modal__struct">
            {Object.entries(STRUCTURAL_KINDS).map(([sk, meta]) => (
              <label key={sk} className="planner-material-modal__struct-row">
                <span>{meta.label}, мм</span>
                <NumInput
                  value={prefs.structural?.[sk] ?? meta.defaultWidth}
                  onChange={(w) => { updateStructuralWidth(sk, w); refresh(); }}
                />
              </label>
            ))}
          </div>
          <div className="planner-field" style={{ marginTop: 12 }}>
            <label>Толщины стен (через запятую, мм)</label>
            <input
              value={(prefs.wallThk || []).join(", ")}
              onChange={(e) => {
                const list = e.target.value.split(/[,;\s]+/).map((x) => +x).filter((n) => n > 0);
                updateWallThkPresets(list);
                refresh();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
