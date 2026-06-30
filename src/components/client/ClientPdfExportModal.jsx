import React, { useMemo, useState } from "react";
import { Modal } from "../ui.jsx";
import {
  CLIENT_PDF_EXPORT_OPTIONS,
  getClientPdfExportStats,
  pdfExportOptionStats,
} from "../../lib/clientPdfExportMeta.js";

export default function ClientPdfExportModal({ open, items, onClose, onExport }) {
  const [selected, setSelected] = useState("merged");
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
        В спецификации <strong>{stats.rawCount}</strong> строк
        {stats.savedByMerge > 0 && (
          <>
            {" "}
            → после склейки одинаковых позиций <strong>{stats.mergedCount}</strong> уникальных
          </>
        )}
        . Выберите, что положить в PDF.
      </p>

      <div className="client-pdf-export-options">
        {CLIENT_PDF_EXPORT_OPTIONS.map((opt) => {
          const statLine = pdfExportOptionStats(opt.id, stats);
          const disabled =
            (opt.id === "plumber" && !stats.plumberMerged) ||
            (opt.id === "electric" && !stats.electricMerged) ||
            (opt.id === "installer" && !stats.installerMerged);
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
        })}
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
