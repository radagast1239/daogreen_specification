import React, { useEffect, useMemo, useRef, useState } from "react";
import "./PlannerToolRail.css";

/**
 * Изолированный, props-driven инструмент-рейл планировщика.
 * Не импортирует store/actions, не хранит инструмент планировщика сам —
 * activeToolId и выбор всегда приходят/уходят через props.
 *
 * tool shape:
 *   { id, label, icon?, group?: boolean, children?: tool[], tooltip? }
 */

const FALLBACK_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

const ICONS = {
  select: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 3l6 16 2-6.5L20 10 5 3z" strokeLinejoin="round" />
    </svg>
  ),
  wall: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="9" width="18" height="6" rx="1" />
      <path d="M3 12h18" />
    </svg>
  ),
  door: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 21V4l11 2v15" />
      <path d="M6 21h11" />
      <circle cx="14" cy="13" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  window: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="5" width="16" height="14" rx="1" />
      <path d="M12 5v14M4 12h16" />
    </svg>
  ),
  measure: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 17l14-14" />
      <path d="M8 12l1.5-1.5M11.5 8.5L13 7M15 4.5L16.5 3" />
    </svg>
  ),
  measure_linear: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 12h16" />
      <path d="M4 9v6M20 9v6" />
    </svg>
  ),
  measure_diagonal: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 19L19 5" />
      <path d="M5 19v-5M5 19h5M19 5v5M19 5h-5" />
    </svg>
  ),
  measure_angular: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 19h14M5 19L17 7" />
      <path d="M9.5 19a7 7 0 013-5.7" />
    </svg>
  ),
  objects: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  ),
  engineering: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M13 2L5 14h7l-1 8 9-13h-7l1-7z" />
    </svg>
  ),
  zones: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2" />
    </svg>
  ),
  pan: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3v18M3 12h18" />
      <path d="M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
    </svg>
  ),
};

export function ToolIcon({ name }) {
  return ICONS[name] || FALLBACK_ICON;
}

/** Пример каталога верхнего уровня — реальный список приходит через props.tools. */
export const DEFAULT_TOOL_RAIL = [
  { id: "select", label: "Выбор", icon: "select" },
  { id: "wall", label: "Стены", icon: "wall" },
  { id: "door", label: "Дверь", icon: "door" },
  { id: "window", label: "Окно", icon: "window" },
  {
    id: "measure",
    label: "Размер",
    icon: "measure",
    group: true,
    children: [
      { id: "measure_linear", label: "Линейный", icon: "measure_linear" },
      { id: "measure_diagonal", label: "Диагональный", icon: "measure_diagonal" },
      { id: "measure_angular", label: "Угловой", icon: "measure_angular" },
    ],
  },
  { id: "objects", label: "Объекты", icon: "objects", group: true, children: [] },
  { id: "engineering", label: "Инженерия", icon: "engineering", group: true, children: [] },
  { id: "zones", label: "Зоны", icon: "zones" },
  { id: "pan", label: "Панорама", icon: "pan" },
];

function flattenIds(tools) {
  const out = [];
  for (const t of tools) {
    out.push(t.id);
    if (t.children?.length) out.push(...t.children.map((c) => c.id));
  }
  return out;
}

const VALID_ORIENTATIONS = new Set(["auto", "vertical", "horizontal"]);

export function PlannerToolRail({
  activeToolId = null,
  tools = DEFAULT_TOOL_RAIL,
  disabledToolIds = [],
  orientation = "auto",
  autoCloseGroup = true,
  ensureActiveVisible = true,
  onToolSelect,
  onEscape,
  onOpenGroup,
}) {
  const [openGroupId, setOpenGroupId] = useState(null);
  const railRef = useRef(null);
  const popoverRef = useRef(null);
  const btnRefs = useRef(new Map());

  const safeOrientation = VALID_ORIENTATIONS.has(orientation) ? orientation : "auto";
  const safeTools = Array.isArray(tools) ? tools : DEFAULT_TOOL_RAIL;
  const disabledSet = useMemo(
    () => new Set(Array.isArray(disabledToolIds) ? disabledToolIds : []),
    [disabledToolIds]
  );
  const flatIds = useMemo(() => safeTools.map((t) => t.id), [safeTools]);

  const openGroup = useMemo(() => safeTools.find((t) => t.id === openGroupId) || null, [safeTools, openGroupId]);

  useEffect(() => {
    if (!ensureActiveVisible) return;
    if (!activeToolId || !railRef.current) return;
    const el = btnRefs.current.get(activeToolId);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeToolId, ensureActiveVisible]);

  // Closes an open group popover, notifies the caller, and — unless the
  // popover was dismissed by clicking elsewhere — returns focus to the
  // trigger button that opened it.
  function closeGroup(restoreFocus = true) {
    const idToRestore = openGroupId;
    setOpenGroupId(null);
    onOpenGroup?.(null);
    if (restoreFocus && idToRestore) {
      const el = btnRefs.current.get(idToRestore);
      if (el) requestAnimationFrame(() => el.focus());
    }
  }

  // A single popover is open at a time; clicking outside it (and outside
  // its own trigger button, which handles its own toggle) closes it.
  useEffect(() => {
    if (!openGroupId) return undefined;
    function handlePointerDown(e) {
      const popoverEl = popoverRef.current;
      const triggerEl = btnRefs.current.get(openGroupId);
      if (popoverEl && popoverEl.contains(e.target)) return;
      if (triggerEl && triggerEl.contains(e.target)) return;
      closeGroup(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [openGroupId]);

  function isActive(tool) {
    if (tool.id === activeToolId) return true;
    if (tool.children?.some((c) => c.id === activeToolId)) return true;
    return false;
  }

  function handleToolClick(tool) {
    if (disabledSet.has(tool.id)) return;
    if (tool.group) {
      const next = openGroupId === tool.id ? null : tool.id;
      setOpenGroupId(next);
      onOpenGroup?.(next ? tool : null);
      return;
    }
    onToolSelect?.(tool.id, tool);
  }

  function handleChildClick(child) {
    if (disabledSet.has(child.id)) return;
    onToolSelect?.(child.id, child);
    if (autoCloseGroup) closeGroup();
  }

  function handleKeyDown(e) {
    const ids = flatIds;
    const idx = ids.indexOf(activeToolId ?? document.activeElement?.dataset?.toolId);
    if (e.key === "Escape") {
      if (openGroupId) {
        closeGroup();
      }
      onEscape?.();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const from = ids.indexOf(document.activeElement?.dataset?.toolId);
      const next = ids[(Math.max(from, 0) + 1) % ids.length];
      btnRefs.current.get(next)?.focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const from = ids.indexOf(document.activeElement?.dataset?.toolId);
      const next = ids[(Math.max(from, 0) - 1 + ids.length) % ids.length];
      btnRefs.current.get(next)?.focus();
    }
  }

  const orientationClass =
    safeOrientation === "vertical"
      ? " dg-tool-rail--vertical"
      : safeOrientation === "horizontal"
        ? " dg-tool-rail--horizontal"
        : "";

  return (
    <nav
      ref={railRef}
      className={"dg-tool-rail" + orientationClass}
      aria-label="Инструменты планировщика"
      role="toolbar"
      aria-orientation={safeOrientation === "horizontal" ? "horizontal" : "vertical"}
      onKeyDown={handleKeyDown}
    >
      <div className="dg-tool-rail__main">
        {safeTools.map((tool) => {
          const disabled = disabledSet.has(tool.id);
          const active = isActive(tool);
          return (
            <button
              key={tool.id}
              ref={(el) => {
                if (el) btnRefs.current.set(tool.id, el);
                else btnRefs.current.delete(tool.id);
              }}
              type="button"
              data-tool-id={tool.id}
              className={
                "dg-tool-btn" +
                (active ? " dg-tool-btn--active" : "") +
                (disabled ? " dg-tool-btn--disabled" : "")
              }
              title={tool.tooltip || tool.label}
              aria-label={tool.label}
              aria-pressed={active}
              aria-disabled={disabled}
              aria-haspopup={tool.group ? "true" : undefined}
              aria-expanded={tool.group ? openGroupId === tool.id : undefined}
              disabled={disabled}
              tabIndex={active || (!activeToolId && tool === safeTools[0]) ? 0 : -1}
              onClick={() => handleToolClick(tool)}
            >
              <span className="dg-tool-btn__icon">
                <ToolIcon name={tool.icon} />
              </span>
              <span className="dg-tool-btn__label">{tool.label}</span>
            </button>
          );
        })}
      </div>

      {openGroup ? (
        <div className="dg-tool-popover" role="menu" aria-label={openGroup.label} ref={popoverRef}>
          <div className="dg-tool-popover__title">{openGroup.label}</div>
          <div className="dg-tool-popover__list">
            {(openGroup.children || []).length === 0 ? (
              <div className="dg-tool-popover__empty">Нет доступных инструментов</div>
            ) : (
              openGroup.children.map((child) => {
                const disabled = disabledSet.has(child.id);
                const active = child.id === activeToolId;
                return (
                  <button
                    key={child.id}
                    type="button"
                    role="menuitem"
                    data-tool-id={child.id}
                    className={
                      "dg-tool-popover__item" +
                      (active ? " dg-tool-popover__item--active" : "") +
                      (disabled ? " dg-tool-popover__item--disabled" : "")
                    }
                    title={child.tooltip || child.label}
                    aria-label={child.label}
                    aria-pressed={active}
                    aria-disabled={disabled}
                    disabled={disabled}
                    onClick={() => handleChildClick(child)}
                  >
                    <span className="dg-tool-btn__icon">
                      <ToolIcon name={child.icon} />
                    </span>
                    <span>{child.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </nav>
  );
}

export default PlannerToolRail;
