import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PDF_MODES } from "../exportPdf.js";
import { PLAN_LEVELS, PLAN_VARIANTS } from "../plannerSheets.js";
import { PlannerLayerSwitcher } from "./PlannerLayerSwitcher.jsx";

export function plannerSaveStatusLabel(statusKey, { saved = true, saveFailed = false } = {}) {
  const map = {
    hydrating: "Загрузка…",
    dirty: "Сохранение…",
    saving: "Сохранение…",
    saved: "Сохранено",
    error: "Ошибка сохранения",
  };
  if (map[statusKey]) return map[statusKey];
  if (saveFailed) return "Ошибка сохранения";
  if (saved) return "Сохранено";
  return "Сохранение…";
}

function statusGlyph(statusKey, saveFailed) {
  if (statusKey === "error" || saveFailed) return "!";
  if (statusKey === "saved") return "✓";
  return "…";
}

export function PlannerTopBar({
  mode = "project",
  title,
  saved,
  saveFailed = false,
  saveStatus = null,
  busy,
  onPdf,
  onSync,
  onExportJson,
  onImportJson,
  onRename,
  onAttach,
  onCheckPlan,
  onFit,
  onUndo,
  onRedo,
  projectId,
  activeSheetId,
  onSheetPick,
  planLevel,
  planVariant,
  onPlanLevel,
  onPlanVariant,
  viewMode,
  onViewModePick,
  inspectorOpen = true,
  onToggleInspector,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const moreRef = useRef(null);
  const importRef = useRef(null);
  const standalone = mode === "standalone";

  useEffect(() => {
    const close = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false);
        setPdfOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const statusKey = saveStatus || (saveFailed ? "error" : saved ? "saved" : "saving");
  const statusLabel = plannerSaveStatusLabel(statusKey, { saved, saveFailed });
  const statusClass =
    "planner-status planner-status--compact" +
    (statusKey === "error" || saveFailed ? " planner-status--err" : "") +
    (statusKey === "saved" && !saveFailed ? " planner-status--ok" : "") +
    (statusKey === "hydrating" || statusKey === "saving" || statusKey === "dirty" ? " planner-status--busy" : "");

  return (
    <header className="planner-topbar planner-topbar--v2 planner-topbar--phase2 no-print">
      <div className="planner-topbar__left">
        <Link
          className="planner-topbar__back"
          to={standalone ? "/planner" : `/project/${projectId}`}
          title={standalone ? "К черновикам" : "К проекту"}
        >
          ←
        </Link>
        <div className="planner-topbar__brand">
          <span className="planner-topbar__logo">Planner</span>
          <span className="planner-topbar__project" title={title}>
            <b>{title || "План"}</b>
          </span>
        </div>
      </div>

      <div className="planner-topbar__center">
        <PlannerLayerSwitcher activeSheetId={activeSheetId} onPick={onSheetPick} />
        <label className="planner-header-select planner-header-select--compact" title="Уровень">
          <span className="planner-header-select__label">Уровень</span>
          <select
            aria-label="Уровень"
            value={planLevel}
            onChange={(e) => onPlanLevel?.(e.target.value)}
          >
            {PLAN_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="planner-header-select planner-header-select--compact" title="Режим">
          <span className="planner-header-select__label">Режим</span>
          <select
            aria-label="Режим"
            value={viewMode || "2d"}
            onChange={(e) => onViewModePick?.(e.target.value)}
          >
            <option value="2d">2D</option>
            <option value="walls">Стены</option>
            <option value="objects">Объекты</option>
            <option value="engineering">Инженерия</option>
          </select>
        </label>
        <label className="planner-header-select planner-header-select--compact planner-header-select--variant" title="Вариант">
          <span className="planner-header-select__label">Вариант</span>
          <select
            aria-label="Вариант"
            value={planVariant}
            onChange={(e) => onPlanVariant?.(e.target.value)}
          >
            {PLAN_VARIANTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="planner-topbar__right">
        <span className={statusClass} title={statusLabel} aria-label={statusLabel}>
          <span className="planner-status__glyph" aria-hidden>
            {statusGlyph(statusKey, saveFailed)}
          </span>
          <span className="planner-status__text">{statusLabel}</span>
        </span>
        <button type="button" className="planner-icon-btn" onClick={onUndo} disabled={busy} title="Отменить">
          ↶
        </button>
        <button type="button" className="planner-icon-btn" onClick={onRedo} disabled={busy} title="Повторить">
          ↷
        </button>
        <button
          type="button"
          className="planner-icon-btn"
          onClick={onFit}
          disabled={busy}
          title="Весь план"
          aria-label="Весь план"
        >
          ⊞
        </button>
        {onToggleInspector && (
          <button
            type="button"
            className={"planner-icon-btn" + (inspectorOpen ? " is-active" : "")}
            onClick={onToggleInspector}
            title={inspectorOpen ? "Скрыть свойства" : "Показать свойства"}
            aria-label={inspectorOpen ? "Скрыть свойства" : "Показать свойства"}
            aria-pressed={inspectorOpen}
          >
            ▥
          </button>
        )}
        <div className="planner-more" ref={moreRef}>
          <button
            type="button"
            className="planner-icon-btn planner-icon-btn--more"
            onClick={() => {
              setMoreOpen((o) => !o);
              setPdfOpen(false);
            }}
            aria-label="Ещё"
            title="Ещё"
          >
            •••
          </button>
          {moreOpen && (
            <div className="planner-more__pop planner-more__pop--end">
              {onCheckPlan && (
                <button
                  type="button"
                  className="planner-more__item"
                  disabled={busy}
                  onClick={() => {
                    setMoreOpen(false);
                    onCheckPlan();
                  }}
                >
                  Проверить план
                </button>
              )}
              <button
                type="button"
                className="planner-more__item"
                disabled={busy}
                onClick={() => setPdfOpen((o) => !o)}
              >
                Export PDF {pdfOpen ? "▴" : "▾"}
              </button>
              {pdfOpen &&
                Object.entries(PDF_MODES).map(([id, m]) => (
                  <button
                    key={id}
                    type="button"
                    className="planner-more__item planner-more__item--sub"
                    onClick={() => {
                      setPdfOpen(false);
                      setMoreOpen(false);
                      onPdf?.(id);
                    }}
                  >
                    PDF: {m.label}
                  </button>
                ))}
              {!standalone && (
                <button
                  type="button"
                  className="planner-more__item"
                  onClick={() => {
                    setMoreOpen(false);
                    onSync?.();
                  }}
                >
                  В спецификацию
                </button>
              )}
              {standalone && (
                <>
                  <button
                    type="button"
                    className="planner-more__item"
                    onClick={() => {
                      setMoreOpen(false);
                      const name = prompt("Название плана:", title || "Новый план");
                      if (name != null) onRename?.(name);
                    }}
                  >
                    Переименовать
                  </button>
                  <button
                    type="button"
                    className="planner-more__item"
                    onClick={() => {
                      setMoreOpen(false);
                      onExportJson?.();
                    }}
                  >
                    Скачать JSON
                  </button>
                  <button
                    type="button"
                    className="planner-more__item"
                    onClick={() => {
                      setMoreOpen(false);
                      importRef.current?.click();
                    }}
                  >
                    Импорт
                  </button>
                  <button
                    type="button"
                    className="planner-more__item"
                    onClick={() => {
                      setMoreOpen(false);
                      onAttach?.();
                    }}
                    disabled={!onAttach}
                  >
                    Привязать к проекту
                  </button>
                  {onSync && (
                    <button
                      type="button"
                      className="planner-more__item"
                      onClick={() => {
                        setMoreOpen(false);
                        onSync();
                      }}
                    >
                      Сформировать спецификацию
                    </button>
                  )}
                  <Link className="planner-more__item" to="/planner" onClick={() => setMoreOpen(false)}>
                    К черновикам
                  </Link>
                </>
              )}
              {!standalone && (
                <Link className="planner-more__item" to={`/project/${projectId}`} onClick={() => setMoreOpen(false)}>
                  К проекту
                </Link>
              )}
              <Link className="planner-more__item" to="/" onClick={() => setMoreOpen(false)}>
                Назад к проектам
              </Link>
              <button
                type="button"
                className="planner-more__item"
                onClick={() => {
                  setMoreOpen(false);
                  window.open("https://daogreen.ru", "_blank");
                }}
              >
                Справка
              </button>
            </div>
          )}
          <input
            ref={importRef}
            type="file"
            accept=".json,.daogreen-plan.json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onImportJson?.(f);
            }}
          />
        </div>
      </div>
    </header>
  );
}
