import React, { useState } from "react";
import { areaM2, LINK_RULES, layerById, catalogByKind, RACK_PRESETS } from "../catalog.js";
import { ZONE_FLOW, itemPowerW, panelCapacityW, zoneForItem } from "../farmRules.js";
import { formatZoneAreaM2, zonePerimeterMm, ZONE_PURPOSE_PRESETS } from "../roomZones.js";
import {
  RACK_TYPES, RACK_PURPOSES, isRackKind, computeGrowAreaM2, nextRackNumber, nextRowLabel,
  rackIconForType, computeRackWeightKg, computeFloorLoadKgM2,
} from "../rackProperties.js";
import {
  STROKE_STYLES, ROUTING_HEIGHTS, LINE_TRAFFIC_TYPES,
  resolveLineVisual, linePlanLengthMm, lineTotalLengthMm,
} from "../lineProperties.js";
import { isDoorKind, doorStyle, isOpeningKind } from "../doorTypes.js";
import { openingStyle } from "../openingTypes.js";
import { WALL_KINDS, THICKNESS_SIDES } from "../wallTypes.js";
import { projectSectionTemplates } from "../specSync.js";
import { collectPlannerWarnings } from "../geometry.js";
import { linkLengthMm, linksForItem, resolveLinkColor } from "../linkGeometry.js";
import { LABEL_DISPLAY_MODES, LABEL_AUDIENCES } from "../labelProperties.js";
import { LINK_TYPE_OPTIONS } from "../linkRules.js";
import {
  OBJECT_STATUSES,
  PORT_TYPES,
  PORT_SIDES,
  defaultServiceZone,
  serviceZoneProfile,
} from "../objectProperties.js";

export function PropertiesPanel({
  tab: tabProp,
  onTabChange,
  sel,
  selObj,
  selection,
  plan,
  project,
  active,
  materials,
  modules,
  updateObj,
  rotateItem,
  delSel,
  onGroup,
  onUngroup,
  fmtU,
  onSync,
  specSummary,
  allWarnings = [],
  onFocusWarning,
  onClose,
  onSelectLink,
}) {
  const [tabLocal, setTabLocal] = useState("props");
  const tab = tabProp ?? tabLocal;
  const setTab = onTabChange ?? setTabLocal;
  const warnings = allWarnings.length ? allWarnings : collectPlannerWarnings(plan, sel);
  const objWarnings = sel?.id
    ? warnings.filter((w) => w.objectIds?.includes(sel.id) || (sel.coll === "lines" && w.id?.includes(sel.id)))
    : warnings;

  const headTitle = panelHeadTitle(sel, selObj, selection, plan);
  const headSub = panelHeadSub(sel, selObj);

  return (
    <aside className="planner-side planner-side--right no-print">
      <div className="planner-props-head">
        <div className="planner-props-head__main">
          <div className="planner-props-head__title">{headTitle}</div>
          {headSub && <div className="planner-props-head__sub">{headSub}</div>}
        </div>
        {onClose && (
          <button type="button" className="planner-props-head__close" onClick={onClose} title="Закрыть панель">
            ×
          </button>
        )}
      </div>
      <div className="planner-props-tabs">
        {[
          { id: "props", label: "Свойства" },
          { id: "spec", label: "Спецификация" },
          { id: "links", label: "Связи" },
          { id: "errors", label: `Ошибки${warnings.length ? ` (${warnings.length})` : ""}` },
          { id: "comments", label: "Комментарии" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={"planner-props-tab" + (tab === t.id ? " planner-props-tab--active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="planner-side__scroll">
        {tab === "errors" && (
          <ErrorsTab
            warnings={sel?.id ? objWarnings : warnings}
            filterLabel={sel?.id ? "Только для выбранного объекта" : "Все предупреждения плана"}
            onFocus={onFocusWarning}
          />
        )}

        {tab === "links" && (
          <LinksTab sel={sel} selObj={selObj} plan={plan} fmtU={fmtU} onSelectLink={onSelectLink} />
        )}

        {tab === "comments" && (
          <CommentsTab sel={sel} selObj={selObj} updateObj={updateObj} />
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

        {tab === "props" && !selObj && selection?.coll === "items" && selection.ids.length > 1 && (
          <div>
            <div className="planner-side__title">Выделено объектов: {selection.ids.length}</div>
            <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginBottom: 12 }}>
              Перемещайте вместе, группируйте (Ctrl+G) или удаляйте (Del).
            </p>
            <div className="planner-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="planner-btn planner-btn--primary" onClick={onGroup}>Сгруппировать</button>
              <button type="button" className="planner-btn" onClick={onUngroup}>Разгруппировать</button>
              <button type="button" className="planner-btn" onClick={delSel}>Удалить все</button>
            </div>
          </div>
        )}

        {tab === "props" && !selObj && !(selection?.coll === "items" && selection.ids.length > 1) && (
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
            selection={selection}
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

function SelFields({ sel, selection, obj, plan, updateObj, rotateItem, delSel, fmtU, active }) {
  if (sel.coll === "labels") {
    const tgt = obj.targetId ? plan.items.find((i) => i.id === obj.targetId) : null;
    return (
      <>
        <div className="planner-side__title">Подпись</div>
        {tgt && (
          <div className="planner-field">
            <label>Привязка</label>
            <input readOnly value={tgt.label || tgt.id} />
          </div>
        )}
        <div className="planner-field">
          <label>Текст</label>
          <textarea rows={4} value={obj.text} onChange={(e) => updateObj("labels", obj.id, { text: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>Аудитория</label>
          <select value={obj.audience || "internal"} onChange={(e) => updateObj("labels", obj.id, { audience: e.target.value })}>
            {LABEL_AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
        <label className="planner-chk">
          <input
            type="checkbox"
            checked={obj.pinned === true}
            onChange={(e) => updateObj("labels", obj.id, { pinned: e.target.checked })}
          />
          {" "}Зафиксировать положение
        </label>
        {tgt && !obj.pinned && (
          <button
            type="button"
            className="planner-btn"
            onClick={() => {
              const anchor = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
              updateObj("labels", obj.id, {
                offsetX: obj.x - anchor.x,
                offsetY: obj.y - anchor.y,
              });
            }}
          >
            Обновить выноску
          </button>
        )}
        <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
      </>
    );
  }
  if (sel.coll === "zones") {
    const auto = obj.auto === true;
    return (
      <>
        <div className="planner-side__title">{obj.name || "Помещение"}</div>
        {auto && (
          <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "0 0 10px" }}>
            Автопомещение из перегородок — контур обновляется при изменении стен.
          </p>
        )}
        <div className="planner-field">
          <label>Название</label>
          <input value={obj.name} onChange={(e) => updateObj("zones", obj.id, { name: e.target.value })} />
        </div>
        {!auto && (
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
        )}
        <div className="planner-field">
          <label>Площадь</label>
          <input readOnly value={`S = ${formatZoneAreaM2(obj)} м²`} />
        </div>
        <div className="planner-field">
          <label>Тип зоны / чистота</label>
          <select value={obj.flow || "neutral"} onChange={(e) => updateObj("zones", obj.id, { flow: e.target.value })}>
            {Object.entries(ZONE_FLOW).map(([id, f]) => (
              <option key={id} value={id}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="planner-field">
          <label>Назначение</label>
          <select
            value={ZONE_PURPOSE_PRESETS.some((p) => p.id === obj.purpose) ? obj.purpose : ""}
            onChange={(e) => updateObj("zones", obj.id, { purpose: e.target.value })}
          >
            {ZONE_PURPOSE_PRESETS.map((p) => (
              <option key={p.id || "none"} value={p.id}>{p.label}</option>
            ))}
          </select>
          <input
            style={{ marginTop: 6 }}
            value={obj.purpose || ""}
            placeholder="Свой текст назначения…"
            onChange={(e) => updateObj("zones", obj.id, { purpose: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>Цвет зоны</label>
          <input type="color" value={obj.zoneColor || "#8a7a9c"} onChange={(e) => updateObj("zones", obj.id, { zoneColor: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>Периметр</label>
          <input readOnly value={fmtU(zonePerimeterMm(obj))} />
        </div>
        <div className="planner-field">
          <label className="planner-chk">
            <input type="checkbox" checked={obj.showName !== false} onChange={(e) => updateObj("zones", obj.id, { showName: e.target.checked })} />
            {" "}Показывать название
          </label>
        </div>
        <div className="planner-field">
          <label className="planner-chk">
            <input type="checkbox" checked={obj.showArea !== false} onChange={(e) => updateObj("zones", obj.id, { showArea: e.target.checked })} />
            {" "}Показывать площадь
          </label>
        </div>
        <div className="planner-field">
          <label className="planner-chk">
            <input type="checkbox" checked={obj.hideFill === true} onChange={(e) => updateObj("zones", obj.id, { hideFill: e.target.checked })} />
            {" "}Без заливки
          </label>
        </div>
        <div className="planner-field">
          <label className="planner-chk">
            <input type="checkbox" checked={obj.contoursOnly === true} onChange={(e) => updateObj("zones", obj.id, { contoursOnly: e.target.checked })} />
            {" "}Только контур
          </label>
        </div>
        <div className="planner-field">
          <label>
            <input type="checkbox" checked={obj.locked !== true} onChange={(e) => updateObj("zones", obj.id, { locked: !e.target.checked })} />
            {" "}Редактирование
          </label>
        </div>
        <div className="planner-field">
          <label>Высота H, мм</label>
          <input type="number" value={obj.height} onChange={(e) => updateObj("zones", obj.id, { height: +e.target.value || 0 })} />
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
      </>
    );
  }
  if (sel.coll === "lines") {
    const vis = resolveLineVisual(obj);
    const planLen = linePlanLengthMm(obj.pts);
    const totalLen = lineTotalLengthMm(obj);
    const from = plan.items.find((i) => i.id === obj.fromItemId);
    const to = plan.items.find((i) => i.id === obj.toItemId);
    return (
      <>
        <div className="planner-side__title">{vis.label || "Трасса"}</div>
        <div className="planner-field">
          <label>Слой</label>
          <input readOnly value={layerById(obj.layer)?.name || obj.layer} />
        </div>
        <div className="planner-field">
          <label>Стиль линии</label>
          <select value={obj.strokeStyle || "solid"} onChange={(e) => updateObj("lines", obj.id, { strokeStyle: e.target.value })}>
            {Object.entries(STROKE_STYLES).map(([id, s]) => (
              <option key={id} value={id}>{s.label}</option>
            ))}
          </select>
        </div>
        {obj.layer === "staff" && (
          <div className="planner-field">
            <label>Назначение маршрута</label>
            <select value={obj.traffic || ""} onChange={(e) => updateObj("lines", obj.id, { traffic: e.target.value })}>
              {LINE_TRAFFIC_TYPES.map((t) => (
                <option key={t.id || "none"} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        )}
        <div className="planner-field">
          <label>Высота прокладки</label>
          <select value={obj.routingHeight || "floor"} onChange={(e) => updateObj("lines", obj.id, { routingHeight: e.target.value })}>
            {ROUTING_HEIGHTS.map((h) => (
              <option key={h.id} value={h.id}>{h.label}</option>
            ))}
          </select>
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>Длина плана</label>
            <input readOnly value={fmtU(planLen)} />
          </div>
          <div className="planner-field">
            <label>Запас, %</label>
            <input type="number" value={obj.reservePct ?? 10} onChange={(e) => updateObj("lines", obj.id, { reservePct: Math.max(0, +e.target.value || 0) })} />
          </div>
        </div>
        <div className="planner-field">
          <label>Итого с запасом</label>
          <input readOnly value={fmtU(totalLen)} />
        </div>
        <div className="planner-row">
          <div className="planner-field">
            <label>Цвет</label>
            <input type="color" value={obj.color || vis.color} onChange={(e) => updateObj("lines", obj.id, { color: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>Толщина</label>
            <input type="number" step="0.5" value={obj.strokeW ?? ""} placeholder={String(vis.w)} onChange={(e) => updateObj("lines", obj.id, { strokeW: e.target.value ? +e.target.value : null })} />
          </div>
        </div>
        <label className="planner-chk">
          <input type="checkbox" checked={obj.showArrows !== false} onChange={(e) => updateObj("lines", obj.id, { showArrows: e.target.checked })} />
          {" "}Стрелки направления
        </label>
        <label className="planner-chk">
          <input type="checkbox" checked={obj.orthoRoute !== false} onChange={(e) => updateObj("lines", obj.id, { orthoRoute: e.target.checked })} />
          {" "}Ортогональная трассировка (90°)
        </label>
        <div className="planner-field">
          <label>От объекта</label>
          <input readOnly value={from?.label || "—"} />
        </div>
        <div className="planner-field">
          <label>К объекту</label>
          <input readOnly value={to?.label || "—"} />
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
      </>
    );
  }
  if (sel.coll === "links") {
    const rule = LINK_RULES[obj.type] || { label: "Связь", color: "#5a5f5c" };
    const from = plan.items.find((i) => i.id === obj.fromId);
    const to = plan.items.find((i) => i.id === obj.toId);
    const len = linkLengthMm(obj, plan.items, plan.room);
    const color = resolveLinkColor(obj);
    return (
      <>
        <div className="planner-side__title">{rule.label}</div>
        <div className="planner-field">
          <label>Тип связи</label>
          <select
            value={obj.type || "irrigation"}
            onChange={(e) => updateObj("links", obj.id, { type: e.target.value, color: LINK_RULES[e.target.value]?.color || null })}
          >
            {LINK_TYPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
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
          <label>Цвет</label>
          <input
            type="color"
            value={color}
            onChange={(e) => updateObj("links", obj.id, { color: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>Комментарий</label>
          <input
            value={obj.comment || ""}
            onChange={(e) => updateObj("links", obj.id, { comment: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>
            <input type="checkbox" checked={obj.ortho !== false} onChange={(e) => updateObj("links", obj.id, { ortho: e.target.checked })} />
            {" "}Ортогональный маршрут
          </label>
        </div>
        <div className="planner-field">
          <label>
            <input type="checkbox" checked={obj.visible !== false} onChange={(e) => updateObj("links", obj.id, { visible: e.target.checked })} />
            {" "}Показывать на плане
          </label>
        </div>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить связь</button>
      </>
    );
  }
  if (sel.coll === "walls") {
    const segLen = obj.pts?.length >= 2
      ? Math.hypot(obj.pts[obj.pts.length - 1].x - obj.pts[obj.pts.length - 2].x, obj.pts[obj.pts.length - 1].y - obj.pts[obj.pts.length - 2].y)
      : 0;
    return (
      <>
        <div className="planner-side__title">{obj.role === "outer" ? "Наружная стена" : "Перегородка"}</div>
        <div className="planner-field">
          <label>Тип</label>
          <select value={obj.kind || "new"} onChange={(e) => updateObj("walls", obj.id, { kind: e.target.value })}>
            {Object.entries(WALL_KINDS).map(([id, k]) => (
              <option key={id} value={id}>{k.label}</option>
            ))}
          </select>
        </div>
        <div className="planner-field">
          <label>Роль</label>
          <select value={obj.role || "partition"} onChange={(e) => updateObj("walls", obj.id, { role: e.target.value })}>
            <option value="outer">Наружная</option>
            <option value="partition">Перегородка</option>
          </select>
        </div>
        <div className="planner-field">
          <label>Толщина, мм</label>
          <input type="number" value={obj.thk} onChange={(e) => updateObj("walls", obj.id, { thk: Math.max(40, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>Сторона толщины</label>
          <select value={obj.thicknessSide || "center"} onChange={(e) => updateObj("walls", obj.id, { thicknessSide: e.target.value })}>
            {THICKNESS_SIDES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
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
          <label>Длина сегмента</label>
          <input readOnly value={fmtU(segLen)} />
        </div>
        <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 8 }}>
          Узлы тянут соседние стены. ПКМ — объединить, выровнять, разорвать. Alt — 10 мм, Shift — 500 мм.
        </p>
        <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
      </>
    );
  }
  if (sel.coll === "items") {
    const dStyle = isDoorKind(obj.kind) ? doorStyle(obj.kind) : null;
    const oStyle = isOpeningKind(obj.kind) ? openingStyle(obj.kind) : null;
    return (
      <>
        <div className="planner-side__title">{obj.label}</div>
        {dStyle && (
          <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "0 0 10px" }}>
            Тип: <b style={{ color: dStyle.accent || dStyle.color }}>{dStyle.label}</b>
          </p>
        )}
        {oStyle && (
          <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "0 0 10px" }}>
            Тип: <b style={{ color: oStyle.accent || oStyle.color }}>{oStyle.label}</b>
          </p>
        )}
        <div className="planner-field">
          <label>Название</label>
          <input value={obj.label} onChange={(e) => updateObj("items", obj.id, { label: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>Помещение</label>
          <input readOnly value={zoneForItem(plan, obj)?.name || obj.zoneName || "— вне помещения —"} />
        </div>
        {isRackKind(obj.kind) && (
          <RackPropertyFields obj={obj} plan={plan} updateObj={updateObj} />
        )}
        {isDoorKind(obj.kind) && (
          <>
            <div className="planner-field">
              <label>Номер</label>
              <input value={obj.doorNum || ""} placeholder="Д01" onChange={(e) => updateObj("items", obj.id, { doorNum: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>Проём, мм</label>
              <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(600, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>Высота проёма, мм</label>
              <input type="number" value={obj.doorHeightMm ?? 2100} onChange={(e) => updateObj("items", obj.id, { doorHeightMm: Math.max(1800, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>Сторона петель</label>
              <select value={obj.doorSwing || "left"} onChange={(e) => updateObj("items", obj.id, { doorSwing: e.target.value })}>
                <option value="left">Слева</option>
                <option value="right">Справа</option>
              </select>
            </div>
            <div className="planner-field">
              <label>
                <input type="checkbox" checked={obj.doorOpenIn !== false} onChange={(e) => updateObj("items", obj.id, { doorOpenIn: e.target.checked })} />
                {" "}Открывание внутрь помещения
              </label>
            </div>
            {obj.kind !== "door_slide" && (
              <label className="planner-chk">
                <input
                  type="checkbox"
                  checked={(obj.serviceZone || defaultServiceZone(obj.kind)).enabled !== false}
                  onChange={(e) => updateObj("items", obj.id, {
                    serviceZone: { ...(obj.serviceZone || defaultServiceZone(obj.kind)), enabled: e.target.checked, swing: true },
                  })}
                />
                {" "}Показывать зону открывания
              </label>
            )}
          </>
        )}
        {isOpeningKind(obj.kind) && (
          <>
            <div className="planner-field">
              <label>Номер</label>
              <input value={obj.openingNum || ""} placeholder="О01" onChange={(e) => updateObj("items", obj.id, { openingNum: e.target.value })} />
            </div>
            <div className="planner-field">
              <label>Проём, мм</label>
              <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(300, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>Высота проёма, мм</label>
              <input type="number" value={obj.openingHeightMm ?? 1200} onChange={(e) => updateObj("items", obj.id, { openingHeightMm: Math.max(200, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>Высота от пола, мм</label>
              <input type="number" value={obj.openingSillMm ?? 900} onChange={(e) => updateObj("items", obj.id, { openingSillMm: Math.max(0, +e.target.value || 0) })} />
            </div>
            <div className="planner-field">
              <label>Форма</label>
              <select value={obj.openingShape || "rect"} onChange={(e) => updateObj("items", obj.id, { openingShape: e.target.value })}>
                <option value="rect">Прямоугольный</option>
                <option value="arch">Арочный</option>
              </select>
            </div>
          </>
        )}
        {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && (
        <div className="planner-side__title" style={{ marginTop: 12 }}>Размеры и позиция</div>
        )}
        {(isDoorKind(obj.kind) || isOpeningKind(obj.kind)) && (
        <div className="planner-side__title" style={{ marginTop: 12 }}>Позиция</div>
        )}
        <div className="planner-row">
          <div className="planner-field">
            <label>X, мм</label>
            <input type="number" value={Math.round(obj.x)} onChange={(e) => updateObj("items", obj.id, { x: +e.target.value || 0 })} />
          </div>
          <div className="planner-field">
            <label>Y, мм</label>
            <input type="number" value={Math.round(obj.y)} onChange={(e) => updateObj("items", obj.id, { y: +e.target.value || 0 })} />
          </div>
        </div>
        {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && (
        <div className="planner-row">
          <div className="planner-field">
            <label>Ширина, мм</label>
            <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(50, +e.target.value || 0) })} />
          </div>
          <div className="planner-field">
            <label>Глубина, мм</label>
            <input type="number" value={obj.h} onChange={(e) => updateObj("items", obj.id, { h: Math.max(50, +e.target.value || 0) })} />
          </div>
        </div>
        )}
        <div className="planner-field">
          <label>Поворот, °</label>
          <input
            type="range"
            min={0}
            max={359}
            value={obj.angle || 0}
            onChange={(e) => updateObj("items", obj.id, { angle: +e.target.value })}
            disabled={isDoorKind(obj.kind)}
          />
          <input
            type="number"
            min={0}
            max={359}
            value={obj.angle || 0}
            onChange={(e) => updateObj("items", obj.id, { angle: ((+e.target.value || 0) % 360 + 360) % 360 })}
            style={{ marginTop: 4 }}
            disabled={isDoorKind(obj.kind)}
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
        <ItemPropertyFields obj={obj} plan={plan} updateObj={updateObj} fmtU={fmtU} hideComments />
        {!isDoorKind(obj.kind) && (
        <p style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 8 }}>
          [ ] — поворот 15° · Shift 90° · Alt 1° · стрелки — сдвиг 50/500/10 мм
        </p>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button type="button" className="planner-btn" onClick={() => rotateItem(obj, 90)}>↻ 90°</button>
          <button type="button" className="planner-btn" onClick={delSel}>Удалить</button>
        </div>
      </>
    );
  }
  return null;
}

function ItemPropertyFields({ obj, plan, updateObj, fmtU, hideComments = false }) {
  const cat = catalogByKind(obj.kind);
  const layer = layerById(obj.layer);
  const room = zoneForItem(plan, obj);
  const sz = obj.serviceZone || defaultServiceZone(obj.kind);
  const patchSz = (p) => updateObj("items", obj.id, { serviceZone: { ...sz, ...p } });
  const profile = serviceZoneProfile(obj.kind);

  return (
    <>
      <div className="planner-side__title" style={{ marginTop: 12 }}>Объект</div>
      <div className="planner-field">
        <label>Тип</label>
        <input readOnly value={cat.label} />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Слой</label>
          <input readOnly value={layer.name} />
        </div>
        <div className="planner-field">
          <label>Помещение</label>
          <input readOnly value={room?.name || "—"} />
        </div>
      </div>
      {obj.wallId && (
        <div className="planner-field">
          <label>Стена</label>
          <input readOnly value={obj.wallId} />
        </div>
      )}

      <div className="planner-field">
        <label>Подпись на плане</label>
        <select
          value={obj.labelMode || ""}
          onChange={(e) => updateObj("items", obj.id, { labelMode: e.target.value || null })}
        >
          <option value="">По настройке листа</option>
          {LABEL_DISPLAY_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      <div className="planner-side__title" style={{ marginTop: 12 }}>Статус и видимость</div>
      <div className="planner-field">
        <label>Статус</label>
        <select
          value={obj.objectStatus || "draft"}
          onChange={(e) => {
            const objectStatus = e.target.value;
            updateObj("items", obj.id, {
              objectStatus,
              approved: objectStatus === "approved",
              includedInProject: objectStatus !== "excluded",
            });
          }}
        >
          {Object.entries(OBJECT_STATUSES).map(([id, s]) => (
            <option key={id} value={id}>{s.label}</option>
          ))}
        </select>
      </div>
      <label className="planner-chk">
        <input
          type="checkbox"
          checked={obj.includedInProject !== false}
          onChange={(e) => updateObj("items", obj.id, { includedInProject: e.target.checked })}
        />
        {" "}Включено в проект
      </label>
      <label className="planner-chk">
        <input
          type="checkbox"
          checked={obj.visibleToClient !== false}
          onChange={(e) => updateObj("items", obj.id, { visibleToClient: e.target.checked })}
        />
        {" "}Показать клиенту
      </label>
      <label className="planner-chk">
        <input
          type="checkbox"
          checked={obj.locked === true}
          onChange={(e) => updateObj("items", obj.id, { locked: e.target.checked })}
        />
        {" "}Заблокировать на плане
      </label>

      {!isDoorKind(obj.kind) && !isOpeningKind(obj.kind) && (
        <>
          <div className="planner-side__title" style={{ marginTop: 12 }}>Установка и нагрузка</div>
          <div className="planner-row">
            <div className="planner-field">
              <label>Высота от пола, мм</label>
              <input
                type="number"
                value={obj.mountHeightMm ?? 0}
                onChange={(e) => updateObj("items", obj.id, { mountHeightMm: Math.max(0, +e.target.value || 0) })}
              />
            </div>
            <div className="planner-field">
              <label>Высота объекта, мм</label>
              <input
                type="number"
                value={obj.height ?? ""}
                placeholder={String(plan.room?.height || 3000)}
                onChange={(e) => updateObj("items", obj.id, { height: +e.target.value || 0 })}
              />
            </div>
          </div>
          <div className="planner-row">
            <div className="planner-field">
              <label>Вес, кг</label>
              <input
                type="number"
                value={obj.weightKg ?? ""}
                placeholder="—"
                onChange={(e) => updateObj("items", obj.id, { weightKg: e.target.value === "" ? "" : +e.target.value })}
              />
            </div>
            <div className="planner-field">
              <label>Нагрузка на пол, кг</label>
              <input
                type="number"
                value={obj.floorLoadKg ?? ""}
                placeholder="—"
                onChange={(e) => updateObj("items", obj.id, { floorLoadKg: e.target.value === "" ? "" : +e.target.value })}
              />
            </div>
          </div>

          <div className="planner-side__title" style={{ marginTop: 12 }}>Сервисная зона</div>
          {profile && (
            <p className="planner-hint" style={{ margin: "0 0 8px", fontSize: 12, color: "#6d7772" }}>
              Профиль: {profile.label}
              {profile.hints?.front ? ` · ${profile.hints.front}` : ""}
            </p>
          )}
          <label className="planner-chk">
            <input
              type="checkbox"
              checked={sz.enabled !== false}
              onChange={(e) => patchSz({ enabled: e.target.checked, ...(!e.target.checked ? {} : defaultServiceZone(obj.kind)) })}
            />
            {" "}Показывать зону обслуживания
          </label>
          {sz.enabled !== false && (
            <div className="planner-row">
              <div className="planner-field">
                <label>Спереди, мм</label>
                <input type="number" value={sz.front ?? 0} onChange={(e) => patchSz({ front: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>Сзади, мм</label>
                <input type="number" value={sz.back ?? 0} onChange={(e) => patchSz({ back: Math.max(0, +e.target.value || 0) })} />
              </div>
            </div>
          )}
          {sz.enabled !== false && (
            <div className="planner-row">
              <div className="planner-field">
                <label>Слева, мм</label>
                <input type="number" value={sz.left ?? 0} onChange={(e) => patchSz({ left: Math.max(0, +e.target.value || 0) })} />
              </div>
              <div className="planner-field">
                <label>Справа, мм</label>
                <input type="number" value={sz.right ?? 0} onChange={(e) => patchSz({ right: Math.max(0, +e.target.value || 0) })} />
              </div>
            </div>
          )}
          <div className="planner-field">
            <label>Зона доступа персонала, мм</label>
            <input
              type="number"
              value={obj.accessZoneMm ?? sz.access ?? 0}
              onChange={(e) => updateObj("items", obj.id, { accessZoneMm: Math.max(0, +e.target.value || 0) })}
            />
          </div>
          {(profile?.defaults?.flow != null || (sz.flow ?? 0) > 0) && (
            <div className="planner-field">
              <label>Зона потока (вент.), мм</label>
              <input type="number" value={sz.flow ?? 0} onChange={(e) => patchSz({ flow: Math.max(0, +e.target.value || 0) })} />
            </div>
          )}

          {(obj.ports?.length > 0) && (
            <>
              <div className="planner-side__title" style={{ marginTop: 12 }}>Порты подключения</div>
              {obj.ports.map((port, i) => (
                <div key={i} className="planner-row" style={{ marginBottom: 6 }}>
                  <div className="planner-field">
                    <label>{PORT_TYPES[port.type]?.label || port.type}</label>
                    <select
                      value={port.side || "back"}
                      onChange={(e) => {
                        const ports = [...obj.ports];
                        ports[i] = { ...ports[i], side: e.target.value };
                        updateObj("items", obj.id, { ports });
                      }}
                    >
                      {PORT_SIDES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {!hideComments && (
        <>
          <div className="planner-side__title" style={{ marginTop: 12 }}>Комментарии</div>
          <div className="planner-field">
            <label>Внутренний</label>
            <textarea rows={2} value={obj.commentInternal || ""} onChange={(e) => updateObj("items", obj.id, { commentInternal: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>Клиенту</label>
            <textarea rows={2} value={obj.commentClient || ""} onChange={(e) => updateObj("items", obj.id, { commentClient: e.target.value })} />
          </div>
          <div className="planner-field">
            <label>Монтажнику</label>
            <textarea rows={2} value={obj.commentInstall || ""} onChange={(e) => updateObj("items", obj.id, { commentInstall: e.target.value })} />
          </div>
        </>
      )}

      <div className="planner-side__title" style={{ marginTop: 12 }}>Ссылки и закупка</div>
      <div className="planner-field">
        <label>Фото (URL)</label>
        <input value={obj.photoUrl || ""} placeholder="https://…" onChange={(e) => updateObj("items", obj.id, { photoUrl: e.target.value })} />
      </div>
      <div className="planner-field">
        <label>Ссылка</label>
        <input value={obj.externalUrl || ""} placeholder="https://…" onChange={(e) => updateObj("items", obj.id, { externalUrl: e.target.value })} />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Поставщик</label>
          <input value={obj.supplier || ""} onChange={(e) => updateObj("items", obj.id, { supplier: e.target.value })} />
        </div>
        <div className="planner-field">
          <label>Цена, ₽</label>
          <input type="number" value={obj.specPrice ?? ""} onChange={(e) => updateObj("items", obj.id, { specPrice: e.target.value })} />
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Кол-во</label>
          <input type="number" value={obj.specQty ?? 1} onChange={(e) => updateObj("items", obj.id, { specQty: Math.max(0, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>Ед. изм.</label>
          <input value={obj.specUnit || "шт."} onChange={(e) => updateObj("items", obj.id, { specUnit: e.target.value })} />
        </div>
      </div>
    </>
  );
}

function ItemLinksList({ itemId, plan, onSelectLink, clickable = false }) {
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
      <div className="planner-side__title">Связи объекта</div>
      <ul className="planner-links-list">
        {links.map((l) => {
          const otherId = l.fromId === itemId ? l.toId : l.fromId;
          const other = plan.items.find((i) => i.id === otherId);
          const rule = LINK_RULES[l.type];
          const len = linkLengthMm(l, plan.items, plan.room);
          return (
            <li key={l.id}>
              {clickable ? (
                <button type="button" className="planner-link-row" onClick={() => onSelectLink?.(l.id, otherId)}>
                  <span>{rule?.label || l.type}: {l.fromId === itemId ? "→" : "←"} {other?.label || "?"}</span>
                  <span className="planner-link-row__meta">{Math.round(len.total)} мм</span>
                </button>
              ) : (
                <>
                  {rule?.label || l.type}: {l.fromId === itemId ? "→" : "←"} {other?.label || "?"}{" "}
                  <span style={{ color: "var(--pl-text-muted)" }}>({Math.round(len.total)} мм)</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function panelHeadTitle(sel, selObj, selection, plan) {
  if (selection?.coll === "items" && selection.ids.length > 1) {
    return `Выбрано объектов: ${selection.ids.length}`;
  }
  if (!selObj) return "Свойства плана";
  if (sel.coll === "items") return selObj.label || catalogByKind(selObj.kind)?.label || "Объект";
  if (sel.coll === "walls") return selObj.role === "outer" ? "Наружная стена" : "Перегородка";
  if (sel.coll === "zones") return selObj.name || "Помещение";
  if (sel.coll === "lines") return resolveLineVisual(selObj).label || "Трасса";
  if (sel.coll === "links") return (LINK_RULES[selObj.type] || {}).label || "Связь";
  if (sel.coll === "labels") return "Подпись";
  return "Объект";
}

function panelHeadSub(sel, selObj) {
  if (!selObj) return null;
  if (sel.coll === "items") {
    const cat = catalogByKind(selObj.kind);
    return cat?.label || selObj.kind;
  }
  if (sel.coll === "walls") return WALL_KINDS[selObj.kind]?.label;
  if (sel.coll === "zones") return selObj.purpose || ZONE_FLOW[selObj.flow]?.label;
  if (sel.coll === "lines") return layerById(selObj.layer)?.name;
  return null;
}

function ErrorsTab({ warnings, filterLabel, onFocus }) {
  return (
    <div>
      <p className="planner-hint" style={{ margin: "0 0 10px", fontSize: 12, color: "var(--pl-text-muted)" }}>
        {filterLabel}. Клик — перейти к объекту.
      </p>
      {warnings.length === 0 && (
        <div className="planner-empty-props">Предупреждений нет</div>
      )}
      {warnings.map((w) => (
        <button
          key={w.id}
          type="button"
          className={"planner-warn planner-warn--clickable planner-warn--" + (w.severity || "warning")}
          onClick={() => onFocus?.(w)}
          disabled={!onFocus || (!w.objectIds?.length && !w.wallIds?.length)}
        >
          <span className="planner-warn__icon">{w.severity === "critical" ? "✕" : w.severity === "info" ? "i" : "!"}</span>
          <span>{w.text}</span>
        </button>
      ))}
    </div>
  );
}

function LinksTab({ sel, selObj, plan, fmtU, onSelectLink }) {
  if (sel?.coll === "links" && selObj) {
    const from = plan.items.find((i) => i.id === selObj.fromId);
    const to = plan.items.find((i) => i.id === selObj.toId);
    const len = linkLengthMm(selObj, plan.items, plan.room);
    const rule = LINK_RULES[selObj.type];
    return (
      <>
        <div className="planner-side__title">{rule?.label || "Связь"}</div>
        <div className="planner-field"><label>От</label><input readOnly value={from?.label || "—"} /></div>
        <div className="planner-field"><label>К</label><input readOnly value={to?.label || "—"} /></div>
        <div className="planner-field"><label>Длина</label><input readOnly value={fmtU(len.total)} /></div>
        {selObj.comment && (
          <div className="planner-field"><label>Комментарий</label><input readOnly value={selObj.comment} /></div>
        )}
      </>
    );
  }
  if (sel?.coll === "items" && selObj) {
    return <ItemLinksList itemId={selObj.id} plan={plan} onSelectLink={onSelectLink} clickable />;
  }
  const all = plan.links || [];
  if (!all.length) {
    return <div className="planner-empty-props">Связей на плане пока нет</div>;
  }
  return (
    <div>
      <div className="planner-side__title">Все связи ({all.length})</div>
      <ul className="planner-links-list">
        {all.map((l) => {
          const from = plan.items.find((i) => i.id === l.fromId);
          const to = plan.items.find((i) => i.id === l.toId);
          const rule = LINK_RULES[l.type];
          return (
            <li key={l.id}>
              <button type="button" className="planner-link-row" onClick={() => onSelectLink?.(l.id)}>
                <span>{rule?.label || l.type}: {from?.label || "?"} → {to?.label || "?"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CommentsTab({ sel, selObj, updateObj }) {
  if (sel?.coll !== "items" || !selObj) {
    return (
      <div className="planner-empty-props">
        Выберите объект на плане, чтобы редактировать комментарии для клиента, монтажа и внутренние заметки.
      </div>
    );
  }
  return (
    <>
      <div className="planner-side__title">{selObj.label}</div>
      <div className="planner-field">
        <label>Внутренний комментарий</label>
        <textarea rows={4} value={selObj.commentInternal || ""} onChange={(e) => updateObj("items", selObj.id, { commentInternal: e.target.value })} />
      </div>
      <div className="planner-field">
        <label>Комментарий клиенту</label>
        <textarea rows={4} value={selObj.commentClient || ""} onChange={(e) => updateObj("items", selObj.id, { commentClient: e.target.value })} />
        <p className="planner-hint" style={{ fontSize: 11, margin: "4px 0 0", color: "var(--pl-text-muted)" }}>
          Не попадает в клиентский PDF, если объект скрыт от клиента.
        </p>
      </div>
      <div className="planner-field">
        <label>Комментарий монтажнику</label>
        <textarea rows={4} value={selObj.commentInstall || ""} onChange={(e) => updateObj("items", selObj.id, { commentInstall: e.target.value })} />
      </div>
      <div className="planner-field">
        <label>Комментарий на связи / трассе</label>
        <p className="planner-hint" style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: 0 }}>
          Для инженерных связей откройте вкладку «Связи» или выберите линию на плане.
        </p>
      </div>
    </>
  );
}

function RackPropertyFields({ obj, plan, updateObj }) {
  const growArea = computeGrowAreaM2(obj);
  const weight = computeRackWeightKg(obj);
  const floorLoad = computeFloorLoadKgM2(obj);
  const applyPreset = (p) => {
    updateObj("items", obj.id, { w: p.w, h: p.h });
  };
  return (
    <>
      <div className="planner-side__title" style={{ marginTop: 12 }}>Стеллаж</div>
      <div className="planner-field">
        <label>Типовые размеры</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {RACK_PRESETS.map((p) => (
            <button
              key={`${p.w}x${p.h}`}
              type="button"
              className="planner-btn planner-btn--sm"
              onClick={() => applyPreset(p)}
            >
              {p.w}×{p.h}
            </button>
          ))}
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Номер</label>
          <input
            value={obj.rackNum || ""}
            placeholder={nextRackNumber(plan.items, obj.id)}
            onChange={(e) => updateObj("items", obj.id, { rackNum: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>Ряд</label>
          <input
            value={obj.rowNum || ""}
            placeholder={nextRowLabel(plan.items)}
            onChange={(e) => updateObj("items", obj.id, { rowNum: e.target.value })}
          />
        </div>
      </div>
      <div className="planner-field">
        <label>Тип системы</label>
        <select
          value={obj.rackType || "nft"}
          onChange={(e) => updateObj("items", obj.id, {
            rackType: e.target.value,
            icon: rackIconForType(e.target.value),
          })}
        >
          {RACK_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>
      <div className="planner-field">
        <label>Назначение</label>
        <select value={obj.rackPurpose || "production"} onChange={(e) => updateObj("items", obj.id, { rackPurpose: e.target.value })}>
          {RACK_PURPOSES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Длина, мм</label>
          <input type="number" value={obj.w} onChange={(e) => updateObj("items", obj.id, { w: Math.max(400, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>Ширина, мм</label>
          <input type="number" value={obj.h} onChange={(e) => updateObj("items", obj.id, { h: Math.max(300, +e.target.value || 0) })} />
        </div>
      </div>
      <div className="planner-field">
        <label>Высота стеллажа H, мм</label>
        <input
          type="number"
          value={obj.rackHeightMm ?? 2400}
          onChange={(e) => updateObj("items", obj.id, { rackHeightMm: Math.max(1200, +e.target.value || 0) })}
        />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Ярусов</label>
          <input
            type="number"
            value={obj.tierCount ?? obj.params?.tiers ?? 5}
            onChange={(e) => {
              const tierCount = Math.max(1, +e.target.value || 1);
              updateObj("items", obj.id, {
                tierCount,
                params: { ...(obj.params || {}), tiers: tierCount },
              });
            }}
          />
        </div>
        <div className="planner-field">
          <label>Каналов / ярус</label>
          <input
            type="number"
            value={obj.channelCount ?? obj.params?.levels ?? 4}
            onChange={(e) => {
              const channelCount = Math.max(1, +e.target.value || 1);
              updateObj("items", obj.id, {
                channelCount,
                params: { ...(obj.params || {}), levels: channelCount },
              });
            }}
          />
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Шаг ярусов, мм</label>
          <input type="number" value={obj.tierSpacingMm ?? 400} onChange={(e) => updateObj("items", obj.id, { tierSpacingMm: Math.max(200, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>Растений, шт</label>
          <input value={obj.plantCount ?? ""} onChange={(e) => updateObj("items", obj.id, { plantCount: e.target.value })} />
        </div>
      </div>
      <div className="planner-field">
        <label>Культура</label>
        <input value={obj.culture || ""} placeholder="Салат, клубника…" onChange={(e) => updateObj("items", obj.id, { culture: e.target.value })} />
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>S выращ., м²</label>
          <input
            value={obj.growAreaM2 ?? ""}
            placeholder={growArea}
            onChange={(e) => updateObj("items", obj.id, { growAreaM2: e.target.value })}
          />
        </div>
        <div className="planner-field">
          <label>Расход воды, л/ч</label>
          <input value={obj.waterFlowLh ?? ""} onChange={(e) => updateObj("items", obj.id, { waterFlowLh: e.target.value })} />
        </div>
      </div>
      <div className="planner-row">
        <div className="planner-field">
          <label>Мощность света, Вт</label>
          <input type="number" value={obj.lightPowerW ?? ""} onChange={(e) => updateObj("items", obj.id, { lightPowerW: Math.max(0, +e.target.value || 0) })} />
        </div>
        <div className="planner-field">
          <label>Вес с водой, кг</label>
          <input
            value={obj.weightKg ?? ""}
            placeholder={String(weight)}
            onChange={(e) => updateObj("items", obj.id, { weightKg: e.target.value })}
          />
        </div>
      </div>
      <div className="planner-field">
        <label>Нагрузка на пол</label>
        <input readOnly value={`~${floorLoad} кг/м² (вес ~${weight} кг)`} />
      </div>
      <p style={{ fontSize: 12, color: "var(--pl-text-muted)", margin: "4px 0 0" }}>
        S выращ. {growArea} м² · ПКМ — ряд или сетка · связи: полив / электрика / свет
      </p>
    </>
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
        <label>Статус на плане</label>
        <select
          value={obj.objectStatus || "draft"}
          onChange={(e) => updateObj("items", obj.id, { objectStatus: e.target.value, approved: e.target.value === "approved" })}
        >
          {Object.entries(OBJECT_STATUSES).map(([id, s]) => (
            <option key={id} value={id}>{s.label}</option>
          ))}
        </select>
      </div>
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
