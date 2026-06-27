import React, { useState } from "react";
import { areaM2, LINK_RULES } from "../catalog.js";
import { ZONE_FLOW, itemPowerW, panelCapacityW } from "../farmRules.js";
import { projectSectionTemplates } from "../specSync.js";
import { collectPlannerWarnings } from "../geometry.js";
import { linkLengthMm, linksForItem } from "../linkGeometry.js";

export function PropertiesPanel({
  sel,
  selObj,
  plan,
  project,
  active,
  materials,
  modules,
  updateObj,
  rotateItem,
  delSel,
  fmtU,
  onSync,
  specSummary,
}) {
  const [tab, setTab] = useState("props");
  const warnings = collectPlannerWarnings(plan, sel);
  const objWarnings = sel?.id
    ? warnings.filter((w) => w.objectIds?.includes(sel.id))
    : warnings;

  return (
    <aside className="planner-side planner-side--right no-print">
      <div className="planner-props-tabs">
        {["props", "spec", "errors"].map((t) => (
          <button
            key={t}
            type="button"
            className={"planner-props-tab" + (tab === t ? " planner-props-tab--active" : "")}
            onClick={() => setTab(t)}
          >
            {t === "props" ? "Свойства" : t === "spec" ? "Спецификация" : `Ошибки${objWarnings.length ? ` (${objWarnings.length})` : ""}`}
          </button>
        ))}
      </div>
      <div className="planner-side__scroll">
        {tab === "errors" && (
          <div>
            {objWarnings.length === 0 && (
              <div className="planner-empty-props">Предупреждений нет</div>
            )}
            {objWarnings.map((w) => (
              <div key={w.id} className="planner-warn">⚠ {w.text}</div>
            ))}
          </div>
        )}

        {tab === "spec" && (
          <div>
            <div className="planner-side__title">Связь со спецификацией</div>
            <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginBottom: 12 }}>
              <div>Объекты: <b>{specSummary.objects}</b></div>
              <div>Трассы: <b>{specSummary.lines}</b></div>
              <div>Связи: <b>{specSummary.links ?? 0}</b></div>
              <div>Связано с базой: <b>{specSummary.linked}</b></div>
            </div>
            <button type="button" className="planner-btn planner-btn--primary" style={{ width: "100%" }} onClick={onSync} disabled={!onSync}>
              {onSync ? "Обновить спецификацию из плана" : "Нужен план проекта"}
            </button>
            {selObj && sel.coll === "items" && (
              <ItemSpecFields
                obj={selObj}
                updateObj={updateObj}
                materials={materials}
                modules={modules}
                projectItems={project.items || []}
              />
            )}
          </div>
        )}

        {tab === "props" && !selObj && (
          <div className="planner-empty-props">
            <p>Выберите объект на плане или начните рисовать стены на слое <b>Исходный план</b>.</p>
            <p style={{ marginTop: 12, fontSize: 12 }}>
              Площадь: {areaM2(plan.room.w, plan.room.h)} м²<br />
              Объектов: {plan.items.length} · Перегородок: {plan.walls.length}
            </p>
          </div>
        )}

        {tab === "props" && selObj && (
          <SelFields
            sel={sel}
            obj={selObj}
            plan={plan}
            updateObj={updateObj}
            rotateItem={rotateItem}
            delSel={delSel}
            fmtU={fmtU}
            active={active}
          />
        )}
      </div>
    </aside>
  );
}

function SelFields({ sel, obj, plan, updateObj, rotateItem, delSel, fmtU, active }) {
  if (sel.coll === "labels") {
    return (
      <>
        <div className="planner-side__title">Подпись</div>
        <div className="planner-field">
          <label>Текст</label>
          <textarea rows={3} value={obj.text} onChange={(e) => updateObj("labels", obj.id, { text: e.target.value })} />
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
      </>
    );
  }
  if (sel.coll === "zones") {
    return (
      <>
        <div className="planner-side__title">{obj.name || "Помещение"}</div>
        <div className="planner-field">
          <label>Название</label>
          <input value={obj.name} onChange={(e) => updateObj("zones", obj.id, { name: e.target.value })} />
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>Ширина, мм</label>
            <input type="number" value={obj.w} onChange={(e) => updateObj("zones", obj.id, { w: Math.max(100, +e.target.value || 0) })} />
          </div>
          <div className="planner-field">
            <label>Глубина, мм</label>
            <input type="number" value={obj.h} onChange={(e) => updateObj("zones", obj.id, { h: Math.max(100, +e.target.value || 0) })} />
          </div>
        </div>
        <div className="planner-field">
          <label>Площадь</label>
          <input readOnly value={`S = ${areaM2(obj.w, obj.h)} м²`} />
        </div>
        <div className="planner-field">
          <label>Тип зоны</label>
          <select value={obj.flow || "neutral"} onChange={(e) => updateObj("zones", obj.id, { flow: e.target.value })}>
            {Object.entries(ZONE_FLOW).map(([id, f]) => (
              <option key={id} value={id}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="planner-field">
          <label>Высота H, мм</label>
          <input type="number" value={obj.height} onChange={(e) => updateObj("zones", obj.id, { height: +e.target.value || 0 })} />
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
      </>
    );
  }
  if (sel.coll === "links") {
    const rule = LINK_RULES[obj.type] || { label: "Связь" };
    const from = plan.items.find((i) => i.id === obj.fromId);
    const to = plan.items.find((i) => i.id === obj.toId);
    const len = linkLengthMm(obj, plan.items, plan.room);
    return (
      <>
        <div className="planner-side__title">{rule.label}</div>
        <div className="planner-field">
          <label>От</label>
          <input readOnly value={from?.label || "—"} />
        </div>
        <div className="planner-field">
          <label>К</label>
          <input readOnly value={to?.label || "—"} />
        </div>
        <div className="planner-field">
          <label>План, мм</label>
          <input readOnly value={Math.round(len.plan2d)} />
        </div>
        <div className="planner-field">
          <label>Подъём, мм</label>
          <input
            type="number"
            value={obj.riseMm ?? len.vertical}
            onChange={(e) => updateObj("links", obj.id, { riseMm: Math.max(0, +e.target.value || 0) })}
          />
        </div>
        <div className="planner-field">
          <label>Итого</label>
          <input readOnly value={fmtU(len.total)} />
        </div>
        <div className="planner-field">
          <label>
            <input type="checkbox" checked={obj.ortho !== false} onChange={(e) => updateObj("links", obj.id, { ortho: e.target.checked })} />
            {" "}Ортогональный маршрут
          </label>
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить связь</button>
      </>
    );
  }
  if (sel.coll === "walls") {
    return (
      <>
        <div className="planner-side__title">Перегородка</div>
        <div className="planner-field">
          <label>Толщина, мм</label>
          <input type="number" value={obj.thk} onChange={(e) => updateObj("walls", obj.id, { thk: Math.max(40, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>Высота, мм</label>
          <input type="number" value={obj.height || 2700} onChange={(e) => updateObj("walls", obj.id, { height: Math.max(500, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>Материал</label>
          <input value={obj.material || ""} placeholder="ГКЛ / профиль" onChange={(e) => updateObj("walls", obj.id, { material: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>Длина</label>
          <input readOnly value={fmtU(obj.pts ? polyLen(obj.pts) : 0)} />
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
      </>
    );
  }
  if (sel.coll === "items") {
    return (
      <>
        <div className="planner-side__title">{obj.label}</div>
        <div className="planner-field">
          <label>Название</label>
          <input value={obj.label} onChange={(e) => updateObj("items", obj.id, { label: e.target.value })} />
        </div>
        <div className="planner-side__title" style={{ marginTop: 12 }}>Размеры</div>
        <div className="planner-row">
          <div className="planner-field">
            <label>Длина</label>
            <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(50, +e.target.value || 0) })} />
          </div>
          <div className="planner-field">
            <label>Ширина</label>
            <input type="number" value={obj.h} onChange={(e) => updateObj("items", obj.id, { h: Math.max(50, +e.target.value || 0) })} />
          </div>
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>X</label>
            <input type="number" value={Math.round(obj.x)} onChange={(e) => updateObj("items", obj.id, { x: +e.target.value || 0 })} />
          </div>
          <div className="planner-field">
            <label>Y</label>
            <input type="number" value={Math.round(obj.y)} onChange={(e) => updateObj("items", obj.id, { y: +e.target.value || 0 })} />
          </div>
        </div>
        <div className="planner-field">
          <label>Поворот, °</label>
          <input
            type="range"
            min={0}
            max={359}
            value={obj.angle || 0}
            onChange={(e) => updateObj("items", obj.id, { angle: +e.target.value })}
          />
          <input
            type="number"
            min={0}
            max={359}
            value={obj.angle || 0}
            onChange={(e) => updateObj("items", obj.id, { angle: ((+e.target.value || 0) % 360 + 360) % 360 })}
            style={{ marginTop: 4 }}
          />
        </div>
        {obj.params?.tiers && (
          <div className="planner-field">
            <label>Ярусов</label>
            <input type="number" value={obj.params.tiers} onChange={(e) => updateObj("items", obj.id, { params: { ...obj.params, tiers: +e.target.value || 1 } })} />
          </div>
        )}
        {obj.kind === "panel" && (
          <div className="planner-field">
            <label>Ёмкость щита, Вт</label>
            <input
              type="number"
              value={obj.powerW ?? panelCapacityW(obj)}
              onChange={(e) => updateObj("items", obj.id, { powerW: Math.max(1000, +e.target.value || 0) })}
            />
          </div>
        )}
        {(obj.kind === "rack" || obj.kind === "seed_rack" || obj.kind === "pump") && (
          <div className="planner-field">
            <label>Нагрузка, Вт</label>
            <input
              type="number"
              value={obj.powerW ?? itemPowerW(obj)}
              onChange={(e) => updateObj("items", obj.id, { powerW: Math.max(0, +e.target.value || 0) })}
            />
          </div>
        )}
        <ItemLinksList itemId={obj.id} plan={plan} />
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button type="button" className="planner-btn" onClick={() => rotateItem(obj, 90)}>↻ 90°</button>
          <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
        </div>
      </>
    );
  }
  return null;
}

function ItemLinksList({ itemId, plan }) {
  const links = linksForItem(plan.links, itemId);
  if (!links.length) {
    return (
      <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 12 }}>
        Связей нет. Инструмент «Связь» на листе полива/электрики.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <div className="planner-side__title">Связи</div>
      <ul style={{ fontSize: 12, paddingLeft: 16, margin: 0 }}>
        {links.map((l) => {
          const otherId = l.fromId === itemId ? l.toId : l.fromId;
          const other = plan.items.find((i) => i.id === otherId);
          const rule = LINK_RULES[l.type];
          const len = linkLengthMm(l, plan.items, plan.room);
          return (
            <li key={l.id} style={{ marginBottom: 4 }}>
              {rule?.label || l.type}: {l.fromId === itemId ? "→" : "←"} {other?.label || "?"}{" "}
              <span style={{ color: "var(--pl-text-muted)" }}>({Math.round(len.total)} мм)</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function polyLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

function ItemSpecFields({ obj, updateObj, materials, modules, projectItems }) {
  const templates = projectSectionTemplates(projectItems);
  const activeModules = (modules || []).filter((m) => m.active !== false);
  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--pl-border)", paddingTop: 12 }}>
      <div className="planner-side__title">Объект в спецификации</div>
      <label className="planner-chk">
        <input type="checkbox" checked={obj.includedInProject !== false} onChange={(e) => updateObj("items", obj.id, { includedInProject: e.target.checked })} />
        Включено в проект
      </label>
      <label className="planner-chk">
        <input type="checkbox" checked={obj.visibleToClient !== false} onChange={(e) => updateObj("items", obj.id, { visibleToClient: e.target.checked })} />
        Показать клиенту
      </label>
      <div className="planner-field">
        <label>Источник</label>
        <select value={obj.specMode || "custom"} onChange={(e) => updateObj("items", obj.id, { specMode: e.target.value })}>
          <option value="projectSection">Комплект из раздела</option>
          <option value="module">Комплект из модуля</option>
          <option value="material">Один материал</option>
          <option value="custom">Ручная позиция</option>
        </select>
      </div>
      {(obj.specMode || "custom") === "projectSection" && (
        <div className="planner-field">
          <label>Раздел</label>
          <select value={obj.specSourceSection || ""} onChange={(e) => updateObj("items", obj.id, { specSourceSection: e.target.value })}>
            <option value="">Автоподбор</option>
            {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      )}
      {(obj.specMode || "custom") === "module" && (
        <div className="planner-field">
          <label>Модуль</label>
          <select value={obj.specModuleName || ""} onChange={(e) => updateObj("items", obj.id, { specModuleName: e.target.value })}>
            <option value="">Автоподбор</option>
            {activeModules.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
      )}
      <div className="planner-field">
        <label>Множитель</label>
        <input type="number" value={obj.specQty ?? 1} onChange={(e) => updateObj("items", obj.id, { specQty: Math.max(0, Number(e.target.value) || 0) })} />
      </div>
    </div>
  );
}
