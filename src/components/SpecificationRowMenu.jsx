import React, { useRef, useState } from "react";

export default function SpecificationRowMenu({ item, sectionOptions = [], onDetails, onRefresh, onDuplicate, onMove, onDelete }) {
  const menuRef = useRef(null);
  const [moving, setMoving] = useState(false);
  const close = () => { if (menuRef.current) menuRef.current.open = false; setMoving(false); };
  const run = (callback) => { close(); callback?.(); };
  return <details className="spec-row-menu" ref={menuRef}>
    <summary className="btn btn-sm btn-ghost" aria-label={`Действия: ${item.name}`}>⋯</summary>
    <div className="spec-row-menu__list card" role="menu">
      <button type="button" className="btn btn-sm btn-ghost" role="menuitem" onClick={() => run(onDetails)}>Подробнее</button>
      <button type="button" className="btn btn-sm btn-ghost" role="menuitem" disabled={!item.materialId} onClick={() => run(onRefresh)}>Обновить из базы</button>
      <button type="button" className="btn btn-sm btn-ghost" role="menuitem" onClick={() => run(onDuplicate)}>Дублировать</button>
      <button type="button" className="btn btn-sm btn-ghost" role="menuitem" onClick={() => setMoving((value) => !value)}>Переместить</button>
      {moving && <select autoFocus aria-label="Раздел для перемещения строки" value={item.module || ""} onChange={(event) => event.target.value !== item.module && run(() => onMove?.(event.target.value))}>
        {sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}
      </select>}
      <button type="button" className="btn btn-sm btn-ghost spec-row-menu__delete" role="menuitem" onClick={() => run(onDelete)}>Удалить</button>
    </div>
  </details>;
}
