import React, { useState, useRef } from "react";
import { SPEC_LINE_FILTERS } from "../../shared/specLineFilters.js";
import { PURCHASE_STATUSES } from "../data/modules.js";
import { RESPONSIBLE_OPTIONS } from "../lib/itemHelpers.js";
import { PURCHASE_PRIORITIES } from "../../shared/purchasePriority.js";
import { Modal } from "./ui.jsx";

const FILTER_LABELS = Object.fromEntries(SPEC_LINE_FILTERS.map((f) => [f.id, f.label]));
const PROBLEM_FILTER_IDS = ["needs_review", "no_price", "no_link", "no_photo", "no_supplier", "no_responsible"];
const STATUS_FILTER_IDS = ["included", "excluded"];

/** Фильтры и массовые действия для раздела (проект или сборщик). */
export default function SpecSectionToolbar({
  mode = "builder",
  filterId,
  onFilterChange,
  selectedCount = 0,
  visibleCount = 0,
  onSelectAll,
  onClearSelection,
  onBulkPatch,
  sectionOptions = [],
  suppliers = [],
  purchaseStatuses = PURCHASE_STATUSES,
  responsibleOptions = RESPONSIBLE_OPTIONS,
  onRefreshClientSections,
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [targetSection, setTargetSection] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierVal, setSupplierVal] = useState("");
  const [respOpen, setRespOpen] = useState(false);
  const [respVal, setRespVal] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusVal, setStatusVal] = useState("not_bought");
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityVal, setPriorityVal] = useState("urgent");
  const menuRef = useRef(null);
  const problemsRef = useRef(null);
  const statusRef = useRef(null);

  const disabled = selectedCount === 0;

  const closeMenu = () => {
    if (menuRef.current) menuRef.current.open = false;
  };

  const pickFilter = (id, ref) => {
    onFilterChange(id);
    if (ref?.current) ref.current.open = false;
  };

  const apply = (patch) => {
    onBulkPatch?.(patch);
    setMoveOpen(false);
    setCopyOpen(false);
    setSupplierOpen(false);
    setRespOpen(false);
    setStatusOpen(false);
    setPriorityOpen(false);
    closeMenu();
  };

  const openModal = (setter) => {
    setter(true);
    closeMenu();
  };

  const problemActive = filterId === "problems" || PROBLEM_FILTER_IDS.includes(filterId);
  const statusValue = STATUS_FILTER_IDS.includes(filterId) ? filterId : "";

  return (
    <div className="spec-section-toolbar no-print">
      <div className="spec-quick-filters" style={{ marginBottom: 0 }}>
        <span className="muted" style={{ fontSize: 12 }}>Фильтр:</span>
        <button
          type="button"
          className={`btn btn-sm${filterId === "" ? " btn-primary" : ""}`}
          onClick={() => onFilterChange("")}
        >
          Все
        </button>
        <details className="spec-filter-menu" ref={problemsRef}>
          <summary className={`btn btn-sm${problemActive ? " btn-primary" : ""}`}>Проблемы ▾</summary>
          <div className="spec-filter-menu__list">
            <button type="button" className={`btn btn-sm${filterId === "problems" ? " btn-primary" : ""}`} onClick={() => pickFilter("problems", problemsRef)}>
              Все проблемы
            </button>
            {PROBLEM_FILTER_IDS.map((id) => (
              <button key={id} type="button" className={`btn btn-sm${filterId === id ? " btn-primary" : ""}`} onClick={() => pickFilter(id, problemsRef)}>
                {FILTER_LABELS[id]}
              </button>
            ))}
          </div>
        </details>
        <button
          type="button"
          className={`btn btn-sm${filterId === "client_visible" ? " btn-primary" : ""}`}
          onClick={() => onFilterChange("client_visible")}
        >
          Клиенту
        </button>
        <button
          type="button"
          className={`btn btn-sm${filterId === "client_hidden" ? " btn-primary" : ""}`}
          onClick={() => onFilterChange("client_hidden")}
        >
          Скрытые
        </button>
        <details className="spec-filter-menu" ref={statusRef}>
          <summary className={`btn btn-sm${statusValue ? " btn-primary" : ""}`}>Статус ▾</summary>
          <div className="spec-filter-menu__list">
            <button type="button" className={`btn btn-sm${filterId === "" ? " btn-primary" : ""}`} onClick={() => pickFilter("", statusRef)}>
              Все
            </button>
            {STATUS_FILTER_IDS.map((id) => (
              <button key={id} type="button" className={`btn btn-sm${filterId === id ? " btn-primary" : ""}`} onClick={() => pickFilter(id, statusRef)}>
                {FILTER_LABELS[id]}
              </button>
            ))}
          </div>
        </details>
      </div>

      {(onSelectAll || selectedCount > 0) && (
        <div className="spec-bulk-bar">
          {onSelectAll && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={!visibleCount}
              onClick={onSelectAll}
            >
              Выбрать все{visibleCount ? ` (${visibleCount})` : ""}
            </button>
          )}
          {selectedCount > 0 && (
            <>
          <span className="muted" style={{ fontSize: 12 }}>
            Выбрано: <strong className="num">{selectedCount}</strong>
          </span>
          <details className="spec-bulk-menu" ref={menuRef}>
            <summary className="btn btn-sm btn-primary">Действия с выбранными ▾</summary>
            <div className="spec-bulk-menu__list">
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ includedInProject: true, included: true, enabled: true })}>
                Включить в проект
              </button>
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ includedInProject: false, included: false, enabled: false })}>
                Исключить из проекта
              </button>
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ visibleToClient: true, visible: true, approved: true })}>
                Показать клиенту
              </button>
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ visibleToClient: false, visible: false, approved: false })}>
                Скрыть от клиента
              </button>
              {onRefreshClientSections && (
                <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => { onRefreshClientSections(); closeMenu(); }}>
                  Разделы из базы
                </button>
              )}
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => openModal(setSupplierOpen)}>
                Назначить поставщика…
              </button>
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => openModal(setRespOpen)}>
                Назначить ответственного…
              </button>
              {mode === "project" && (
                <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => openModal(setStatusOpen)}>
                  Статус…
                </button>
              )}
              {mode === "project" && (
                <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => openModal(setPriorityOpen)}>
                  Приоритет…
                </button>
              )}
              {mode === "project" && sectionOptions.length > 1 && (
                <>
                  <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => openModal(setMoveOpen)}>
                    Перенести…
                  </button>
                  <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => openModal(setCopyOpen)}>
                    Копировать…
                  </button>
                </>
              )}
            </div>
          </details>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearSelection}>
            Снять выбор
          </button>
            </>
          )}
        </div>
      )}

      {supplierOpen && (
        <Modal
          title="Назначить поставщика"
          onClose={() => setSupplierOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setSupplierOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={() => apply({ supplier: supplierVal })}>Применить</button>
            </>
          }
        >
          <select value={supplierVal} onChange={(e) => setSupplierVal(e.target.value)} style={{ width: "100%" }}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id || s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Меняется только в проекте, база материалов не затрагивается.
          </p>
        </Modal>
      )}

      {respOpen && (
        <Modal
          title="Назначить ответственного"
          onClose={() => setRespOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRespOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={() => apply({ responsible: respVal })}>Применить</button>
            </>
          }
        >
          <select value={respVal} onChange={(e) => setRespVal(e.target.value)} style={{ width: "100%" }}>
            {responsibleOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </Modal>
      )}

      {statusOpen && (
        <Modal
          title="Назначить статус закупки"
          onClose={() => setStatusOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setStatusOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={() => apply({ status: statusVal })}>Применить</button>
            </>
          }
        >
          <select value={statusVal} onChange={(e) => setStatusVal(e.target.value)} style={{ width: "100%" }}>
            {purchaseStatuses.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Modal>
      )}

      {priorityOpen && (
        <Modal
          title="Приоритет закупки"
          onClose={() => setPriorityOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPriorityOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={() => apply({ purchasePriority: priorityVal })}>Применить</button>
            </>
          }
        >
          <select value={priorityVal} onChange={(e) => setPriorityVal(e.target.value)} style={{ width: "100%" }}>
            {PURCHASE_PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Modal>
      )}

      {moveOpen && (
        <Modal
          title="Перенести в раздел"
          onClose={() => setMoveOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setMoveOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" disabled={!targetSection} onClick={() => apply({ module: targetSection, section: targetSection })}>Перенести</button>
            </>
          }
        >
          <select value={targetSection} onChange={(e) => setTargetSection(e.target.value)} style={{ width: "100%" }}>
            <option value="">— раздел —</option>
            {sectionOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </Modal>
      )}

      {copyOpen && (
        <Modal
          title="Копировать в раздел"
          onClose={() => setCopyOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCopyOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" disabled={!targetSection} onClick={() => apply({ __copyToSection: targetSection })}>Копировать</button>
            </>
          }
        >
          <select value={targetSection} onChange={(e) => setTargetSection(e.target.value)} style={{ width: "100%" }}>
            <option value="">— раздел —</option>
            {sectionOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </Modal>
      )}
    </div>
  );
}
