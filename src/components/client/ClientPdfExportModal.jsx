import React, { useMemo, useState } from "react";
import { Modal } from "../ui.jsx";
import {
  CLIENT_PDF_EXPORT_OPTIONS,
  DEFAULT_CLIENT_PDF_OPTION,
  getClientPdfExportStats,
  pdfExportOptionStats,
} from "../../lib/clientPdfExportMeta.js";
import { t } from "../../../shared/clientI18n.js";

export default function ClientPdfExportModal({ open, items, onClose, onExport, language = "ru" }) {
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
    } catch (e) {
      console.error(e);
      window.alert(e?.message || "Не удалось собрать PDF");
    } finally {
      setExporting(false);
    }
  };

  const renderOption = (opt) => {
    const statLine = pdfExportOptionStats(opt.id, stats, language);
    const optionKey = opt.id === "client_short" ? "clientShort"
      : opt.id === "client_full" ? "clientFull"
        : opt.id === "client_purchase" ? "clientPurchase"
          : opt.id === "client_role" ? "clientRole" : opt.id;
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
            <strong>{t(language, `client.pdfExport.options.${optionKey}.label`)}</strong>
            {opt.recommended && <span className="chip chip--ok">{t(language, "client.pdfExport.recommended")}</span>}
            {opt.largeFile && stats.fullPdfTableRows > stats.mergedCount * 1.5 && (
              <span className="chip chip--amber">{t(language, "client.pdfExport.manyPages")}</span>
            )}
          </div>
          <div className="client-pdf-export-option__stat">{statLine}</div>
          <p className="client-pdf-export-option__summary">{t(language, `client.pdfExport.options.${optionKey}.summary`)}</p>
          {active && (
            <div className="client-pdf-export-option__detail">
              <p>{t(language, `client.pdfExport.options.${optionKey}.description`)}</p>
              <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
                {t(language, `client.pdfExport.options.${optionKey}.useWhen`)}
              </p>
            </div>
          )}
        </div>
      </label>
    );
  };

  return (
    <Modal
      title={t(language, "client.pdfExport.modalTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={exporting}>
            {t(language, "client.common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" onClick={download} disabled={exporting}>
            {t(language, exporting ? "client.pdfExport.generating" : "client.pdfExport.downloadButton")}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        {t(language, stats.savedByMerge > 0 ? "client.pdfExport.introMerged" : "client.pdfExport.intro", { n: stats.mergedCount })}
      </p>

      <div className="client-pdf-export-options">
        {CLIENT_PDF_EXPORT_OPTIONS.filter((o) => o.group !== "specialist").map(renderOption)}
        <div className="client-pdf-export-group-title" style={{ fontSize: 13, fontWeight: 600, margin: "10px 0 4px" }}>
          {t(language, "client.pdfExport.specialistGroupTitle")}
        </div>
        {CLIENT_PDF_EXPORT_OPTIONS.filter((o) => o.group === "specialist").map(renderOption)}
      </div>

      {selectedOption?.id === "client_full" && stats.savedByMerge > 0 && (
        <p className="client-pdf-export-note">
          {t(language, "client.pdfExport.fullNote")}
        </p>
      )}
    </Modal>
  );
}
