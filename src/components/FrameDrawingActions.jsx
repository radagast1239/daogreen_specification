import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { photoSrc } from '../lib/api.js';
import FrameDrawingLinkButton from './FrameDrawingLinkButton.jsx';
import { buildFrameDrawingLink, frameDrawingBindingLabel } from '../../shared/frameDrawingContext.js';
import { drawingStatusLabel } from '../../shared/frameDrawingTargets.js';
import {
  FRAME_BOM_REFRESH_BUTTON_LABEL,
  FRAME_DRAWING_EDIT_SCHEME_LABEL,
  FRAME_DRAWING_OPEN_SCHEME_LABEL,
} from '../../shared/frameDrawingActionsModel.js';
import { resolveFrameBomUiStatus } from '../../shared/projectWorkspaceUi.js';
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
  compact = true,
  onNavigate = null,
  navigateDisabled = false,
  onRefreshBom = null,
  refreshBomBusy = false,
  refreshBomDisabled = false,
  canRefreshBom: canRefreshBomProp = null,
  projectItems = [],
  bomStatus = null,
}) {
  const [showOlder, setShowOlder] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const latest = drawings[0] || null;
  const older = drawings.slice(1);
  const status = latest ? 'Схема сохранена' : drawingStatusLabel(drawings);
  const bindingLabel = frameDrawingBindingLabel(context);

  const baseCtx = { ...context, drawingId: '' };
  const replaceCtx = latest
    ? { ...context, drawingId: latest.id, mode: 'replace' }
    : baseCtx;
  const newVersionCtx = { ...context, drawingId: '', mode: 'new_version' };
  const openSchemeCtx = latest
    ? { ...context, drawingId: latest.id }
    : baseCtx;

  const canRefreshBom =
    canRefreshBomProp != null
      ? Boolean(canRefreshBomProp)
      : Boolean(context.projectId && latest && onRefreshBom);

  const resolvedBomStatus =
    bomStatus ||
    resolveFrameBomUiStatus({
      drawing: latest,
      drawings,
      projectItems,
      context: latest ? openSchemeCtx : baseCtx,
    });

  const runRefresh = () => {
    if (!onRefreshBom) return;
    onRefreshBom({
      context: latest ? openSchemeCtx : baseCtx,
      drawing: latest,
    });
  };

  return (
    <div className={compact ? 'frame-drawing-actions frame-drawing-actions--compact' : 'frame-drawing-actions'}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
          <span className={`${latest ? 'chip chip--ok' : 'muted'}`} style={{ fontSize: 12 }}>
            {status}
          </span>
          {bindingLabel ? (
            <span className="chip chip--neutral" style={{ fontSize: 11 }} title={bindingLabel}>
              {bindingLabel}
            </span>
          ) : null}
          {latest ? (
            <span className="chip chip--ok" style={{ fontSize: 11 }}>v{latest.version}</span>
          ) : null}
          {latest || canRefreshBom ? (
            <span
              className={`chip chip--${resolvedBomStatus.tone === 'ok' ? 'ok' : resolvedBomStatus.tone === 'warn' ? 'amber' : 'neutral'}`}
              style={{ fontSize: 11 }}
            >
              {resolvedBomStatus.label}
            </span>
          ) : null}
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
            <FrameDrawingLinkButton
              context={openSchemeCtx}
              label={FRAME_DRAWING_OPEN_SCHEME_LABEL}
              onNavigate={onNavigate}
              disabled={navigateDisabled}
            />
          )}
          {latest && resolvedBomStatus.id === 'not_added' && onRefreshBom && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={refreshBomBusy || refreshBomDisabled || navigateDisabled}
              onClick={runRefresh}
            >
              {refreshBomBusy ? 'Добавляю…' : 'Добавить каркас и продолжить спецификацию'}
            </button>
          )}
          {latest && resolvedBomStatus.id !== 'not_added' && canRefreshBom && onRefreshBom && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={refreshBomBusy || refreshBomDisabled || navigateDisabled}
              onClick={runRefresh}
              title={FRAME_BOM_UPDATE_BOM_HINT}
            >
              {refreshBomBusy ? 'Обновляю…' : FRAME_BOM_REFRESH_BUTTON_LABEL}
            </button>
          )}
          {latest && (
            <details
              className="frame-drawing-more"
              open={moreOpen}
              onToggle={(e) => setMoreOpen(e.target.open)}
            >
              <summary className="btn btn-sm btn-ghost">Ещё ▾</summary>
              <div className="frame-drawing-more__menu card">
                <FrameDrawingLinkButton
                  context={replaceCtx}
                  label={FRAME_DRAWING_EDIT_SCHEME_LABEL}
                  onNavigate={onNavigate}
                  disabled={navigateDisabled}
                  className="btn btn-sm btn-ghost"
                />
                {canRefreshBom && onRefreshBom && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={refreshBomBusy || refreshBomDisabled || navigateDisabled}
                    onClick={() => {
                      setMoreOpen(false);
                      runRefresh();
                    }}
                  >
                    {refreshBomBusy ? 'Обновляю…' : FRAME_BOM_REFRESH_BUTTON_LABEL}
                  </button>
                )}
                <a
                  className="btn btn-sm btn-ghost"
                  href={photoSrc(latest.pdfUrl)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMoreOpen(false)}
                >
                  PDF схемы
                </a>
                <FrameDrawingLinkButton
                  context={newVersionCtx}
                  label="Новая версия"
                  className="btn btn-sm btn-ghost"
                  onNavigate={onNavigate}
                  disabled={navigateDisabled}
                />
              </div>
            </details>
          )}
          {!latest && canRefreshBom && onRefreshBom && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={refreshBomBusy || refreshBomDisabled || navigateDisabled}
              onClick={runRefresh}
            >
              {refreshBomBusy ? 'Обновляю…' : FRAME_BOM_REFRESH_BUTTON_LABEL}
            </button>
          )}
        </span>
      </div>

      {latest && canRefreshBom && onRefreshBom && (
        <p className="muted" style={{ fontSize: 10, margin: '4px 0 0' }}>
          {FRAME_BOM_UPDATE_BOM_HINT}
        </p>
      )}

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
