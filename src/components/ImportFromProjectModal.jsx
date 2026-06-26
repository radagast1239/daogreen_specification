import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { IMPORT_KIND_LABELS } from "../../shared/importFromProject.js";

const QUICK_ACTIONS = [
  ["section", "Раздел из прошлого"],
  ["pump_room", "Насосная"],
  ["climate", "Климат"],
  ["electrical", "Электрика"],
];

function PreviewBlock({ title, items, tone = "neutral" }) {
  if (!items?.length) return null;
  return (
    <div className="import-preview-block">
      <div className="import-preview-block__title">
        <span className={`chip chip--${tone}`}>{title}</span> <span className="muted">({items.length})</span>
      </div>
      <ul className="import-preview-block__list">
        {items.slice(0, 12).map((row, i) => (
          <li key={row.itemId || row.mergeKey || i}>
            <strong>{row.name || row.items?.[0]?.name}</strong>
            {row.module && <span className="muted"> · {row.module}</span>}
            {row.qty != null && <span className="num"> · {row.qty}</span>}
          </li>
        ))}
        {items.length > 12 && <li className="muted">…ещё {items.length - 12}</li>}
      </ul>
    </div>
  );
}

export default function ImportFromProjectModal({
  targetProjectId,
  projects,
  onClose,
  onImported,
  initialKind = "section",
  initialModule = "",
  initialItemIds = [],
}) {
  const [sourceProject, setSourceProject] = useState(null);
  const others = useMemo(
    () => (projects || []).filter((p) => p.id !== targetProjectId),
    [projects, targetProjectId]
  );
  const [sourceId, setSourceId] = useState(others[0]?.id || "");
  const [kind, setKind] = useState(initialItemIds.length ? "selected" : initialKind);
  const [module, setModule] = useState(initialModule);
  const [targetModule, setTargetModule] = useState(initialModule);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const sourceListProject = others.find((p) => p.id === sourceId);

  useEffect(() => {
    if (!sourceId) {
      setSourceProject(null);
      return;
    }
    api.getProject(sourceId).then(setSourceProject).catch(() => setSourceProject(null));
  }, [sourceId]);

  const moduleOptions = useMemo(() => {
    if (!sourceProject?.items) return [];
    return [...new Set(sourceProject.items.map((it) => it.module).filter(Boolean))];
  }, [sourceProject]);

  useEffect(() => {
    if (kind === "section" && moduleOptions.length && !module) setModule(moduleOptions[0]);
  }, [kind, moduleOptions, module]);

  const loadPreview = async () => {
    if (!sourceId) return;
    setLoading(true);
    try {
      const data = await api.importPreview(targetProjectId, {
        sourceProjectId: sourceId,
        kind,
        module: kind === "section" ? module : "",
        itemIds: kind === "selected" ? initialItemIds : [],
        targetModule: targetModule || module,
      });
      setPreview(data);
    } catch {
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sourceId) loadPreview();
  }, [sourceId, kind, module, targetModule]);

  const apply = async () => {
    setApplying(true);
    try {
      const res = await api.importFromProject(targetProjectId, {
        sourceProjectId: sourceId,
        kind,
        module: kind === "section" ? module : "",
        itemIds: kind === "selected" ? initialItemIds : [],
        targetModule: targetModule || module,
        skipExisting: true,
      });
      onImported?.(res);
      onClose();
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Добавить из прошлого проекта</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="field">
          <label>Проект-источник</label>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.client || "—"}</option>
            ))}
          </select>
        </div>

        {kind !== "selected" && (
          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            {QUICK_ACTIONS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn btn-sm${kind === id ? " btn-primary" : ""}`}
                onClick={() => setKind(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {kind === "section" && (
          <div className="field">
            <label>Раздел (модуль) источника</label>
            <select value={module} onChange={(e) => setModule(e.target.value)}>
              {moduleOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label>Куда вставить (модуль в текущем проекте)</label>
          <input
            value={targetModule}
            onChange={(e) => setTargetModule(e.target.value)}
            placeholder={module || "тот же раздел"}
          />
        </div>

        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>Предпросмотр…</p>
        ) : preview ? (
          <div className="import-preview">
            <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
              {IMPORT_KIND_LABELS[preview.kind] || preview.kind}: будет добавлено{" "}
              <b className="num">{preview.counts?.added ?? 0}</b> из {preview.counts?.toImport ?? 0}
            </p>
            <PreviewBlock title="Будет добавлено" items={preview.added} tone="green" />
            <PreviewBlock title="Уже есть" items={preview.alreadyExists} tone="neutral" />
            <PreviewBlock title="Возможные дубли" items={preview.possibleDuplicates} tone="amber" />
            <PreviewBlock title="Склеится в закупке" items={preview.willMergeInPurchase} tone="amber" />
          </div>
        ) : null}

        <div className="row wrap" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!preview?.counts?.added || applying}
            onClick={apply}
          >
            {applying ? "Добавление…" : `Добавить ${preview?.counts?.added || 0} поз.`}
          </button>
        </div>
      </div>
    </div>
  );
}
