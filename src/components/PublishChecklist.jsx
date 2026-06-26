import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { ISSUE_LABELS } from "../lib/publishRulesConfig.js";
import { READINESS_ISSUE_LABELS } from "../../shared/projectReadiness.js";

const ALL_LABELS = { ...ISSUE_LABELS, ...READINESS_ISSUE_LABELS };

function groupProblems(problems) {
  const map = new Map();
  for (const p of problems || []) {
    const key = p.issue;
    if (!map.has(key)) {
      map.set(key, {
        issue: key,
        label: ALL_LABELS[key] || p.label || key,
        severity: p.severity || "critical",
        items: [],
      });
    }
    map.get(key).items.push(p);
  }
  return [...map.values()];
}

function ProblemGroups({ groups, compact, projectId, severity, onGotoItem }) {
  const filtered = groups.filter((g) => g.severity === severity);
  if (!filtered.length) return null;
  const isWarning = severity === "warning";

  return (
    <div className="publish-checklist__groups">
      <div className="publish-checklist__section-title" style={{ fontSize: 12, fontWeight: 700, marginTop: 10 }}>
        {isWarning ? "Предупреждения" : "Критические ошибки"}
      </div>
      {filtered.map((g) => (
        <div key={g.issue} className="publish-checklist__group">
          <div className="publish-checklist__group-title">
            <span className={isWarning ? "publish-checklist__warn" : "publish-checklist__bad"}>
              {isWarning ? "!" : "✕"}
            </span>{" "}
            {g.label} <span className="muted">({g.items.length})</span>
          </div>
          <ul className="publish-checklist__items">
            {g.items.slice(0, compact ? 5 : 20).map((p, i) => (
              <li key={p.itemId || `g-${i}`}>
                {p.itemId && projectId ? (
                  <Link
                    to={`/project/${projectId}?item=${encodeURIComponent(p.itemId)}#spec-item-${p.itemId}`}
                    className="publish-checklist__link"
                    onClick={() => onGotoItem?.(p.itemId)}
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
  );
}

export default function PublishChecklist({
  check,
  loading,
  onRefresh,
  compact = false,
  projectId,
  showWarnings = true,
  onGotoItem,
}) {
  const groups = useMemo(() => groupProblems(check?.problems), [check?.problems]);

  if (loading && !check) {
    return <p className="muted" style={{ fontSize: 13 }}>Проверка готовности…</p>;
  }

  if (!check) return null;

  const { ok, status, counts, allowForcePublish } = check;
  const statusLabel =
    check.statusLabel ||
    (status === "ok"
      ? "Можно публиковать"
      : status === "warnings"
        ? "Можно публиковать с предупреждениями"
        : "Нельзя публиковать");

  return (
    <div className={`publish-checklist${compact ? " publish-checklist--compact" : ""}`}>
      <div className="publish-checklist__head between wrap" style={{ gap: 10 }}>
        <div>
          <strong style={{ fontSize: compact ? 14 : 15 }}>
            {ok ? "✓ " : status === "warnings" ? "⚠ " : "✕ "}
            {statusLabel}
          </strong>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Для клиента: <span className="num">{counts?.clientItems ?? 0}</span> поз. · проверено{" "}
            <span className="num">{counts?.checkedItems ?? 0}</span>
            {!ok && (
              <>
                {" "}
                · критичных: <span className="num">{counts?.criticalCount ?? 0}</span>
                {showWarnings && (
                  <>
                    {" "}
                    · предупреждений: <span className="num">{counts?.warningCount ?? 0}</span>
                  </>
                )}
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
        <>
          <ProblemGroups
            groups={groups}
            compact={compact}
            projectId={projectId}
            severity="critical"
            onGotoItem={onGotoItem}
          />
          {showWarnings && (
            <ProblemGroups
              groups={groups}
              compact={compact}
              projectId={projectId}
              severity="warning"
              onGotoItem={onGotoItem}
            />
          )}
        </>
      )}

      {status === "warnings" && groups.some((g) => g.severity === "warning") && (
        <ProblemGroups
          groups={groups}
          compact={compact}
          projectId={projectId}
          severity="warning"
          onGotoItem={onGotoItem}
        />
      )}

      {ok && !compact && (
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Можно отправить ссылку клиенту или утвердить версию.
        </p>
      )}

      {status === "blocked" && !allowForcePublish && (
        <p style={{ fontSize: 12, color: "var(--danger)", margin: "10px 0 0" }}>
          Исправьте критические ошибки — принудительная отправка отключена в настройках.
        </p>
      )}
    </div>
  );
}

/** Модалка: чеклист + действие */
export function PublishGateModal({
  title,
  check,
  onClose,
  onProceed,
  proceedLabel = "Всё равно отправить",
  projectId,
}) {
  const canForce = check?.allowForcePublish !== false;
  const canProceed = check?.status !== "blocked" || canForce;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <PublishChecklist check={check} projectId={projectId} onGotoItem={() => onClose()} />
        <div className="row wrap" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
          {canProceed && (
            <button type="button" className="btn btn-primary" onClick={onProceed}>
              {proceedLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
