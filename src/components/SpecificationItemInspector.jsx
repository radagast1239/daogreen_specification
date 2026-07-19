import React, { useEffect, useRef, useState } from "react";
import { lineGross, VAT_RATES } from "../lib/itemHelpers.js";
import { money } from "../store/helpers.js";
import { PROJECT_LINE_TYPES, PROJECT_LINE_TYPE_LABELS, lineVisibleToClient } from "../../shared/itemTypes.js";
import { PURCHASE_STATUSES } from "../data/modules.js";
import { photoSrc } from "../lib/api.js";

export default function SpecificationItemInspector({ item, project, materials, rooms, lineGroups, sectionOptions, onPatch, onClose, onRefreshFromBase, onDuplicate, onMove, onDelete }) {
  const closeRef = useRef(null);
  const [moveTarget, setMoveTarget] = useState(item.module || "");
  useEffect(() => {
    setMoveTarget(item.module || "");
    closeRef.current?.focus();
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [item.id, onClose]);
  const material = materials.find((entry) => entry.id === item.materialId);
  const patch = (value) => onPatch(item.id, value);
  const visible = lineVisibleToClient(item, material);
  const showResetName = !!item.materialId && (
    !!item.nameOverridden || (!!material && String(item.name || "") !== String(material.name || ""))
  );
  const resetName = () => {
    if (!material || !window.confirm("Вернуть название из базы? Текущее название позиции будет заменено.")) return;
    patch({ name: material.name || "", nameOverridden: false });
  };
  return (
    <aside className="spec-inspector" aria-label={`Подробнее: ${item.name}`} data-item-id={item.id}>
      <header className="spec-inspector__header">
        <div><span className="muted">Позиция</span><strong>{item.name}</strong></div>
        <button ref={closeRef} type="button" className="btn btn-ghost" aria-label="Закрыть подробности" onClick={onClose}>✕</button>
      </header>
      <div className="spec-inspector__body">
        <section><h3>Основное</h3>
          {photoSrc(item.imageUrl || item.photoUrl) && <img className="spec-inspector__photo" src={photoSrc(item.imageUrl || item.photoUrl)} alt="" />}
          <label>Наименование<input value={item.name || ""} onChange={(e) => patch({ name: e.target.value, ...(item.materialId ? { nameOverridden: true } : {}) })} /></label>
          {showResetName && <><small className="spec-name-override">Изменено в проекте</small><button type="button" className="btn btn-sm btn-ghost" onClick={resetName}>Вернуть название из базы</button></>}
          <div className="spec-inspector__grid"><label>Единица<input value={item.unit || ""} onChange={(e) => patch({ unit: e.target.value })} /></label><label>Количество<input type="number" value={item.qty || 0} onChange={(e) => patch({ qty: Number(e.target.value) || 0 })} /></label></div>
          <div className="spec-inspector__grid"><label>Цена<input type="number" value={item.price || 0} onChange={(e) => patch({ price: Number(e.target.value) || 0 })} /></label><label>НДС<select value={item.vatRate || 0} onChange={(e) => patch({ vatRate: Number(e.target.value) })}>{VAT_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</select></label></div>
          <div className="spec-inspector__total">Сумма <strong>{money(lineGross(item), project.currency)}</strong></div>
        </section>
        <section><h3>Закупка</h3>
          <label title={item.materialId ? "Поставщик закреплён в базе материалов" : undefined}>Поставщик<input value={item.supplier || ""} readOnly={!!item.materialId} onChange={(e) => patch({ supplier: e.target.value })} />{item.materialId && <small>Поставщик закреплён в базе материалов</small>}</label>
          <label>Основная ссылка<input value={item.link || ""} onChange={(e) => patch({ link: e.target.value })} /></label>
          <label>Дополнительная ссылка<input value={item.linkAlt || ""} onChange={(e) => patch({ linkAlt: e.target.value })} /></label>
          <div className="spec-inspector__grid"><label>Статус<select value={item.status || "not_bought"} onChange={(e) => patch({ status: e.target.value, purchaseStatus: e.target.value })}>{PURCHASE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label><label>Дней<input type="number" min="0" value={item.deliveryDays || ""} onChange={(e) => patch({ deliveryDays: Number(e.target.value) || 0 })} /></label></div>
          <label>Комментарий клиенту<textarea rows="2" value={item.clientNote || ""} onChange={(e) => patch({ clientNote: e.target.value })} /></label>
          <label>Внутренний комментарий<textarea rows="2" value={item.internalNote || ""} onChange={(e) => patch({ internalNote: e.target.value })} /></label>
        </section>
        <section><h3>Классификация</h3>
          <label>Комната<select value={item.roomId || ""} onChange={(e) => patch({ roomId: e.target.value })}><option value="">—</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
          <label>Группа<select value={item.subcategory || ""} onChange={(e) => patch({ subcategory: e.target.value })}><option value="">—</option>{lineGroups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
          <label>Тип<select value={item.itemType || "material"} onChange={(e) => patch({ itemType: e.target.value })}>{PROJECT_LINE_TYPES.map((type) => <option key={type} value={type}>{PROJECT_LINE_TYPE_LABELS[type]}</option>)}</select></label>
        </section>
        <section><h3>Клиент</h3>
          <label className="spec-inspector__check"><input type="checkbox" checked={visible} disabled={item.includedInProject === false} onChange={(e) => patch({ visibleToClient: e.target.checked, visible: e.target.checked, approved: e.target.checked })} /> Показывать клиенту</label>
          <label className="spec-inspector__check"><input type="checkbox" checked={item.includedInProject !== false} onChange={(e) => patch({ includedInProject: e.target.checked, enabled: e.target.checked, ...(e.target.checked ? { visibleToClient: true, visible: true, approved: true } : {}) })} /> Включено в проект</label>
        </section>
        <section><h3>Источник</h3><p>{item.materialId ? "Материал из базы" : item.source === "planner" ? "Из схемы / BOM" : "Ручная позиция"}</p>{item.materialId && <button type="button" className="btn btn-sm" onClick={() => onRefreshFromBase(item.id)}>Обновить из базы</button>}</section>
        <section><h3>Действия</h3>
          <button type="button" className="btn btn-sm" onClick={() => onDuplicate(item)}>Дублировать</button>
          <div className="spec-inspector__grid"><select aria-label="Раздел для перемещения" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>{sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select><button type="button" className="btn btn-sm" disabled={!moveTarget || moveTarget === item.module} onClick={() => onMove(item, moveTarget)}>Переместить</button></div>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(item)}>Удалить позицию</button>
        </section>
      </div>
    </aside>
  );
}
