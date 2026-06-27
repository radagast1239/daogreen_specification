import React, { useMemo, useState } from "react";

export function AttachPlanModal({ open, projects, draftName, busy, onClose, onAttach }) {
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (projects || [])
      .filter((p) => {
        if (!ql) return true;
        return `${p.name} ${p.client || ""}`.toLowerCase().includes(ql);
      })
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [projects, q]);

  if (!open) return null;

  return (
    <div className="planner-modal-backdrop no-print" onPointerDown={onClose}>
      <div
        className="planner-modal"
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="planner-modal__head">
          <h3>Привязать к проекту</h3>
          <button type="button" className="planner-btn planner-btn--ghost" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>
        <p className="planner-modal__sub">
          Черновик «<b>{draftName}</b>» станет планом выбранного проекта. Спецификацию можно синхронизировать уже в проекте.
        </p>
        <input
          type="search"
          className="planner-modal__search"
          placeholder="Поиск проекта…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="planner-modal__list">
          {!list.length && (
            <div className="planner-modal__empty">Проекты не найдены</div>
          )}
          {list.map((p) => {
            const itemCount = p.plan?.items?.length ?? 0;
            const wallCount = p.plan?.walls?.length ?? 0;
            const hasPlan = itemCount > 0 || wallCount > 0;
            return (
              <button
                key={p.id}
                type="button"
                className="planner-modal__row"
                disabled={busy}
                onClick={() => onAttach(p)}
              >
                <span className="planner-modal__row-title">{p.name}</span>
                <span className="planner-modal__row-meta">
                  {p.client || "—"}
                  {hasPlan ? ` · план: ${itemCount} объектов` : " · план пустой"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
