import React, { useEffect, useRef } from "react";

export function PlannerToolDrawer({ open, title, onClose, children, subMenu }) {
  const drawerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="planner-tool-drawer__backdrop no-print" onPointerDown={onClose} />
      <aside className="planner-tool-drawer no-print" ref={drawerRef}>
        <header className="planner-tool-drawer__head">
          <span className="planner-tool-drawer__title">{title}</span>
          <button type="button" className="planner-tool-drawer__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="planner-tool-drawer__body">
          {children}
        </div>
      </aside>
      {subMenu && (
        <aside className="planner-tool-submenu no-print">
          {subMenu}
        </aside>
      )}
    </>
  );
}
