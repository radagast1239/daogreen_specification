import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

function DiffList({ title, items, empty }) {
  if (!items?.length) {
    return empty ? <p className="muted" style={{ fontSize: 12 }}>{empty}</p> : null;
  }
  return (
    <div className="compare-block">
      <div className="compare-block__title">{title} <span className="muted">({items.length})</span></div>
      <ul className="compare-block__list">
        {items.slice(0, 25).map((it) => (
          <li key={it.id || it.matchKey}>
            <strong>{it.name}</strong>
            {it.module && <span className="muted"> · {it.module}</span>}
            {it.diffs?.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12 }}>
                {it.diffs.map((d) => (
                  <li key={d.field}>
                    {d.label}: <span className="muted">{String(d.before ?? "—")}</span>
                    {" → "}
                    <b>{String(d.after ?? "—")}</b>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {items.length > 25 && <li className="muted">…ещё {items.length - 25}</li>}
      </ul>
    </div>
  );
}

export default function CompareProjectsModal({ projectId, projects, onClose }) {
  const others = useMemo(() => (projects || []).filter((p) => p.id !== projectId), [projects, projectId]);
  const [otherId, setOtherId] = useState(others[0]?.id || "");
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!otherId) return;
    setLoading(true);
    api
      .compareProjects(projectId, otherId)
      .then(setDiff)
      .catch(() => setDiff(null))
      .finally(() => setLoading(false));
  }, [projectId, otherId]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Сравнить с прошлым проектом</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="field">
          <label>С чем сравнить</label>
          <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.client || "—"}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>Сравнение…</p>
        ) : diff ? (
          <>
            <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Текущий: <b>{diff.base?.name}</b> vs прошлый: <b>{diff.other?.name}</b>
              {" · "}сопоставление по materialId и purchaseKey
            </p>
            <DiffList title="Добавлено" items={diff.added} />
            <DiffList title="Убрано" items={diff.removed} />
            <DiffList title="Изменилось" items={diff.changed} empty="Изменений нет" />
          </>
        ) : (
          <p className="muted">Не удалось сравнить</p>
        )}

        <div className="row wrap" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
