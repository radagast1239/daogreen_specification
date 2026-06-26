import React from "react";
import PublishChecklist from "./PublishChecklist.jsx";

const STATUS_META = {
  ok: { label: "Можно публиковать", className: "pre-publish--ok" },
  warnings: { label: "Можно публиковать с предупреждениями", className: "pre-publish--warn" },
  blocked: { label: "Нельзя публиковать", className: "pre-publish--blocked" },
};

export default function PrePublishCheckModal({ check, loading, projectId, onClose, onProceed, proceedLabel }) {
  const meta = STATUS_META[check?.status] || STATUS_META.blocked;
  const canProceed = check?.status === "ok" || check?.status === "warnings" || check?.allowForcePublish;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal pre-publish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Проверка перед публикацией</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="pre-publish-modal__body">
          {loading ? (
            <p className="muted" style={{ fontSize: 13 }}>Проверка…</p>
          ) : (
            <>
              <div className={`pre-publish-status ${meta.className}`}>
                <strong>{check?.statusLabel || meta.label}</strong>
                {check?.counts && (
                  <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                    критичных: <span className="num">{check.counts.criticalCount ?? 0}</span>
                    {" · "}
                    предупреждений: <span className="num">{check.counts.warningCount ?? 0}</span>
                  </span>
                )}
              </div>
              <PublishChecklist
                check={check}
                projectId={projectId}
                showWarnings
                onGotoItem={() => onClose()}
              />
            </>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
          {onProceed && canProceed && check?.status !== "blocked" && (
            <button type="button" className="btn btn-primary" onClick={onProceed}>
              {proceedLabel || "Продолжить публикацию"}
            </button>
          )}
          {onProceed && check?.status === "blocked" && check?.allowForcePublish && (
            <button type="button" className="btn btn-primary" onClick={onProceed}>
              Всё равно опубликовать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
