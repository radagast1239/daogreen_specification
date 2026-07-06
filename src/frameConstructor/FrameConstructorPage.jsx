import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout.jsx';
import FrameForm from './FrameForm.jsx';
import Frame3DView from './Frame3DView.jsx';
import FrameDrawings2D from './FrameDrawings2D.jsx';
import FrameCutList from './FrameCutList.jsx';
import FramePdfButton from './FramePdfButton.jsx';
import { framePresets } from './framePresets.js';
import { calculateFrameGeometry } from './frameGeometry.js';
import { generateCutList } from './frameCutList.js';
import { countConnectorsByType } from './frameCrabRules.js';
import {
  parseFrameDrawingSearchParams,
  hasFrameDrawingSaveTarget,
  frameDrawingBindingLabel,
  frameDrawingSaveHint,
} from '../../shared/frameDrawingContext.js';
import { api } from '../lib/api.js';
import './frameConstructor.css';

const RACK_TYPE_LABELS = {
  nft: 'NFT',
  flood: 'Подтопление',
  seedling: 'Рассада',
  strawberry: 'Клубника',
  custom: 'Кастомный',
};

export default function FrameConstructorPage() {
  const [searchParams] = useSearchParams();
  const drawingContext = useMemo(
    () => parseFrameDrawingSearchParams(searchParams),
    [searchParams],
  );

  const [params, setParams] = useState(framePresets[0].params);
  const [activeTab, setActiveTab] = useState('drawings');
  const [contextLoaded, setContextLoaded] = useState(!drawingContext.drawingId);
  const captureRef = useRef(null);

  useEffect(() => {
    if (!drawingContext.drawingId) return;
    let cancelled = false;
    api.getFrameDrawing(drawingContext.drawingId)
      .then((drawing) => {
        if (cancelled) return;
        if (drawing?.frameConfig) {
          setParams((prev) => ({ ...prev, ...drawing.frameConfig }));
        }
        setContextLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setContextLoaded(true);
      });
    return () => { cancelled = true; };
  }, [drawingContext.drawingId]);

  const geom = useMemo(() => calculateFrameGeometry(params), [params]);
  const hasErrors = geom.validationErrors && geom.validationErrors.length > 0;
  const geomOk = !hasErrors && geom.posts;

  const cutList = useMemo(() => (geomOk ? generateCutList(params) : []), [params, geomOk]);
  const crabs = useMemo(
    () => (params.connectionType === 'crab' && geomOk ? countConnectorsByType(geom.connectors) : null),
    [params.connectionType, geomOk, geom.connectors],
  );

  const dims = geomOk ? geom.dimensions : null;
  const showSaveTarget = hasFrameDrawingSaveTarget(drawingContext);
  const bindingLabel = frameDrawingBindingLabel(drawingContext);
  const saveHint = frameDrawingSaveHint(drawingContext);

  return (
    <div className="page frame-constructor-page">
      <div className="fc-page-head">
        <PageHeader
          title="Конструктор каркасов"
          sub="Проектирование стеллажей из профильной трубы"
          actions={geomOk ? (
            <FramePdfButton
              params={params}
              geom={geom}
              captureRef={captureRef}
              drawingContext={drawingContext}
            />
          ) : null}
        />
      </div>

      {showSaveTarget && (
        <div className="fc-alert fc-alert--info" role="status">
          {drawingContext.projectName && (
            <div><strong>Проект:</strong> {drawingContext.projectName}</div>
          )}
          {bindingLabel && <div><strong>Привязка:</strong> {bindingLabel}</div>}
          {saveHint && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{saveHint}</div>}
          {drawingContext.mode === 'new_version' && (
            <div style={{ fontSize: 12, marginTop: 4 }}>Будет создана новая версия схемы.</div>
          )}
          {drawingContext.mode === 'replace' && (
            <div style={{ fontSize: 12, marginTop: 4 }}>Текущий PDF будет заменён.</div>
          )}
          {drawingContext.returnTo && (
            <div style={{ marginTop: 6 }}>
              <Link to={drawingContext.returnTo}>← Вернуться</Link>
            </div>
          )}
        </div>
      )}

      {!contextLoaded && (
        <div className="fc-alert" role="status">Загрузка чертежа…</div>
      )}

      {hasErrors && (
        <div className="fc-alert fc-alert--error" role="alert">
          <h4>Ошибка построения геометрии</h4>
          <ul>
            {geom.validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {geomOk && dims && (
        <div className="fc-stats" aria-label="Сводка каркаса">
          <div className="fc-stat">
            <span className="fc-stat__label">Габарит</span>
            <span className="fc-stat__value">
              {Math.round(dims.lengthMm)} × {Math.round(dims.depthMm)} × {Math.round(dims.postHeight)} мм
            </span>
          </div>
          <div className="fc-stat">
            <span className="fc-stat__label">Ярусы</span>
            <span className="fc-stat__value">{params.tierCount} · шаг {params.tierSpacingMm} мм</span>
          </div>
          <div className="fc-stat">
            <span className="fc-stat__label">Сетка стоек</span>
            <span className="fc-stat__value">
              {params.postCountX} × {params.postCountY}
            </span>
          </div>
          <div className="fc-stat">
            <span className="fc-stat__label">Тип</span>
            <span className="fc-stat__value">{RACK_TYPE_LABELS[params.rackType] || params.rackType}</span>
          </div>
          {crabs && (
            <div className="fc-stat">
              <span className="fc-stat__label">Крабы</span>
              <span className="fc-stat__value">
                Г {crabs.G} · T {crabs.T} · X {crabs.X}
              </span>
            </div>
          )}
          {cutList.length > 0 && (
            <div className="fc-stat">
              <span className="fc-stat__label">Позиций реза</span>
              <span className="fc-stat__value">{cutList.length}</span>
            </div>
          )}
        </div>
      )}

      <div className="fc-workspace">
        <aside className="fc-sidebar">
          <FrameForm params={params} onChange={setParams} />
        </aside>

        <div className="fc-viewer-wrap">
          <Frame3DView params={params} geom={geom} captureRef={captureRef} hasErrors={hasErrors} />
        </div>
      </div>

      {geomOk && (
        <section className="fc-panel" aria-label="Чертежи и спецификация">
          <div className="fc-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'drawings'}
              className={`fc-tabs__btn${activeTab === 'drawings' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('drawings')}
            >
              Чертежи 2D
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'cutlist'}
              className={`fc-tabs__btn${activeTab === 'cutlist' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('cutlist')}
            >
              Спецификация реза
            </button>
          </div>
          <div className="fc-panel__body">
            {activeTab === 'drawings' ? (
              <FrameDrawings2D params={params} geom={geom} />
            ) : (
              <FrameCutList params={params} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
