import React, { useEffect, useRef, useState } from "react";
import { t } from "../../shared/clientI18n.js";
import { api, photoSrc } from "../lib/api.js";
import FloorPlanViewer from "./FloorPlanViewer.jsx";
import {
  addProjectScheme,
  clientVisibleSchemes,
  filledSchemeSlots,
  listProjectSchemes,
  moveProjectScheme,
  removeProjectScheme,
  updateProjectScheme,
} from "../lib/clientSchemes.js";

function SchemeTitleInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const editingRef = useRef(false);
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    editingRef.current = false;
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) onCommit(next);
    setDraft(next);
  };

  return (
    <input
      className="spec-cell-input"
      value={draft}
      aria-label="Название схемы"
      onFocus={() => {
        editingRef.current = true;
        cancelCommitRef.current = false;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelCommitRef.current = true;
          event.currentTarget.blur();
        }
      }}
      style={{ width: "100%", fontWeight: 600, fontSize: 13 }}
    />
  );
}

/**
 * Unlimited project schemes: add / rename / reorder / upload / remove.
 * showClientVisibility — SpecEditor client toggle; false in project builder.
 */
export default function ClientSchemesEditor({
  manualParams,
  onChange,
  showClientVisibility = true,
  title = null,
  intro = null,
}) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const schemes = listProjectSchemes(mp);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(null);

  const filled = filledSchemeSlots(mp);
  const heading = title ?? (showClientVisibility ? null : "Схемы проекта");
  const description =
    intro ??
    (showClientVisibility
      ? "Добавляйте схемы без лимита. Галочка «Клиенту» управляет показом в клиентской ссылке."
      : "Добавляйте, переименовывайте и упорядочивайте схемы. Каждая сохраняется в проекте (manualParams.projectSchemes).");

  const upload = async (id, file) => {
    if (!file) return;
    setUploading(id);
    try {
      const { url } = await api.uploadPhoto(file);
      onChange(updateProjectScheme(mp, id, { url, mimeType: file.type || "image/*", createdAt: new Date().toISOString() }));
    } catch (e) {
      alert(e.message || "Не удалось загрузить");
    } finally {
      setUploading(null);
    }
  };

  const openScheme = (id) => {
    const idx = filled.findIndex((s) => s.id === id || s.key === id);
    if (idx < 0) return;
    setViewer({ schemes: filled, activeIndex: idx });
  };

  return (
    <div className="client-schemes-editor" style={{ marginBottom: 14 }}>
      {heading && (
        <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>{heading}</h4>
      )}
      <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
        {description}
      </p>
      <div className="client-schemes-grid">
        {schemes.map((scheme, index) => {
          const src = scheme.url ? photoSrc(scheme.url) : "";
          return (
            <div key={scheme.id} className="client-scheme-card card" style={{ padding: 12 }}>
              <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
                <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                  <SchemeTitleInput
                    value={scheme.title}
                    onCommit={(title) => onChange(updateProjectScheme(mp, scheme.id, { title }))}
                  />
                </div>
                {showClientVisibility && (
                  <label className="row" style={{ fontSize: 11, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={scheme.clientVisible !== false}
                      onChange={(e) =>
                        onChange(updateProjectScheme(mp, scheme.id, { clientVisible: e.target.checked }))
                      }
                    />
                    Показывать клиенту
                  </label>
                )}
              </div>
              {src ? (
                <button
                  type="button"
                  className="client-scheme-card__thumb"
                  onClick={() => openScheme(scheme.id)}
                  title="Открыть"
                >
                  <img src={src} alt={scheme.title} />
                </button>
              ) : (
                <div className="client-scheme-card__empty muted">Нет файла</div>
              )}
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                  {uploading === scheme.id ? "…" : scheme.url ? "Заменить" : "Загрузить"}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={!!uploading}
                    onChange={(e) => {
                      upload(scheme.id, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {scheme.url && (
                  <button type="button" className="btn btn-sm" onClick={() => openScheme(scheme.id)}>
                    Открыть
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={index === 0}
                  title="Выше"
                  onClick={() => onChange(moveProjectScheme(mp, scheme.id, "up"))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={index >= schemes.length - 1}
                  title="Ниже"
                  onClick={() => onChange(moveProjectScheme(mp, scheme.id, "down"))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(removeProjectScheme(mp, scheme.id))}
                >
                  Убрать
                </button>
              </div>
              {showClientVisibility && (
                <p className="muted" style={{ fontSize: 11, margin: "7px 0 0" }}>
                  {scheme.clientVisible ? "Будет показано клиенту после публикации" : "Только для меня"}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => onChange(addProjectScheme(mp))}
        >
          + Добавить схему
        </button>
      </div>
      {viewer && (
        <FloorPlanViewer
          schemes={viewer.schemes}
          activeIndex={viewer.activeIndex}
          onActiveIndexChange={(next) => {
            const i = typeof next === "function" ? next(viewer.activeIndex) : next;
            setViewer((v) => (v ? { ...v, activeIndex: i } : v));
          }}
          open
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

/** Просмотр схем на клиентской странице */
export function ClientSchemesViewer({ manualParams, images, language = "ru" }) {
  const schemes = (Array.isArray(images) ? images : clientVisibleSchemes(manualParams)).map((s) => ({
    ...s,
    label: s.title || s.label,
  }));
  const [viewer, setViewer] = useState(null);

  if (!schemes.length) return null;

  return (
    <div className="client-schemes-viewer card" style={{ padding: 16, marginBottom: 16 }}>
      <strong style={{ fontSize: 14 }}>{t(language, "client.schemes.viewer.title")}</strong>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 12px" }}>
        {t(language, "client.schemes.viewer.hint")}
      </p>
      <div className="client-schemes-viewer__grid">
        {schemes.map((def, i) => {
          const src = photoSrc(def.url);
          if (!src) return null;
          return (
            <button
              key={def.id || def.key}
              type="button"
              className="client-scheme-view-btn"
              onClick={() => setViewer({ schemes, activeIndex: i })}
            >
              <img src={src} alt="" />
              <span>{def.title || def.label}</span>
            </button>
          );
        })}
      </div>
      {viewer && (
        <FloorPlanViewer
          schemes={viewer.schemes}
          activeIndex={viewer.activeIndex}
          onActiveIndexChange={(next) => {
            const i = typeof next === "function" ? next(viewer.activeIndex) : next;
            setViewer((v) => (v ? { ...v, activeIndex: i } : v));
          }}
          open
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

export function ClientRackImagesViewer({ images = [] }) {
  const [viewer, setViewer] = useState(null);
  const groups = images.reduce((map, image) => {
    if (!map.has(image.rackId)) map.set(image.rackId, { title: image.rackTitle || "Стеллаж", images: [] });
    map.get(image.rackId).images.push(image);
    return map;
  }, new Map());
  if (!groups.size) return null;
  return [...groups.entries()].map(([rackId, group]) => (
    <div key={rackId} className="client-schemes-viewer card" style={{ padding: 16, marginBottom: 16 }}>
      <strong style={{ fontSize: 14 }}>{group.title}</strong>
      <h3 style={{ fontSize: 14, margin: "8px 0 12px" }}>Дополнительные схемы и изображения</h3>
      <div className="client-schemes-viewer__grid">
        {group.images.map((image, index) => (
          <button key={image.id} type="button" className="client-scheme-view-btn" onClick={() => setViewer({ schemes: group.images, activeIndex: index })}>
            <img src={photoSrc(image.url)} alt="" />
            <span>{image.title}</span>
          </button>
        ))}
      </div>
      {viewer && viewer.schemes.some((image) => image.rackId === rackId) && (
        <FloorPlanViewer schemes={viewer.schemes} activeIndex={viewer.activeIndex} onActiveIndexChange={(next) => setViewer((v) => ({ ...v, activeIndex: typeof next === "function" ? next(v.activeIndex) : next }))} open onClose={() => setViewer(null)} />
      )}
    </div>
  ));
}
