import React, { useEffect, useRef } from "react";

export function ContextMenu({ menu, onClose, onAction }) {
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!menu) return null;

  const items = menu.items || [];

  return (
    <div
      ref={ref}
      className="planner-ctx-menu no-print"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        it.sep ? (
          <div key={it.id} className="planner-ctx-menu__sep" />
        ) : (
          <button
            key={it.id}
            type="button"
            className={"planner-ctx-menu__item" + (it.danger ? " planner-ctx-menu__item--danger" : "")}
            disabled={it.disabled}
            onClick={() => { onAction(it.id); onClose(); }}
          >
            {it.label}
          </button>
        )
      ))}
    </div>
  );
}

export function buildObjectMenu(obj, coll) {
  if (coll === "walls") {
    return [
      { id: "wall-thk", label: "Толщина стены…" },
      { id: "wall-height", label: "Высота стены…" },
      { id: "wall-material", label: "Материал…" },
      { id: "wall-break", label: "Разорвать в точке" },
      { sep: true, id: "s1" },
      { id: "delete", label: "Удалить стену", danger: true },
    ];
  }
  if (coll === "zones") {
    return [
      { id: "rename", label: "Переименовать" },
      { id: "delete", label: "Удалить помещение", danger: true },
    ];
  }
  if (coll === "items") {
    const base = [
      { id: "resize", label: "Изменить размер" },
      { id: "rotate90", label: "Повернуть 90°" },
      { id: "mirror-h", label: "Отразить по горизонтали" },
      { id: "mirror-v", label: "Отразить по вертикали" },
      { id: "duplicate", label: "Дублировать рядом" },
      { sep: true, id: "s1" },
      { id: "hide-client", label: obj.visibleToClient === false ? "Показать клиенту" : "Скрыть от клиента" },
      { id: "delete", label: "Удалить", danger: true },
    ];
    if (obj.layer === "racks") {
      base.splice(4, 0, { id: "spec", label: "Добавить в спецификацию" });
    }
    return base;
  }
  if (coll === "lines") {
    return [{ id: "delete", label: "Удалить трассу", danger: true }];
  }
  return [{ id: "delete", label: "Удалить", danger: true }];
}
