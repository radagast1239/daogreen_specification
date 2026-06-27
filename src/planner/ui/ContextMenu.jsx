import React, { useEffect, useRef } from "react";
import { isOpeningKind } from "../openingTypes.js";
import { isRackKind } from "../rackProperties.js";
import { RACK_LINK_ACTIONS } from "../linkGeometry.js";

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

export function buildObjectMenu(obj, coll, opts = {}) {
  if (opts.multiCount > 1 && coll === "items") {
    return [
      { id: "group", label: "Сгруппировать (Ctrl+G)" },
      { id: "ungroup", label: "Разгруппировать (Ctrl+Shift+G)" },
      { sep: true, id: "s0" },
      { id: "rotate90", label: "Повернуть 90°" },
      { id: "duplicate", label: "Дублировать все" },
      { sep: true, id: "s1" },
      { id: "delete", label: `Удалить (${opts.multiCount})`, danger: true },
    ];
  }
  if (coll === "walls") {
    const segHint = opts.nodeIdx != null ? ` (узел ${opts.nodeIdx + 1})` : "";
    return [
      { id: "wall-role-outer", label: obj.role === "outer" ? "✓ Наружная стена" : "Сделать наружной" },
      { id: "wall-role-partition", label: obj.role === "partition" ? "✓ Перегородка" : "Сделать перегородкой" },
      { sep: true, id: "s-role" },
      { id: "wall-kind", label: "Тип стены…" },
      { id: "wall-thk", label: "Толщина стены…" },
      { id: "wall-height", label: "Высота стены…" },
      { id: "wall-side", label: "Сторона толщины…" },
      { id: "wall-length", label: `Точная длина сегмента${segHint}…` },
      { id: "wall-length-total", label: "Длина всей стены…" },
      { sep: true, id: "s0" },
      { id: "wall-straight-h", label: "Горизонтально" },
      { id: "wall-straight-v", label: "Вертикально" },
      { id: "wall-align", label: "Выровнять по соседней" },
      { id: "wall-merge", label: "Объединить с соседней" },
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
      { id: "group", label: obj.groupId ? "Перегруппировать" : "Сгруппировать (Ctrl+G)", disabled: opts.multiCount === 1 && !obj.groupId },
      { id: "ungroup", label: "Разгруппировать", disabled: !obj.groupId },
      { sep: true, id: "s0" },
      { id: "resize", label: "Изменить размер" },
      { id: "rotate90", label: "Повернуть 90°" },
      { id: "mirror-h", label: "Отразить по горизонтали" },
      { id: "mirror-v", label: "Отразить по вертикали" },
      { id: "duplicate", label: "Дублировать рядом" },
      { sep: true, id: "s-label" },
      { id: "add-label", label: "Добавить подпись" },
      { id: "item-lock", label: obj.locked ? "Разблокировать" : "Заблокировать" },
      { sep: true, id: "s1" },
      { id: "hide-client", label: obj.visibleToClient === false ? "Показать клиенту" : "Скрыть от клиента" },
      { id: "delete", label: "Удалить", danger: true },
    ];
    if (obj.kind?.startsWith("door")) {
      base.splice(6, 0,
        { id: "door-swing", label: obj.doorSwing === "right" ? "Петли справа → слева" : "Петли слева → справа" },
        { id: "door-open-in", label: obj.doorOpenIn === false ? "Открывание наружу" : "Открывание внутрь" },
        { id: "door-num", label: "Номер двери…" },
      );
    }
    if (isOpeningKind(obj.kind)) {
      base.splice(6, 0,
        { id: "opening-shape", label: obj.openingShape === "arch" ? "Форма: прямоугольник" : "Форма: арка" },
        { id: "opening-num", label: "Номер проёма…" },
      );
    }
    if (isRackKind(obj.kind)) {
      const linkItems = RACK_LINK_ACTIONS.map((a) => ({ id: a.id, label: a.label }));
      base.splice(4, 0,
        ...linkItems,
        { sep: true, id: "s-rack-links" },
        { id: "rack-row", label: "Создать ряд…" },
        { id: "rack-grid", label: "Сетка стеллажей…" },
        { id: "rack-auto-num", label: "Пронумеровать все стеллажи" },
        { id: "rack-num", label: "Номер стеллажа…" },
        { id: "spec", label: "Добавить в спецификацию" },
      );
    }
    return base;
  }
  if (coll === "lines") {
    const canDelNode = opts.nodeIdx != null && obj.pts?.length > 2
      && opts.nodeIdx > 0 && opts.nodeIdx < obj.pts.length - 1;
    return [
      { id: "line-insert-node", label: "Добавить точку" },
      { id: "line-delete-node", label: "Удалить точку", disabled: !canDelNode },
      { sep: true, id: "s0" },
      { id: "line-ortho", label: obj.orthoRoute === false ? "Свободная трасса" : "Ортогональная (90°)" },
      { id: "line-reverse", label: "Инвертировать направление" },
      { id: "line-toggle-arrows", label: obj.showArrows === false ? "Показать стрелки" : "Скрыть стрелки" },
      { id: "line-attach", label: "Привязать концы к объектам" },
      { sep: true, id: "s1" },
      { id: "delete", label: "Удалить трассу", danger: true },
    ];
  }
  if (coll === "links") {
    return [
      { id: "link-toggle-visible", label: obj.visible === false ? "Показать связь" : "Скрыть связь" },
      { id: "link-ortho", label: obj.ortho !== false ? "Свободный маршрут" : "Ортогональный маршрут" },
      { sep: true, id: "s0" },
      { id: "delete", label: "Удалить связь", danger: true },
    ];
  }
  return [{ id: "delete", label: "Удалить", danger: true }];
}
