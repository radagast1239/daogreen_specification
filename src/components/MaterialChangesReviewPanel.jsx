import React, { useEffect, useMemo, useState } from "react";
import {
  MATERIAL_REVIEW_FILTERS,
  MATERIAL_REVIEW_STATUS,
  buildKeepProjectValuesPatch,
  canUpdateReviewField,
  clearRetainedFields,
  filterMaterialChangesReview,
  formatMaterialReviewToast,
  mapFieldsToCatalogApply,
  mapFieldsToRefreshPayload,
  mergeRetainedByItem,
  selectBulkUpdateItemIds,
} from "../../shared/materialChangesReview.js";
import { applyProjectCatalogUpdates } from "../../shared/applyProjectCatalogUpdates.js";
import "../styles/material-changes-review.css";

function fmtVal(v) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return String(v);
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
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
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [fieldPickItemId, setFieldPickItemId] = useState(null);
  const [fieldPickSelected, setFieldPickSelected] = useState(() => new Set());
  const [includeOverridesInBulk, setIncludeOverridesInBulk] = useState(false);

  const rows = review?.rows || [];
  const filtered = useMemo(() => filterMaterialChangesReview(rows, filter), [rows, filter]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (fieldPickItemId) setFieldPickItemId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, fieldPickItemId]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setFilter("all");
      setFieldPickItemId(null);
      setIncludeOverridesInBulk(false);
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

  return (
    <div className="mcr-overlay" role="dialog" aria-modal="true" aria-label="Изменения в базе материалов" onClick={onClose}>
      <div className="mcr-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mcr-panel__head">
          <div>
            <strong>Изменения в базе материалов</strong>
            <div className="muted mcr-panel__sub">{rows.length} позиций · полный список</div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="mcr-panel__toolbar">
          <div className="mcr-filters" role="tablist">
            {MATERIAL_REVIEW_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`btn btn-sm ${filter === f.id ? "btn-primary" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="mcr-bulk">
            <label className="mcr-bulk__check muted">
              <input
                type="checkbox"
                checked={includeOverridesInBulk}
                onChange={(e) => setIncludeOverridesInBulk(e.target.checked)}
              />
              Включать «Изменено в проекте»
            </label>
            <button type="button" className="btn btn-sm" disabled={busy || !selected.size} onClick={onBulkUpdateSelected}>
              Обновить выбранные ({selected.size})
            </button>
            <button type="button" className="btn btn-sm" disabled={busy || !selected.size} onClick={onBulkKeepSelected}>
              Оставить выбранные значения проекта
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !rows.length} onClick={onUpdateAll}>
              Обновить всё из базы ({selectBulkUpdateItemIds(rows, { includeProjectOverrides: includeOverridesInBulk }).length})
            </button>
          </div>
        </div>

        <div className="mcr-panel__body">
          <div className="mcr-table-wrap">
            <table className="mcr-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((r) => selected.has(r.itemId))}
                      onChange={toggleAllFiltered}
                      aria-label="Выбрать все"
                    />
                  </th>
                  <th>Позиция проекта</th>
                  <th>Материал базы</th>
                  <th>Изменения</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.itemId} data-status={row.status}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(row.itemId)}
                        onChange={() => toggleId(row.itemId)}
                        aria-label={`Выбрать ${row.itemName}`}
                      />
                    </td>
                    <td>
                      <div className="mcr-item-name">{row.itemName}</div>
                      {row.module ? <div className="muted mcr-item-mod">{row.module}</div> : null}
                    </td>
                    <td>
                      <div>{row.materialName}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{row.materialId}</div>
                    </td>
                    <td>
                      <div className="mcr-diffs">
                        {(row.fieldDiffs || []).map((d) => (
                          <div key={d.field} className={`mcr-diff mcr-diff--${d.status}`}>
                            <div className="mcr-diff__label">{d.label}</div>
                            {d.infoText ? (
                              <div className="muted mcr-diff__info">{d.infoText}</div>
                            ) : (
                              <div className="mcr-diff__vals">
                                <span title={String(d.before ?? "")}>{fmtVal(d.before)}</span>
                                <span className="muted">→</span>
                                <span title={String(d.after ?? "")}>{fmtVal(d.after)}</span>
                              </div>
                            )}
                            <div className="muted mcr-diff__st">{d.statusLabel}</div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={`mcr-badge mcr-badge--${row.status}`}>{row.statusLabel}</span>
                    </td>
                    <td>
                      <div className="mcr-actions">
                        {(row.fieldDiffs || []).some((d) => d.canUpdate) ? (
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onUpdateOne(row)}>
                            Обновить из базы
                          </button>
                        ) : null}
                        {(row.fieldDiffs || []).filter((d) => d.canUpdate).length > 1 ? (
                          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => openFieldPick(row)}>
                            Выбрать поля
                          </button>
                        ) : null}
                        {(row.fieldDiffs || []).some((d) => d.field !== "supplier") ? (
                          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onKeepOne(row)}>
                            Оставить значения проекта
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            onOpenItem(row.itemId);
                            onClose();
                          }}
                        >
                          Открыть позицию
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={6} className="muted" style={{ padding: 24, textAlign: "center" }}>
                      Нет позиций для этого фильтра
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

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
                      <span className="muted">{fmtVal(d.before)} → {fmtVal(d.after)}</span>
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
