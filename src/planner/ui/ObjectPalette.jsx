import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  catalogForLayer, LINE_STYLE,
  layerById, LAYER_TOOLS,
} from "../catalog.js";
import {
  resolveCatalogKind, getWallThkPresets,
} from "../plannerMaterialPresets.js";
import { FARM_RACK_PRESETS } from "../farmObjects.js";

const TOOL_DEFS = {
  select:  { icon: "↖", label: "Выбор" },
  wall:    { icon: "▬", label: "Стена" },
  zone:    { icon: "▢", label: "Помещение" },
  measure: { icon: "⊢", label: "Размер" },
  label:   { icon: "T", label: "Подпись" },
  line:    { icon: "⤳", label: "Трасса" },
  link:    { icon: "⇄", label: "Связь" },
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
  onSyncZones,
  onSelectPlanItem,
  projectId,
  embedded = false,
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
  const specObjects = useMemo(
    () => (plan.items || []).filter((it) => it.includedInProject !== false),
    [plan.items],
  );

  const Shell = embedded ? "div" : "aside";
  const shellClass = embedded
    ? "planner-palette-embedded"
    : "planner-side planner-side--left no-print";

  if (active === "spec") {
    return (
      <Shell className={shellClass}>
        <div className="planner-side__scroll">
          <div className="planner-side__section">
            <div className="planner-side__title">Спецификация</div>
            <p className="planner-spec-intro">
              {onSync
                ? "Лист спецификации формируется из объектов плана. Синхронизируйте с проектом, чтобы обновить позиции и комплекты."
                : "Черновик без проекта — спецификацию можно посмотреть, но синхронизация доступна только в плане проекта."}
            </p>
            {specSummary && (
              <ul className="planner-spec-stats">
                <li>Объектов в спецификации: {specSummary.objects ?? "—"}</li>
                <li>Комплектных строк: {specSummary.kitObjects ?? "—"}</li>
                <li>Линейных трасс: {specSummary.lines ?? "—"}</li>
                <li>Связей: {specSummary.links ?? "—"}</li>
              </ul>
            )}
            {onSync && (
              <button type="button" className="planner-btn planner-btn--primary" style={{ width: "100%", marginTop: 12 }} onClick={onSync}>
                Синхронизировать спецификацию
              </button>
            )}
            {projectId && (
              <Link className="planner-btn" style={{ width: "100%", marginTop: 8, textAlign: "center", display: "block" }} to={`/project/${projectId}`}>
                Открыть таблицу спецификации
              </Link>
            )}
            {specObjects.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="planner-side__title">Объекты плана ({specObjects.length})</div>
                <div className="planner-spec-list">
                  {specObjects.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className="planner-spec-list__item"
                      onClick={() => onSelectPlanItem?.(it.id)}
                    >
                      <span className="planner-spec-list__dot" style={{ background: it.color }} />
                      <span>{it.label}</span>
                      {it.visibleToClient === false && (
                        <span className="planner-spec-list__tag">скрыт</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  if (active === "client" || active === "install") {
    const allowedTools = LAYER_TOOLS[active] || ["select", "pan"];
    return (
      <Shell className={shellClass}>
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
      </Shell>
    );
  }

  return (
    <Shell className={shellClass}>
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
            <div className="planner-side__title">Параметры по умолчанию</div>
            <p className="planner-spec-intro" style={{ marginBottom: 10 }}>
              Для новых стен. Можно изменить у каждой стены в свойствах.
            </p>
            <div className="planner-row">
              <div className="planner-field">
                <label>Толщина стены, мм</label>
                <input type="number" min={0} value={plan.room.wallThk} onChange={(e) => onRoomPatch({ wallThk: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>Высота помещения, мм</label>
                <input type="number" min={0} value={plan.room.height ?? 3000} onChange={(e) => onRoomPatch({ height: Math.max(0, +e.target.value || 0) })} />
              </div>
            </div>
          </div>
        )}

        {active === "zones" && (
          <div className="planner-side__section">
            <div className="planner-side__title">Зонирование</div>
            <p className="planner-spec-intro">
              Назначьте тип зоны в свойствах: <b>чистая</b>, <b>грязная</b> или <b>буфер</b>.
              Между чистой и грязной — дизковрик у двери.
            </p>
          </div>
        )}

        {active === "partitions" && (
          <div className="planner-side__section">
            <div className="planner-side__title">Перегородка</div>
            <div className="planner-field">
              <label>Толщина, мм</label>
              <div className="planner-presets">
                {getWallThkPresets().map((t) => (
                  <button key={t} type="button" className={"planner-preset" + (wallThk === t ? " planner-preset--on" : "")} onClick={() => onWallThk(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <input type="number" min={0} value={wallThk} onChange={(e) => onWallThk(Math.max(0, +e.target.value || 0))} style={{ marginTop: 8 }} />
            </div>
            {onSyncZones && (
              <button type="button" className="planner-btn" style={{ width: "100%", marginTop: 10 }} onClick={onSyncZones}>
                Обновить помещения
              </button>
            )}
            <p className="planner-spec-intro" style={{ marginTop: 10 }}>
              Замкните контур перегородок — помещения появятся автоматически (белая заливка пола).
            </p>
          </div>
        )}

        {active === "room" && (
          <div className="planner-side__section">
            <p className="planner-spec-intro">
              Двери и окна ставятся <b>только на стену</b>. Сначала нарисуйте перегородки.
            </p>
          </div>
        )}

        {items.length > 0 && (
          <div className="planner-side__section">
            <div className="planner-side__title">Каталог</div>
            <input className="planner-search" placeholder="Поиск объекта…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
            <div className="planner-catalog">
              {filtered.map((c) => {
                const resolved = resolveCatalogKind(c.kind);
                return (
                  <button
                    key={c.kind}
                    type="button"
                    className={"planner-card" + (tool === "add" && pending === c.kind ? " planner-card--active" : "")}
                    onClick={() => onPending(c.kind, { w: resolved.w, h: resolved.h })}
                  >
                    <div className="planner-card__icon">
                      <span className="planner-card__icon-dot" style={{ background: c.color }} />
                    </div>
                    <div className="planner-card__body">
                      <div className="planner-card__name">{resolved.label}</div>
                      <div className="planner-card__meta">
                        {resolved.w}×{resolved.h} мм
                        {c.params?.tiers ? ` · ${c.params.tiers} ярусов` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {active === "racks" && (
              <div className="planner-presets">
                {FARM_RACK_PRESETS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="planner-preset"
                    onMouseDown={() => onPending("rack", {
                      w: r.w,
                      h: r.h,
                      farmPresetId: r.id,
                      rackType: r.rackType,
                      label: r.name,
                    })}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tool === "add" && pending && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            Клик по плану — поставить «{resolveCatalogKind(pending).label}»
            {resolveCatalogKind(pending).wall ? " (прилипнет к стене)" : ""}
          </div>
        )}
        {(tool === "line" || tool === "wall") && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            Клик — точки · Enter / двойной клик — завершить · Esc — отмена · Shift — 0°/90°
          </div>
        )}
        {tool === "label" && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            1) Клик по объекту или точке на плане — якорь выноски · 2) текст и размер шрифта · Esc — отмена
          </div>
        )}
        {tool === "pan" && (
          <div className="planner-hint" style={{ marginTop: 12 }}>
            Перетаскивание — перемещение холста · Space — временно
          </div>
        )}
      </div>
    </Shell>
  );
}
