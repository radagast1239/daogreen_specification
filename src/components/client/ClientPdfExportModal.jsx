import React, { useMemo, useState } from "react";
import { Modal } from "../ui.jsx";
import {
  CLIENT_PDF_EXPORT_OPTIONS,
  DEFAULT_CLIENT_PDF_OPTION,
  getClientPdfExportStats,
  pdfExportOptionStats,
} from "../../lib/clientPdfExportMeta.js";

export default function ClientPdfExportModal({ open, items, onClose, onExport }) {
  const [selected, setSelected] = useState(DEFAULT_CLIENT_PDF_OPTION);
  const [exporting, setExporting] = useState(false);

  const stats = useMemo(() => getClientPdfExportStats(items), [items]);

  if (!open) return null;

  const selectedOption = CLIENT_PDF_EXPORT_OPTIONS.find((o) => o.id === selected);

  const download = async () => {
    setExporting(true);
    try {
      await onExport(selected);
      onClose();
    } finally {
      setExporting(false);
    }
  };

  const renderOption = (opt) => {
    const statLine = pdfExportOptionStats(opt.id, stats);
    const disabled =
      (opt.id === "plumber" && !stats.plumberMerged) ||
      (opt.id === "electric" && !stats.electricMerged) ||
      (opt.id === "installer" && !stats.installerMerged) ||
      (opt.id === "climate" && !stats.climateMerged) ||
      (opt.id === "client_role" && !stats.clientMerged);
    const active = selected === opt.id;

    return (
      <label
        key={opt.id}
        className={
          "client-pdf-export-option card" +
          (active ? " client-pdf-export-option--active" : "") +
          (disabled ? " client-pdf-export-option--disabled" : "")
        }
      >
        <input
          type="radio"
          name="pdf-export-mode"
          value={opt.id}
          checked={active}
          disabled={disabled}
          onChange={() => setSelected(opt.id)}
        />
        <div className="client-pdf-export-option__body">
          <div className="client-pdf-export-option__head">
            <strong>{opt.label}</strong>
            {opt.recommended && <span className="chip chip--ok">Рекомендуем</span>}
            {opt.largeFile && stats.fullPdfTableRows > stats.mergedCount * 1.5 && (
              <span className="chip chip--amber">Много страниц</span>
            )}
          </div>
          <div className="client-pdf-export-option__stat">{statLine}</div>
          <p className="client-pdf-export-option__summary">{opt.summary}</p>
          {active && (
            <div className="client-pdf-export-option__detail">
              <p>{opt.detail}</p>
              <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
                {opt.useWhen}
              </p>
            </div>
          )}
        </div>
      </label>
    );
  };

  return (
    <Modal
      title="Скачать PDF"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={exporting}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={download} disabled={exporting}>
            {exporting ? "Собираем…" : "Скачать PDF"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        В закупке <strong>{stats.mergedCount}</strong> уникальных позиций
        {stats.savedByMerge > 0 && (
          <> (одинаковые с разных стеллажей уже объединены)</>
        )}
        . Выберите вариант PDF.
      </p>

      <div className="client-pdf-export-options">
        {CLIENT_PDF_EXPORT_OPTIONS.filter((o) => o.group !== "specialist").map(renderOption)}
        <div className="client-pdf-export-group-title" style={{ fontSize: 13, fontWeight: 600, margin: "10px 0 4px" }}>
          Отдельные списки
        </div>
        {CLIENT_PDF_EXPORT_OPTIONS.filter((o) => o.group === "specialist").map(renderOption)}
      </div>

      {selectedOption?.id === "client_full" && stats.savedByMerge > 0 && (
        <p className="client-pdf-export-note">
          Позиции не дублируются в закупке: кран с 5 стеллажей = 1 строка в списке, но в полном PDF
          он может встретиться в общем списке, в разделе «Полив» и у сантехника — это один и тот же
          товар.
        </p>
      )}
    </Modal>
  );
}
