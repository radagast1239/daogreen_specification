import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MATERIAL_REVIEW_DEFAULT_FILTER,
  MATERIAL_REVIEW_FILTERS,
  MATERIAL_REVIEW_STATUS,
  buildKeepProjectValuesPatch,
  canUpdateReviewField,
  clearRetainedFields,
  countReviewRowsByStatus,
  filterMaterialChangesReview,
  formatCompactDiffLine,
  formatMaterialReviewToast,
  mapFieldsToCatalogApply,
  mapFieldsToRefreshPayload,
  mergeRetainedByItem,
  selectBulkUpdateItemIds,
  splitDiffsForPreview,
} from "../../shared/materialChangesReview.js";
import { applyProjectCatalogUpdates } from "../../shared/applyProjectCatalogUpdates.js";
import "../styles/material-changes-review.css";

function fmtPickVal(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return String(v);
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function RowMenu({ open, onClose, children, anchorRef }) {
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (menuRef.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return (
    <div className="mcr-menu" ref={menuRef} role="menu">
      {children}
    </div>
  );
}

function CompactDiffs({ diffs }) {
  const [expanded, setExpanded] = useState(false);
  const { preview, rest, total } = useMemo(() => splitDiffsForPreview(diffs, 2), [diffs]);
  const shown = expanded ? [...preview, ...rest] : preview;
  return (
    <div className="mcr-diffs">
      {shown.map((d) => {
        const line = formatCompactDiffLine(d);
        return (
          <div key={d.field} className={`mcr-diff-line mcr-diff-line--${d.status}`} title={line}>
            {line}
          </div>
        );
      })}
      {rest.length > 0 ? (
        <button type="button" className="mcr-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Свернуть" : `Ещё ${rest.length} ${rest.length === 1 ? "изменение" : "изменений"}`}
        </button>
      ) : null}
      {total === 0 ? <span className="muted">Нет отличий</span> : null}
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object} props.review — from buildMaterialChangesReview
 * @param {object} props.project
 * @param {object[]} props.materials
 * @param {(itemId: string) => void} props.onOpenItem
 * @param {object} props.actions — store actions
 * @param {(itemId: string, patch: object) => Promise<void>} props.onPatchItem
 * @param {(msg: string) => void} props.success
 * @param {(msg: string) => void} props.error
 * @param {(opts: object) => Promise<boolean>} props.confirm
 * @param {Record<string, string[]>} props.retainedByItem
 * @param {(next: Record<string, string[]>) => void} props.onRetainedChange
 * @param {() => Promise<void>} [props.onAfterChange]
 */
export default function MaterialChangesReviewPanel({
  open,
  onClose,
  review,
  project,
  materials,
  onOpenItem,
  actions,
  onPatchItem,
  success,
  error,
  confirm,
  retainedByItem,
  onRetainedChange,
  onAfterChange,
}) {
  const [filter, setFilter] = useState(MATERIAL_REVIEW_DEFAULT_FILTER);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [fieldPickItemId, setFieldPickItemId] = useState(null);
  const [fieldPickSelected, setFieldPickSelected] = useState(() => new Set());
  const [includeOverridesInBulk, setIncludeOverridesInBulk] = useState(false);
  const [menuItemId, setMenuItemId] = useState(null);
  const menuBtnRefs = useRef(new Map());

  const rows = review?.rows || [];
  const statusCounts = useMemo(() => countReviewRowsByStatus(rows), [rows]);
  const filtered = useMemo(() => filterMaterialChangesReview(rows, filter), [rows, filter]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (fieldPickItemId) setFieldPickItemId(null);
        else if (menuItemId) setMenuItemId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, fieldPickItemId, menuItemId]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setFilter(MATERIAL_REVIEW_DEFAULT_FILTER);
      setFieldPickItemId(null);
      setIncludeOverridesInBulk(false);
      setMenuItemId(null);
    }
  }, [open]);

  if (!open) return null;

  const toggleId = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    const ids = filtered.map((r) => r.itemId);
    const allOn = ids.length && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const persistRetained = async (nextMap) => {
    onRetainedChange(nextMap);
    await actions.projectUpdate(project.id, {
      manualParams: {
        ...(project.manualParams || {}),
        retainedCatalogFields: nextMap,
      },
    });
  };

  const refreshAfter = async () => {
    await actions.loadProject(project.id);
    if (onAfterChange) await onAfterChange();
  };

  const updateItemsFromCatalog = async (itemIds, fields = null) => {
    if (!itemIds.length) {
      return { updated: 0, alreadyCurrent: 0, failed: 0 };
    }
    let updated = 0;
    let alreadyCurrent = 0;
    let failed = 0;

    const refreshFields = fields?.length ? mapFieldsToRefreshPayload(fields) : ["all"];
    const catalogFields = fields?.length ? mapFieldsToCatalogApply(fields) : null;

    try {
      if (refreshFields.length) {
        const res = await actions.refreshItemsFromMaterial(
          project.id,
          { itemIds, fields: refreshFields },
          { items: project.items, materials }
        );
        for (const row of res.results || []) {
          if (row.changed) updated += 1;
          else if (row.reason) failed += 1;
          else alreadyCurrent += 1;
        }
        for (const s of res.skipped || []) {
          if (s.reason === "no_material" || s.reason === "material_missing") failed += 1;
        }
      }

      if (catalogFields?.length) {
        const { items: nextItems, updated: catUpdated, skipped } = applyProjectCatalogUpdates(
          (await actions.loadProject(project.id))?.items || project.items,
          materials,
          { itemIds, fields: catalogFields }
        );
        if (catUpdated.length) {
          await actions.projectUpdate(project.id, { items: nextItems });
          updated += catUpdated.length;
        }
        alreadyCurrent += (skipped || []).filter((s) => s.reason === "no_changes").length;
      }
    } catch (e) {
      failed += itemIds.length;
      throw e;
    }

    let nextRetained = retainedByItem;
    for (const id of itemIds) {
      nextRetained = clearRetainedFields(nextRetained, id, fields);
    }
    if (nextRetained !== retainedByItem) {
      await persistRetained(nextRetained);
    }

    return { updated, alreadyCurrent, failed };
  };

  const keepProjectValues = async (itemIds, fieldsByItem = null) => {
    let kept = 0;
    let nextRetained = { ...retainedByItem };
    for (const id of itemIds) {
      const row = rows.find((r) => r.itemId === id);
      const item = (project.items || []).find((it) => it.id === id);
      if (!row || !item) continue;
      const fields =
        fieldsByItem?.[id] ||
        (row.fieldDiffs || [])
          .filter((d) => d.field !== "supplier")
          .map((d) => d.field);
      if (!fields.length) continue;
      const patch = buildKeepProjectValuesPatch(item, fields, nextRetained);
      nextRetained = mergeRetainedByItem(nextRetained, id, fields);
      await onPatchItem(id, patch);
      kept += 1;
    }
    await persistRetained(nextRetained);
    return kept;
  };

  const onUpdateOne = async (row) => {
    const fields = (row.fieldDiffs || []).filter((d) => d.canUpdate).map((d) => d.field);
    if (!fields.length) {
      success("Нечего обновлять — поставщик уже из базы");
      return;
    }
    setBusy(true);
    try {
      const stats = await updateItemsFromCatalog([row.itemId], fields);
      await refreshAfter();
      success(formatMaterialReviewToast(stats));
    } catch (e) {
      error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onKeepOne = async (row) => {
    const fields = (row.fieldDiffs || [])
      .filter((d) => !d.infoText || d.status === MATERIAL_REVIEW_STATUS.needs_review)
      .filter((d) => d.field !== "supplier")
      .map((d) => d.field);
    if (!fields.length) {
      success("Нечего оставлять");
      return;
    }
    setBusy(true);
    try {
      const kept = await keepProjectValues([row.itemId], { [row.itemId]: fields });
      await refreshAfter();
      success(formatMaterialReviewToast({ updated: 0, keptProject: kept }));
    } catch (e) {
      error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const openFieldPick = (row) => {
    const defaults = new Set(
      (row.fieldDiffs || []).filter((d) => d.canUpdate && d.status === MATERIAL_REVIEW_STATUS.needs_review).map((d) => d.field)
    );
    setMenuItemId(null);
    setFieldPickItemId(row.itemId);
    setFieldPickSelected(defaults);
  };

  const confirmFieldPick = async () => {
    const id = fieldPickItemId;
    const fields = [...fieldPickSelected];
    setFieldPickItemId(null);
    if (!id || !fields.length) return;
    setBusy(true);
    try {
      const stats = await updateItemsFromCatalog([id], fields);
      await refreshAfter();
      success(formatMaterialReviewToast(stats));
    } catch (e) {
      error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onBulkUpdateSelected = async () => {
    const ids = selectBulkUpdateItemIds(rows, {
      selectedIds: [...selected],
      includeProjectOverrides: includeOverridesInBulk,
    });
    if (!ids.length) {
      success(formatMaterialReviewToast({ updated: 0, alreadyCurrent: 0, skippedOverrides: selected.size }));
      return;
    }
    setBusy(true);
    try {
      const stats = await updateItemsFromCatalog(ids, null);
      const skippedOverrides = [...selected].filter((id) => !ids.includes(id)).length;
      await refreshAfter();
      success(formatMaterialReviewToast({ ...stats, skippedOverrides }));
    } catch (e) {
      error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onBulkKeepSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      const kept = await keepProjectValues(ids);
      await refreshAfter();
      success(formatMaterialReviewToast({ keptProject: kept }));
    } catch (e) {
      error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUpdateAll = async () => {
    const eligible = selectBulkUpdateItemIds(rows, { includeProjectOverrides: includeOverridesInBulk });
    const skippedOverrides = rows.filter(
      (r) => r.status === MATERIAL_REVIEW_STATUS.project_override && !includeOverridesInBulk
    ).length;
    if (!eligible.length) {
      success(formatMaterialReviewToast({ updated: 0, skippedOverrides }));
      return;
    }
    const ok = await confirm({
      title: "Обновить всё из базы",
      message: `Обновить ${eligible.length} поз. из базы материалов?${
        skippedOverrides ? ` Строки «Изменено в проекте» (${skippedOverrides}) будут пропущены.` : ""
      }`,
      confirmLabel: "Обновить",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const stats = await updateItemsFromCatalog(eligible, null);
      await refreshAfter();
      success(formatMaterialReviewToast({ ...stats, skippedOverrides }));
    } catch (e) {
      error(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const fieldPickRow = rows.find((r) => r.itemId === fieldPickItemId);
  const filterCountLabel = (f) => {
    if (f.id === "needs_review") return statusCounts.needs_review;
    if (f.id === "project_override") return statusCounts.project_override;
    if (f.id === "all") return statusCounts.all;
    return null;
  };

  return (
    <div className="mcr-overlay" role="dialog" aria-modal="true" aria-label="Изменения в базе материалов" onClick={onClose}>
      <div className="mcr-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mcr-panel__head">
          <div>
            <strong>Изменения в базе материалов</strong>
            <div className="muted mcr-panel__sub">
              {rows.length} позиций
              {statusCounts.needs_review ? ` · требуют проверки: ${statusCounts.needs_review}` : ""}
              {statusCounts.project_override ? ` · изменено в проекте: ${statusCounts.project_override}` : ""}
              {statusCounts.applied_from_catalog ? ` · уже применяется: ${statusCounts.applied_from_catalog}` : ""}
            </div>
          </div>
          <div className="mcr-panel__head-actions">
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !rows.length} onClick={onUpdateAll}>
              Обновить всё из базы ({selectBulkUpdateItemIds(rows, { includeProjectOverrides: includeOverridesInBulk }).length})
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </div>
        </div>

        <div className="mcr-panel__toolbar">
          <div className="mcr-filters" role="tablist">
            {MATERIAL_REVIEW_FILTERS.map((f) => {
              const count = filterCountLabel(f);
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  className={`mcr-filter${filter === f.id ? " is-active" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  {count != null ? <span className="mcr-filter__count">{count}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="mcr-toolbar-meta">
            <label className="mcr-select-all">
              <input
                type="checkbox"
                checked={filtered.length > 0 && filtered.every((r) => selected.has(r.itemId))}
                onChange={toggleAllFiltered}
                aria-label="Выбрать все"
              />
              Выбрать видимые
            </label>
            <label className="mcr-bulk__check muted">
              <input
                type="checkbox"
                checked={includeOverridesInBulk}
                onChange={(e) => setIncludeOverridesInBulk(e.target.checked)}
              />
              Включать «Изменено в проекте»
            </label>
            <span className="muted">Показано: {filtered.length}</span>
          </div>
        </div>

        <div className="mcr-panel__body">
          <ul className="mcr-list">
            {filtered.map((row) => {
              const canUpdate = (row.fieldDiffs || []).some((d) => d.canUpdate);
              const canKeep = (row.fieldDiffs || []).some((d) => d.field !== "supplier");
              const menuOpen = menuItemId === row.itemId;
              return (
                <li key={row.itemId} className={`mcr-row mcr-row--${row.status}`} data-status={row.status}>
                  <label className="mcr-row__check">
                    <input
                      type="checkbox"
                      checked={selected.has(row.itemId)}
                      onChange={() => toggleId(row.itemId)}
                      aria-label={`Выбрать ${row.itemName}`}
                    />
                  </label>
                  <div className="mcr-row__main">
                    <div className="mcr-row__title" title={row.itemName}>{row.itemName}</div>
                    <div className="mcr-row__mat" title={row.materialName}>{row.materialName}</div>
                    <CompactDiffs diffs={row.fieldDiffs || []} />
                  </div>
                  <div className="mcr-row__status">
                    <span className={`mcr-badge mcr-badge--${row.status}`}>{row.statusLabel}</span>
                  </div>
                  <div className="mcr-row__actions">
                    {canUpdate ? (
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onUpdateOne(row)}>
                        Обновить
                      </button>
                    ) : null}
                    {canKeep ? (
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onKeepOne(row)}>
                        Оставить
                      </button>
                    ) : null}
                    <div className="mcr-row__menu-wrap">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost mcr-more-btn"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        ref={(node) => {
                          if (node) menuBtnRefs.current.set(row.itemId, node);
                          else menuBtnRefs.current.delete(row.itemId);
                        }}
                        onClick={() => setMenuItemId(menuOpen ? null : row.itemId)}
                      >
                        ⋯
                      </button>
                      <RowMenu
                        open={menuOpen}
                        onClose={() => setMenuItemId(null)}
                        anchorRef={{ current: menuBtnRefs.current.get(row.itemId) }}
                      >
                        {(row.fieldDiffs || []).filter((d) => d.canUpdate).length > 1 ? (
                          <button type="button" role="menuitem" className="mcr-menu__item" disabled={busy} onClick={() => openFieldPick(row)}>
                            Выбрать поля
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          className="mcr-menu__item"
                          onClick={() => {
                            setMenuItemId(null);
                            onOpenItem(row.itemId);
                            onClose();
                          }}
                        >
                          Открыть позицию
                        </button>
                      </RowMenu>
                    </div>
                  </div>
                </li>
              );
            })}
            {!filtered.length ? (
              <li className="mcr-empty muted">Нет позиций для этого фильтра</li>
            ) : null}
          </ul>
        </div>

        {selected.size > 0 ? (
          <div className="mcr-footer">
            <span className="mcr-footer__count">Выбрано: {selected.size}</span>
            <div className="mcr-footer__actions">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onBulkUpdateSelected}>
                Обновить выбранные
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={onBulkKeepSelected}>
                Оставить проектные
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
                Снять выбор
              </button>
            </div>
          </div>
        ) : null}

        {fieldPickRow ? (
          <div className="mcr-fieldpick" role="dialog" aria-label="Выбор полей">
            <div className="mcr-fieldpick__card">
              <strong>Выбрать поля — {fieldPickRow.itemName}</strong>
              <div className="mcr-fieldpick__list">
                {(fieldPickRow.fieldDiffs || [])
                  .filter((d) => canUpdateReviewField(d.field))
                  .map((d) => (
                    <label key={d.field} className="mcr-fieldpick__row">
                      <input
                        type="checkbox"
                        checked={fieldPickSelected.has(d.field)}
                        onChange={(e) => {
                          setFieldPickSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(d.field);
                            else next.delete(d.field);
                            return next;
                          });
                        }}
                      />
                      <span>{d.label}</span>
                      <span className="muted">{fmtPickVal(d.before)} → {fmtPickVal(d.after)}</span>
                    </label>
                  ))}
              </div>
              <div className="mcr-fieldpick__foot">
                <button type="button" className="btn" onClick={() => setFieldPickItemId(null)}>
                  Отмена
                </button>
                <button type="button" className="btn btn-primary" disabled={!fieldPickSelected.size || busy} onClick={confirmFieldPick}>
                  Обновить выбранные поля
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
