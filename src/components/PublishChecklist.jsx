import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { ISSUE_LABELS } from "../lib/publishRulesConfig.js";

function groupProblems(problems) {
  const map = new Map();
  for (const p of problems || []) {
    const key = p.issue;
    if (!map.has(key)) map.set(key, { issue: key, label: ISSUE_LABELS[key] || p.label || key, items: [] });
    map.get(key).items.push(p);
  }
  return [...map.values()];
}

export default function PublishChecklist({ check, loading, onRefresh, compact = false, projectId }) {
  const groups = useMemo(() => groupProblems(check?.problems), [check?.problems]);

  if (loading && !check) {
    return <p className="muted" style={{ fontSize: 13 }}>Проверка готовности…</p>;
  }

  if (!check) return null;

  const { ok, counts, allowForcePublish } = check;

  return (
    <div className={`publish-checklist${compact ? " publish-checklist--compact" : ""}`}>
      <div className="publish-checklist__head between wrap" style={{ gap: 10 }}>
        <div>
          <strong style={{ fontSize: compact ? 14 : 15 }}>
            {ok ? "✓ Готово к отправке клиенту" : "⚠ Не всё готово для клиента"}
          </strong>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Для клиента: <span className="num">{counts?.clientItems ?? 0}</span> поз. · проверено{" "}
            <span className="num">{counts?.checkedItems ?? 0}</span>
            {!ok && (
              <>
                {" "}
                · проблем: <span className="num">{counts?.issueCount ?? 0}</span>
              </>
            )}
          </p>
        </div>
        {onRefresh && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRefresh}>
            ↻ Обновить
          </button>
        )}
      </div>

      {!ok && groups.length > 0 && (
        <div className="publish-checklist__groups">
          {groups.map((g) => (
            <div key={g.issue} className="publish-checklist__group">
              <div className="publish-checklist__group-title">
                <span className="publish-checklist__bad">✕</span> {g.label}{" "}
                <span className="muted">({g.items.length})</span>
              </div>
              <ul className="publish-checklist__items">
                {g.items.slice(0, compact ? 5 : 20).map((p, i) => (
                  <li key={p.itemId || `g-${i}`}>
                    {p.itemId && projectId ? (
                      <Link
                        to={`/project/${projectId}?item=${encodeURIComponent(p.itemId)}#spec-item-${p.itemId}`}
                        className="publish-checklist__link"
                      >
                        <strong>{p.name || "—"}</strong>
                        {p.module && <span className="muted"> · {p.module}</span>}
                        <span className="publish-checklist__goto"> → в таблице</span>
                      </Link>
                    ) : p.itemId ? (
                      <>
                        <strong>{p.name || "—"}</strong>
                        {p.module && <span className="muted"> · {p.module}</span>}
                      </>
                    ) : (
                      <span>{p.label}</span>
                    )}
                  </li>
                ))}
                {g.items.length > (compact ? 5 : 20) && (
                  <li className="muted">…ещё {g.items.length - (compact ? 5 : 20)}</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {ok && !compact && (
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Можно отправить ссылку клиенту или утвердить версию.
        </p>
      )}

      {!ok && !allowForcePublish && (
        <p style={{ fontSize: 12, color: "var(--danger)", margin: "10px 0 0" }}>
          Исправьте позиции в спецификации — принудительная отправка отключена в настройках.
        </p>
      )}
    </div>
  );
}

/** Модалка: чеклист + действие */
export function PublishGateModal({ title, check, onClose, onProceed, proceedLabel = "Всё равно отправить", projectId }) {
  const canForce = check?.allowForcePublish !== false;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <PublishChecklist check={check} projectId={projectId} />
        <div className="row wrap" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
          {canForce && (
            <button type="button" className="btn btn-primary" onClick={onProceed}>
              {proceedLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
