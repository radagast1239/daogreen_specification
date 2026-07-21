import React, { useEffect, useRef, useState } from "react";
import { t } from "../../shared/clientI18n.js";
import { api, photoSrc } from "../lib/api.js";
import AuthMediaImg from "./AuthMediaImg.jsx";
import FloorPlanViewer from "./FloorPlanViewer.jsx";
import { useClipboardImagePaste } from "../lib/useClipboardImagePaste.js";
import { isPdfScheme, SCHEME_FILE_ACCEPT, schemeOpenRel } from "../lib/schemeMedia.js";
import {
  addProjectScheme,
  clientVisibleSchemes,
  filledSchemeSlots,
  listProjectSchemes,
  moveProjectScheme,
  removeProjectScheme,
  updateProjectScheme,
} from "../lib/clientSchemes.js";
import { beginSchemePasteAttempt, pasteClipboardSchemeImage } from "../lib/schemeClipboardPaste.js";

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
  projectId = "",
}) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const schemes = listProjectSchemes(mp);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(null);
  const mpRef = useRef(mp);
  mpRef.current = mp;
  const projectIdRef = useRef(String(projectId || ""));
  projectIdRef.current = String(projectId || "");
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    projectIdRef.current = String(projectId || "");
  }, [projectId]);

  const filled = filledSchemeSlots(mp);
  const heading = title ?? (showClientVisibility ? null : "Схемы проекта");
  const description =
    intro ??
    (showClientVisibility
      ? "Добавляйте схемы без лимита (картинка или PDF). Загрузите файл или вставьте скриншот Ctrl+V. Галочка «Клиенту» управляет показом в клиентской ссылке."
      : "Добавляйте, переименовывайте и упорядочивайте схемы. Каждая сохраняется в проекте (manualParams.projectSchemes).");

  const upload = async (id, file, baseMp = mpRef.current) => {
    if (!file || uploading) return;
    const attemptProjectId = projectIdRef.current;
    const attemptGeneration = generationRef.current;
    const capturedOnChange = onChangeRef.current;
    setUploading(id);
    try {
      const result = await api.uploadProjectScheme(file);
      if (
        !mountedRef.current ||
        generationRef.current !== attemptGeneration ||
        projectIdRef.current !== attemptProjectId
      ) {
        return;
      }
      const latest = mpRef.current;
      const targetMp = listProjectSchemes(latest).some((s) => s.id === id || s.key === id)
        ? latest
        : baseMp;
      if (!listProjectSchemes(targetMp).some((s) => s.id === id || s.key === id)) return;
      capturedOnChange(
        updateProjectScheme(targetMp, id, {
          url: result.url,
          mimeType: result.mimeType || file.type || "image/*",
          createdAt: new Date().toISOString(),
        })
      );
    } catch (e) {
      if (mountedRef.current && generationRef.current === attemptGeneration) {
        alert(e.message || "Не удалось загрузить");
      }
    } finally {
      setUploading(null);
    }
  };

  const { pasteZoneProps } = useClipboardImagePaste({
    disabled: !!uploading,
    onImage: async (file) => {
      if (uploading) return;
      setUploading("paste");
      const write = onChangeRef.current;
      const attempt = beginSchemePasteAttempt({
        projectId: projectIdRef.current,
        generation: generationRef.current,
        getGeneration: () => generationRef.current,
        getProjectId: () => projectIdRef.current,
        isMounted: () => mountedRef.current,
        getManualParams: () => mpRef.current,
        // Capture write target for THIS project at paste start.
        onChange: (next) => {
          mpRef.current = next;
          write(next);
        },
      });
      try {
        const outcome = await pasteClipboardSchemeImage({
          file,
          uploadFile: (f) => api.uploadProjectScheme(f),
          attempt,
        });
        if (outcome?.stale) return;
      } catch (e) {
        if (attempt.isCurrent()) {
          alert(e.message || "Не удалось загрузить");
        }
      } finally {
        setUploading(null);
      }
    },
  });

  const openScheme = (id) => {
    const idx = filled.findIndex((s) => s.id === id || s.key === id);
    if (idx < 0) return;
    const scheme = filled[idx];
    if (isPdfScheme(scheme)) {
      const href = photoSrc(scheme.url);
      if (href) window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    setViewer({ schemes: filled, activeIndex: idx });
  };

  return (
    <div className="client-schemes-editor" style={{ marginBottom: 14 }} {...pasteZoneProps}>
      {heading && (
        <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>{heading}</h4>
      )}
      <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
        {description}
      </p>
      <div className="client-schemes-grid">
        {schemes.map((scheme, index) => {
          const pdf = isPdfScheme(scheme);
          const src = scheme.url && !pdf ? photoSrc(scheme.url) : "";
          const href = scheme.url ? photoSrc(scheme.url) : "";
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
              {pdf && href ? (
                <div className="client-scheme-card__pdf muted" style={{ padding: "18px 10px", textAlign: "center", border: "1px dashed var(--border, #c5d9d3)", borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>PDF</div>
                  <a className="btn btn-sm" href={href} target="_blank" rel={schemeOpenRel()}>
                    Открыть PDF
                  </a>
                </div>
              ) : src ? (
                <button
                  type="button"
                  className="client-scheme-card__thumb"
                  onClick={() => openScheme(scheme.id)}
                  title="Открыть"
                >
                  <AuthMediaImg src={src} alt={scheme.title} />
                </button>
              ) : (
                <div className="client-scheme-card__empty muted">Нет файла</div>
              )}
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                  {uploading === scheme.id ? "…" : scheme.url ? "Заменить" : "Загрузить"}
                  <input
                    type="file"
                    accept={SCHEME_FILE_ACCEPT}
                    hidden
                    disabled={!!uploading}
                    onChange={(e) => {
                      upload(scheme.id, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {scheme.url && (
                  pdf ? (
                    <a className="btn btn-sm" href={href} target="_blank" rel={schemeOpenRel()}>
                      Открыть PDF
                    </a>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => openScheme(scheme.id)}>
                      Открыть
                    </button>
                  )
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
        <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>
          Ctrl+V — новый скриншот как отдельная схема
        </span>
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

  const imageSchemes = schemes.filter((s) => !isPdfScheme(s));

  return (
    <div className="client-schemes-viewer card" style={{ padding: 16, marginBottom: 16 }}>
      <strong style={{ fontSize: 14 }}>{t(language, "client.schemes.viewer.title")}</strong>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 12px" }}>
        Нажмите на схему, чтобы открыть. PDF открывается в новой вкладке.
      </p>
      <div className="client-schemes-viewer__grid">
        {schemes.map((def, i) => {
          const href = photoSrc(def.accessUrl || def.url);
          if (!href) return null;
          if (isPdfScheme(def)) {
            return (
              <a
                key={def.id || def.key}
                className="client-scheme-view-btn"
                href={href}
                target="_blank"
                rel={schemeOpenRel()}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div style={{ display: "grid", placeItems: "center", minHeight: 96, background: "var(--surface-2, #f3f6f5)" }}>
                  <span style={{ fontWeight: 700 }}>PDF</span>
                </div>
                <span>{def.title || def.label}</span>
              </a>
            );
          }
          return (
            <button
              key={def.id || def.key}
              type="button"
              className="client-scheme-view-btn"
              onClick={() => {
                const idx = imageSchemes.findIndex((s) => (s.id || s.key) === (def.id || def.key));
                setViewer({ schemes: imageSchemes, activeIndex: Math.max(0, idx) });
              }}
            >
              <img src={href} alt="" />
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
            <AuthMediaImg src={photoSrc(image.accessUrl || image.url)} alt="" />
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
