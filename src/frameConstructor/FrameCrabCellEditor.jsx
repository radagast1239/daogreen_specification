import React, { useEffect, useMemo, useState } from 'react';
import { CRAB_CHIP_COLORS } from './frameCrabAudit.js';
import { crabCatalogByKey } from './frameCrabCatalog.js';
import { CRAB_COUNT_KEYS, normalizeCrabCountSet } from './frameCrabOverrides.js';
import {
  crabPiecesFromSets,
  crabSetsFromPieces,
} from './frameCrabRules.js';

const FIELD_META = [
  { key: 'g', type: 'G', label: 'Г', unit: 'шт.' },
  { key: 't', type: 'T', label: 'T', unit: 'шт.' },
  { key: 'x', type: 'X', label: 'X', unit: 'шт.' },
  { key: 'a4', type: 'A4', label: '4×', unit: 'компл.' },
  { key: 'a6', type: 'A6', label: '6×', unit: 'шт.' },
];

function countsToEditorDraft(counts) {
  const base = { g: 0, t: 0, x: 0, a4: 0, a6: 0, ...counts };
  return {
    g: crabPiecesFromSets(base.g, 'G'),
    t: crabPiecesFromSets(base.t, 'T'),
    x: crabPiecesFromSets(base.x, 'X'),
    a4: base.a4,
    a6: crabPiecesFromSets(base.a6, 'A6'),
  };
}

function editorDraftToCounts(draft) {
  return normalizeCrabCountSet({
    g: crabSetsFromPieces(draft.g, 'G'),
    t: crabSetsFromPieces(draft.t, 'T'),
    x: crabSetsFromPieces(draft.x, 'X'),
    a4: draft.a4,
    a6: crabSetsFromPieces(draft.a6, 'A6'),
  });
}

/**
 * @param {{
 *   tierLabel: string,
 *   px: number,
 *   py: number,
 *   role: string,
 *   currentCounts: object,
 *   autoCounts: object,
 *   isOverride: boolean,
 *   onApply: (counts: object) => void,
 *   onReset: () => void,
 *   onClose: () => void,
 * }} props
 */
export default function FrameCrabCellEditor({
  tierLabel,
  px,
  py,
  role,
  currentCounts,
  autoCounts,
  isOverride,
  onApply,
  onReset,
  onClose,
}) {
  const [draft, setDraft] = useState(() => countsToEditorDraft(currentCounts));
  const autoDraft = useMemo(() => countsToEditorDraft(autoCounts), [autoCounts]);

  useEffect(() => {
    setDraft(countsToEditorDraft(currentCounts));
  }, [tierLabel, px, py, currentCounts]);

  const handleChange = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: Math.max(0, Math.round(Number(value) || 0)) }));
  };

  const handleApply = () => {
    const normalized = editorDraftToCounts(draft);
    if (!normalized) return;
    onApply(normalized);
  };

  return (
    <div className="fc-crab-editor" role="dialog" aria-label="Редактор крабов на стойке">
      <div className="fc-crab-editor__head">
        <div>
          <strong>
            {tierLabel} · стойка X{px + 1}:Y{py + 1}
          </strong>
          <div className="fc-crab-editor__role">{role}</div>
        </div>
        <button type="button" className="fc-crab-editor__close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>

      <div className="fc-crab-editor__fields">
        {FIELD_META.map(({ key, type, label, unit }) => {
          const catalog = crabCatalogByKey(type);
          return (
            <label key={key} className="fc-crab-editor__field">
              <span
                className="fc-crab-editor__swatch"
                style={{ backgroundColor: CRAB_CHIP_COLORS[type] }}
              />
              <span className="fc-crab-editor__field-label">{catalog?.label ?? label}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={draft[key] ?? 0}
                onChange={(e) => handleChange(key, e.target.value)}
              />
              <span className="fc-crab-editor__field-hint">{unit}</span>
            </label>
          );
        })}
      </div>

      <div className="fc-crab-editor__auto">
        <span className="fc-crab-editor__auto-label">Авто:</span>
        {CRAB_COUNT_KEYS.filter((k) => autoDraft[k] > 0).map((k) => {
          const meta = FIELD_META.find((f) => f.key === k);
          return (
            <span key={k} className="fc-crab-editor__auto-item">
              {meta?.label ?? k}×{autoDraft[k]} {meta?.unit ?? ''}
            </span>
          );
        })}
        {!CRAB_COUNT_KEYS.some((k) => autoDraft[k] > 0) && '—'}
      </div>

      <div className="fc-crab-editor__actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={handleApply}>
          Применить
        </button>
        {isOverride && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onReset}>
            Вернуть авто
          </button>
        )}
        <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
