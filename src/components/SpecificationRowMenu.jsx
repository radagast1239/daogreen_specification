import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function SpecificationRowMenu({
  item,
  material = null,
  sectionOptions = [],
  onDetails,
  onRefresh,
  onResetName,
  onDuplicate,
  onMove,
  onDelete,
}) {
  const triggerRef = useRef(null);
  const popupRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const close = () => { setOpen(false); setMoving(false); };
  const showResetName = !!item.materialId && (
    !!item.nameOverridden || (!!material && String(item.name || "") !== String(material.name || ""))
  );

  useEffect(() => {
    if (!open) return undefined;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ top: Math.min(rect.bottom + 4, window.innerHeight - 300), left: Math.max(12, Math.min(rect.right - 220, window.innerWidth - 232)) });
    document.dispatchEvent(new CustomEvent("spec-row-menu-open", { detail: item.id }));
    const closeOther = (event) => event.detail !== item.id && close();
    const outside = (event) => !triggerRef.current?.contains(event.target) && !popupRef.current?.contains(event.target) && close();
    const escape = (event) => event.key === "Escape" && close();
    document.addEventListener("spec-row-menu-open", closeOther);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("spec-row-menu-open", closeOther); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, item.id]);

  const run = (callback) => { callback?.(); close(); };
  return <>
    <button ref={triggerRef} type="button" className="btn btn-sm btn-ghost spec-row-menu__trigger" aria-label={`Действия: ${item.name}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>⋯</button>
    {open && createPortal(
      <div ref={popupRef} className="spec-row-menu__list card" role="menu" data-project-item-id={item.id} style={position} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="btn btn-sm btn-ghost" role="menuitem" onClick={() => run(onDetails)}>Подробнее</button>
        <button type="button" className="btn btn-sm btn-ghost" role="menuitem" disabled={!item.materialId} onClick={() => run(onRefresh)}>Обновить из базы</button>
        {showResetName && <button type="button" className="btn btn-sm btn-ghost" role="menuitem" onClick={() => run(onResetName)}>Вернуть название из базы</button>}
        <button type="button" className="btn btn-sm btn-ghost" role="menuitem" onClick={() => run(onDuplicate)}>Дублировать</button>
        <button type="button" className="btn btn-sm btn-ghost" role="menuitem" onClick={() => setMoving((value) => !value)}>Переместить</button>
        {moving && <select autoFocus aria-label="Раздел для перемещения строки" value={item.module || ""} onChange={(event) => event.target.value !== item.module && run(() => onMove?.(event.target.value))}>
          {sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}
        </select>}
        <button type="button" className="btn btn-sm btn-ghost spec-row-menu__delete" role="menuitem" onClick={() => run(onDelete)}>Удалить</button>
      </div>, document.body
    )}
  </>;
}
