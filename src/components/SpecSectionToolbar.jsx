import React, { useState } from "react";
import { SPEC_LINE_FILTERS } from "../../shared/specLineFilters.js";
import { PURCHASE_STATUSES } from "../data/modules.js";
import { RESPONSIBLE_OPTIONS } from "../lib/itemHelpers.js";
import { PURCHASE_PRIORITIES } from "../../shared/purchasePriority.js";
import { Modal } from "./ui.jsx";

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

  const disabled = selectedCount === 0;

  const apply = (patch) => {
    onBulkPatch?.(patch);
    setMoveOpen(false);
    setCopyOpen(false);
    setSupplierOpen(false);
    setRespOpen(false);
    setStatusOpen(false);
    setPriorityOpen(false);
  };

  return (
    <div className="spec-section-toolbar no-print">
      <div className="spec-quick-filters" style={{ marginBottom: 0 }}>
        <span className="muted" style={{ fontSize: 12 }}>Фильтр:</span>
        {SPEC_LINE_FILTERS.map((f) => (
          <button
            key={f.id || "all"}
            type="button"
            className={`btn btn-sm${filterId === f.id ? " btn-primary" : ""}`}
            onClick={() => onFilterChange(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {(onSelectAll || selectedCount > 0) && (
        <div className="spec-bulk-bar">
          {onSelectAll && (
            <button
              type="button"
              className="btn btn-sm"
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
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ includedInProject: true, included: true, enabled: true })}>
            Включить
          </button>
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ includedInProject: false, included: false, enabled: false })}>
            Исключить
          </button>
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ visibleToClient: true, visible: true, approved: true })}>
            Показать клиенту
          </button>
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => apply({ visibleToClient: false, visible: false, approved: false })}>
            Скрыть от клиента
          </button>
          {onRefreshClientSections && (
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={onRefreshClientSections}>
              Разделы из базы
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setSupplierOpen(true)}>
            Поставщик…
          </button>
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setRespOpen(true)}>
            Ответственный…
          </button>
          {mode === "project" && (
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setStatusOpen(true)}>
              Статус…
            </button>
          )}
          {mode === "project" && (
            <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setPriorityOpen(true)}>
              Приоритет…
            </button>
          )}
          {mode === "project" && sectionOptions.length > 1 && (
            <>
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setMoveOpen(true)}>
                Перенести…
              </button>
              <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setCopyOpen(true)}>
                Копировать…
              </button>
            </>
          )}
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
