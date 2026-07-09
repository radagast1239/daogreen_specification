import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { photoSrc } from '../lib/api.js';
import FrameDrawingLinkButton from './FrameDrawingLinkButton.jsx';
import { buildFrameDrawingLink } from '../../shared/frameDrawingContext.js';
import { drawingStatusLabel } from '../../shared/frameDrawingTargets.js';
import {
  FRAME_BOM_REFRESH_BUTTON_LABEL,
  FRAME_DRAWING_EDIT_SCHEME_LABEL,
  FRAME_DRAWING_OPEN_SCHEME_LABEL,
} from '../../shared/frameDrawingActionsModel.js';
import {
  FRAME_BOM_UPDATE_BOM_HINT,
} from '../frameConstructor/frameBomAddToProject.js';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ru-RU');
  } catch {
    return '';
  }
}

export default function FrameDrawingActions({
  context,
  drawings = [],
  onOpenPresetDrawing,
  presetDrawing = null,
  compact = false,
  onNavigate = null,
  navigateDisabled = false,
  onRefreshBom = null,
  refreshBomBusy = false,
  refreshBomDisabled = false,
}) {
  const [showOlder, setShowOlder] = useState(false);
  const latest = drawings[0] || null;
  const older = drawings.slice(1);
  const status = latest ? 'Схема создана' : drawingStatusLabel(drawings);

  const baseCtx = { ...context, drawingId: '' };
  const replaceCtx = latest
    ? { ...context, drawingId: latest.id, mode: 'replace' }
    : baseCtx;
  const newVersionCtx = { ...context, drawingId: '', mode: 'new_version' };
  const openSchemeCtx = latest
    ? { ...context, drawingId: latest.id }
    : baseCtx;

  const canRefreshBom = Boolean(context.projectId && latest && onRefreshBom);

  return (
    <div className={compact ? '' : 'frame-drawing-actions'}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className={`${latest ? 'chip chip--ok' : 'muted'}`} style={{ fontSize: 12 }}>
          {status}
        </span>
        <span className="row wrap" style={{ gap: 6 }}>
          {!latest && !presetDrawing && (
            <FrameDrawingLinkButton context={baseCtx} label="Создать схему" onNavigate={onNavigate} disabled={navigateDisabled} />
          )}
          {!latest && presetDrawing && (
            <>
              <a className="btn btn-sm" href={photoSrc(presetDrawing.pdfUrl)} target="_blank" rel="noreferrer">
                Чертёж пресета
              </a>
              <FrameDrawingLinkButton context={baseCtx} label="Создать схему" onNavigate={onNavigate} disabled={navigateDisabled} />
            </>
          )}
          {latest && (
            <>
              <span className="chip chip--ok" style={{ fontSize: 11 }}>v{latest.version}</span>
              <FrameDrawingLinkButton
                context={openSchemeCtx}
                label={FRAME_DRAWING_OPEN_SCHEME_LABEL}
                onNavigate={onNavigate}
                disabled={navigateDisabled}
              />
              <a className="btn btn-sm" href={photoSrc(latest.pdfUrl)} target="_blank" rel="noreferrer">
                Открыть PDF
              </a>
              <FrameDrawingLinkButton
                context={replaceCtx}
                label={FRAME_DRAWING_EDIT_SCHEME_LABEL}
                onNavigate={onNavigate}
                disabled={navigateDisabled}
              />
              {canRefreshBom && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    disabled={refreshBomBusy || refreshBomDisabled || navigateDisabled}
                    onClick={() => onRefreshBom({ context: openSchemeCtx, drawing: latest })}
                  >
                    {refreshBomBusy ? 'Обновление…' : FRAME_BOM_REFRESH_BUTTON_LABEL}
                  </button>
                  <span className="muted" style={{ fontSize: 10, width: '100%' }}>
                    {FRAME_BOM_UPDATE_BOM_HINT}
                  </span>
                </>
              )}
              <FrameDrawingLinkButton
                context={newVersionCtx}
                label="Новая версия"
                className="btn btn-sm btn-outline"
                onNavigate={onNavigate}
                disabled={navigateDisabled}
              />
            </>
          )}
        </span>
      </div>

      {latest && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {latest.title} · {formatDate(latest.updatedAt || latest.createdAt)}
          {older.length > 0 && (
            <>
              {' · '}
              <button
                type="button"
                className="btn-link"
                style={{ fontSize: 11, padding: 0 }}
                onClick={() => setShowOlder((v) => !v)}
              >
                {showOlder ? 'Скрыть старые' : `Ещё ${older.length} верс.`}
              </button>
            </>
          )}
        </div>
      )}

      {showOlder && older.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11 }}>
          {older.map((d) => (
            <li key={d.id} style={{ marginBottom: 4 }}>
              <a href={photoSrc(d.pdfUrl)} target="_blank" rel="noreferrer">
                v{d.version} — {d.title}
              </a>
              {' '}
              <span className="muted">{formatDate(d.updatedAt || d.createdAt)}</span>
              {' · '}
              <Link to={buildFrameDrawingLink({ ...context, drawingId: d.id })} target="_blank" rel="noreferrer">
                открыть
              </Link>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
