import React, { useState } from "react";
import { Link } from "react-router-dom";
import { layerById } from "../catalog.js";
import { getWallThkPresets } from "../plannerMaterialPresets.js";
import { resolveTool, filterToolGroups, isImplementedTool } from "../plannerTools.js";
import { sheetById } from "../plannerSheets.js";
import { WALL_TOOL_PRESETS } from "../wallToolPresets.js";
import { WALL_KINDS } from "../wallTypes.js";

function toolWallColor(toolId) {
  const preset = WALL_TOOL_PRESETS[toolId];
  if (!preset?.kind) return null;
  return WALL_KINDS[preset.kind]?.color || null;
}

function ToolRow({ tool, activeToolId, onPick, depth = 0 }) {
  const [subOpen, setSubOpen] = useState(false);
  const hasChildren = tool.children?.length > 0;
  const isActive = activeToolId === tool.id;

  if (hasChildren) {
    const visibleChildren = tool.children.filter((cid) => {
      const child = resolveTool(cid);
      return child && (child.children?.length || isImplementedTool(child));
    });
    if (!visibleChildren.length) return null;
    return (
      <div className={"planner-menu-group" + (subOpen ? " planner-menu-group--open" : "")}>
        <button
          type="button"
          className={"planner-menu-item" + (subOpen ? " planner-menu-item--active" : "")}
          onClick={() => setSubOpen((o) => !o)}
          style={{ paddingLeft: 12 + depth * 10 }}
        >
          <span>{tool.label}</span>
          <span className="planner-menu-item__arrow">›</span>
        </button>
        {subOpen && (
          <div className="planner-menu-submenu">
            {visibleChildren.map((cid) => {
              const child = resolveTool(cid);
              if (!child) return null;
              return (
                <ToolRow
                  key={cid}
                  tool={child}
                  activeToolId={activeToolId}
                  onPick={onPick}
                  depth={depth + 1}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (!isImplementedTool(tool)) return null;

  const wallColor = tool.mode === "wall" ? toolWallColor(tool.id) : null;

  return (
    <button
      type="button"
      className={"planner-menu-item" + (isActive ? " planner-menu-item--active" : "")}
      onClick={() => onPick(tool)}
      style={{ paddingLeft: 12 + depth * 10 }}
      title={tool.hint}
    >
      {wallColor && (
        <span
          className="planner-menu-item__swatch"
          style={{ background: wallColor }}
          aria-hidden
        />
      )}
      <span>{tool.label}</span>
    </button>
  );
}

export function PlannerToolMenu({
  sheetId,
  categoryId,
  activeToolId,
  tool,
  pending,
  wallThk,
  plan,
  onPick,
  onWallThk,
  onRoomPatch,
  onSyncZones,
  onSync,
  specSummary,
  projectId,
  onSelectPlanItem,
  searchQuery = "",
  embedded = false,
}) {
  const sheet = sheetById(sheetId);
  const groups = filterToolGroups(sheet.toolGroups || [], categoryId);
  const q = searchQuery.trim().toLowerCase();

  const matchSearch = (toolDef) => {
    if (!q) return true;
    if (toolDef.label?.toLowerCase().includes(q)) return true;
    if (toolDef.children) {
      return toolDef.children.some((cid) => matchSearch(resolveTool(cid)));
    }
    return false;
  };

  if (sheetId === "specification" || sheetId === "spec") {
    const specObjects = (plan.items || []).filter((it) => it.includedInProject !== false);
    return (
      <div className="planner-tool-menu">
        <p className="planner-spec-intro">
          {onSync
            ? (projectId
              ? "Лист спецификации формируется из объектов плана."
              : "Сформируйте позиции из черновика. Для записи в таблицу привяжите план к проекту.")
            : "Синхронизация недоступна."}
        </p>
        {specSummary && (
          <ul className="planner-spec-stats">
            <li>Объектов: {specSummary.objects ?? "—"}</li>
            <li>Комплектов: {specSummary.kitObjects ?? "—"}</li>
            <li>Трасс: {specSummary.lines ?? "—"}</li>
          </ul>
        )}
        {onSync && (
          <button type="button" className="planner-btn planner-btn--primary planner-tool-menu__cta" onClick={onSync}>
            Синхронизировать
          </button>
        )}
        {projectId && (
          <Link className="planner-btn planner-tool-menu__cta" to={`/project/${projectId}`}>
            Таблица спецификации
          </Link>
        )}
        {specObjects.length > 0 && (
          <div className="planner-spec-list" style={{ marginTop: 12 }}>
            {specObjects.map((it) => (
              <button key={it.id} type="button" className="planner-spec-list__item" onClick={() => onSelectPlanItem?.(it.id)}>
                <span className="planner-spec-list__dot" style={{ background: it.color }} />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="planner-tool-menu">
      <div className="planner-tool-menu__sheet">{layerById(sheet.layerId).name}</div>

      {groups.map((group) => {
        const tools = (group.tools || [])
          .map((id) => resolveTool(id))
          .filter((t) => t && matchSearch(t) && (t.children?.length || isImplementedTool(t)));
        if (!tools.length) return null;
        return (
          <section key={group.id} className="planner-tool-menu__section">
            <div className="planner-side__title">{group.label}</div>
            <div className="planner-menu-list">
              {tools.map((t) => (
                <ToolRow key={t.id} tool={t} activeToolId={activeToolId} onPick={onPick} />
              ))}
            </div>
          </section>
        );
      })}

      {sheetId === "partitions" && (
        <section className="planner-tool-menu__section">
          <div className="planner-side__title">Толщина, мм</div>
          <div className="planner-presets">
            {getWallThkPresets().map((t) => (
              <button key={t} type="button" className={"planner-preset" + (wallThk === t ? " planner-preset--on" : "")} onClick={() => onWallThk?.(t)}>
                {t}
              </button>
            ))}
          </div>
          <input type="number" min={0} value={wallThk} onChange={(e) => onWallThk?.(Math.max(0, +e.target.value || 0))} style={{ marginTop: 8, width: "100%" }} />
          <div className="planner-field" style={{ marginTop: 10 }}>
            <label>Высота помещения, мм</label>
            <input type="number" min={0} value={plan.room.height ?? 3000} onChange={(e) => onRoomPatch?.({ height: Math.max(0, +e.target.value || 0) })} />
          </div>
          {onSyncZones && (
            <button type="button" className="planner-btn planner-tool-menu__cta" onClick={onSyncZones}>
              Обновить помещения
            </button>
          )}
        </section>
      )}

      {tool === "add" && pending && !embedded && (
        <div className="planner-hint">Клик по плану — поставить объект</div>
      )}
      {(tool === "line" || tool === "wall") && !embedded && (
        <div className="planner-hint">Клик — точки · Enter — завершить · Esc — отмена · Backspace — шаг назад · Shift — 90° · Alt — без snap · R — реверс потока</div>
      )}
    </div>
  );
}
