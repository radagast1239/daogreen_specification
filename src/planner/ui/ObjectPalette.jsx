import React, { useMemo, useState } from "react";
import {
  catalogForLayer, catalogByKind, RACK_PRESETS, LINE_STYLE,
  layerById, LAYER_TOOLS, WALL_THK_PRESETS, ROOM_HEIGHT_PRESETS,
} from "../catalog.js";

const TOOL_DEFS = {
  select:  { icon: "↖", label: "Выбор" },
  wall:    { icon: "▬", label: "Стена" },
  zone:    { icon: "▢", label: "Помещение" },
  measure: { icon: "⊢", label: "Размер" },
  label:   { icon: "T", label: "Подпись" },
  line:    { icon: "／", label: "Трасса" },
  pan:     { icon: "✥", label: "Рука" },
};

export function ObjectPalette({
  active,
  tool,
  pending,
  wallThk,
  plan,
  onTool,
  onPending,
  onWallThk,
  onRoomPatch,
  specSummary,
  onSync,
}) {
  const [q, setQ] = useState("");
  const lay = layerById(active);
  const items = catalogForLayer(active);
  const hasLine = !!(LINE_STYLE[active] || (active === "irrigation" && LINE_STYLE.irrigation));
  const lineKey = LINE_STYLE[active] ? active : null;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((c) => c.label.toLowerCase().includes(s) || c.kind.includes(s));
  }, [items, q]);

  const allowedTools = LAYER_TOOLS[active] || ["select", "pan"];
  const visibleTools = allowedTools.map((id) => TOOL_DEFS[id]).filter(Boolean);

  if (active === "spec") {
    return (
      <aside className="planner-side planner-side--left no-print">
        <div className="planner-side__scroll">
          <div className="planner-side__section">
            <div className="planner-side__title">Спецификация</div>
            <p className="planner-spec-intro">
              Лист спецификации формируется из объектов плана. Синхронизируйте с проектом, чтобы обновить позиции и комплекты.
            </p>
            {specSummary && (
              <ul className="planner-spec-stats">
                <li>Объектов в спецификации: {specSummary.objects ?? "—"}</li>
                <li>Комплектных строк: {specSummary.kitObjects ?? "—"}</li>
                <li>Линейных трасс: {specSummary.lines ?? "—"}</li>
              </ul>
            )}
            <button type="button" className="planner-btn planner-btn--primary" style={{ width: "100%", marginTop: 12 }} onClick={onSync}>
              Синхронизировать спецификацию
            </button>
          </div>
        </div>
      </aside>
    );
  }

  if (active === "client" || active === "install") {
    const allowedTools = LAYER_TOOLS[active] || ["select", "pan"];
    return (
      <aside className="planner-side planner-side--left no-print">
        <div className="planner-side__scroll">
          <div className="planner-side__section">
            <div className="planner-side__title">{lay.name}</div>
            <p className="planner-spec-intro">
              {active === "client"
                ? "Упрощённый вид для клиента: без лишней инженерки, с подписями объектов."
                : "Монтажный вид: все слои видны, технические привязки и размеры."}
            </p>
            <div className="planner-tools">
              {allowedTools.map((tid) => {
                const t = TOOL_DEFS[tid];
                if (!t) return null;
                return (
                  <button
                    key={tid}
                    type="button"
                    className={"planner-tool" + (tool === tid ? " planner-tool--active" : "")}
                    onClick={() => onTool(tid)}
                  >
                    <span className="planner-tool__icon">{t.icon}</span>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="planner-side planner-side--left no-print">
      <div className="planner-side__scroll">
        <div className="planner-side__section">
          <div className="planner-side__title">Инструменты · {lay.name}</div>
          <div className="planner-tools">
            {allowedTools.map((tid) => {
              const t = TOOL_DEFS[tid];
              if (!t) return null;
              const label = tid === "line" && lineKey ? (LINE_STYLE[lineKey]?.label || "Трасса") : t.label;
              return (
                <button
                  key={tid}
                  type="button"
                  className={"planner-tool" + (tool === tid ? " planner-tool--active" : "")}
                  onClick={() => onTool(tid)}
                  title={label}
                >
                  <span className="planner-tool__icon">{t.icon}</span>
                  {tid === "line" ? "Трасса" : t.label}
                </button>
              );
            })}
          </div>
        </div>

        {active === "room" && (
          <div className="planner-side__section">
            <div className="planner-side__title">Помещение, мм</div>
            <div className="planner-row">
              <div className="planner-field">
                <label>Ширина</label>
                <input type="number" value={plan.room.w} onChange={(e) => onRoomPatch({ w: Math.max(500, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>Глубина</label>
                <input type="number" value={plan.room.h} onChange={(e) => onRoomPatch({ h: Math.max(500, +e.target.value || 0) })} />
              </div>
            </div>
            <div className="planner-row">
              <div className="planner-field">
                <label>Наружная стена</label>
                <input type="number" value={plan.room.wallThk} onChange={(e) => onRoomPatch({ wallThk: Math.max(40, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>Высота</label>
                <select value={plan.room.height || 3000} onChange={(e) => onRoomPatch({ height: +e.target.value })}>
                  {ROOM_HEIGHT_PRESETS.map((h) => <option key={h} value={h}>{h} мм</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {active === "partitions" && (
          <div className="planner-side__section">
            <div className="planner-side__title">Перегородка</div>
            <div className="planner-field">
              <label>Толщина, мм</label>
              <div className="planner-presets">
                {WALL_THK_PRESETS.map((t) => (
                  <button key={t} type="button" className={"planner-preset" + (wallThk === t ? " planner-preset--on" : "")} onClick={() => onWallThk(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <input type="number" value={wallThk} onChange={(e) => onWallThk(Math.max(40, +e.target.value || 0))} style={{ marginTop: 8 }} />
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="planner-side__section">
            <div className="planner-side__title">Каталог</div>
            <input className="planner-search" placeholder="Поиск объекта…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
            <div className="planner-catalog">
              {filtered.map((c) => (
                <button
                  key={c.kind}
                  type="button"
                  className={"planner-card" + (tool === "add" && pending === c.kind ? " planner-card--active" : "")}
                  onClick={() => onPending(c.kind)}
                >
                  <div className="planner-card__icon">
                    <span className="planner-card__icon-dot" style={{ background: c.color }} />
                  </div>
                  <div className="planner-card__body">
                    <div className="planner-card__name">{c.label}</div>
                    <div className="planner-card__meta">
                      {c.w}×{c.h} мм
                      {c.params?.tiers ? ` · ${c.params.tiers} ярусов` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {active === "racks" && (
              <div className="planner-presets">
                {RACK_PRESETS.map((r, i) => (
                  <button key={i} type="button" className="planner-preset" onMouseDown={() => onPending("rack")}>
                    {r.w}×{r.h}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tool === "add" && pending && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            Клик по плану — поставить «{catalogByKind(pending).label}»
            {catalogByKind(pending).wall ? " (прилипнет к стене)" : ""}
          </div>
        )}
        {(tool === "line" || tool === "wall") && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            Клик — точки · Enter / двойной клик — завершить · Esc — отмена · Shift — 0°/90°
          </div>
        )}
        {tool === "label" && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            Клик по объекту — выноска · по пустому — свободная подпись
          </div>
        )}
        {tool === "pan" && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            Перетаскивание — перемещение холста · Space — временно
          </div>
        )}
      </div>
    </aside>
  );
}
