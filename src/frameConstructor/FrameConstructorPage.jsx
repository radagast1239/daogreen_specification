import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout.jsx';
import FrameForm from './FrameForm.jsx';
import Frame3DView from './Frame3DView.jsx';
import FrameDrawings2D from './FrameDrawings2D.jsx';
import FrameCutList from './FrameCutList.jsx';
import FrameCrabGallery from './FrameCrabGallery.jsx';
import FrameCrabAudit from './FrameCrabAudit.jsx';
import FramePdfButton from './FramePdfButton.jsx';
import { framePresets } from './framePresets.js';
import { calculateFrameGeometry } from './frameGeometry.js';
import { generateCutList } from './frameCutList.js';
import { countConnectorsByType } from './frameCrabRules.js';
import { extractTubeCutsFromCutList, calculateTubeStockOptions } from './frameTubeStock.js';
import { calculateAngleStockOptions, calculateAngleFastenerVariants } from './frameAngleStock.js';
import { buildFramePurchaseDraftFromContext } from './frameBomPurchasePreviewData.js';
import {
  parseFrameDrawingSearchParams,
  hasFrameDrawingSaveTarget,
  frameDrawingBindingLabel,
  frameDrawingSaveHint,
  buildStellagesReturnLabel,
} from '../../shared/frameDrawingContext.js';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import {
  requestFrameBomAddConfirmation,
  applyFrameBomProjectAdd,
} from './frameBomAddToProject.js';
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
  const { confirm } = useToast();
  const drawingContext = useMemo(
    () => parseFrameDrawingSearchParams(searchParams),
    [searchParams],
  );

  const [params, setParams] = useState(framePresets[0].params);
  const [activeTab, setActiveTab] = useState(() => {
    const tab = drawingContext.constructorTab;
    return tab === 'cutlist' ? 'cutlist' : 'drawings';
  });
  const [contextLoaded, setContextLoaded] = useState(!drawingContext.drawingId);
  const [project, setProject] = useState(null);
  const [materials, setMaterials] = useState(null);
  const [bomAddSaving, setBomAddSaving] = useState(false);
  const [bomAddResult, setBomAddResult] = useState(null);
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

  useEffect(() => {
    if (!drawingContext.projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;
    api.getProject(drawingContext.projectId)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch(() => {
        if (!cancelled) setProject(null);
      });
    return () => { cancelled = true; };
  }, [drawingContext.projectId]);

  useEffect(() => {
    let cancelled = false;
    api.getMaterials()
      .then((rows) => {
        if (!cancelled) setMaterials(rows);
      })
      .catch(() => {
        if (!cancelled) setMaterials(null);
      });
    return () => { cancelled = true; };
  }, []);

  const handleAddFrameBomToProject = async (purchaseDraft) => {
    if (!drawingContext.projectId || !project?.items) return;
    try {
      const { ok } = await requestFrameBomAddConfirmation({
        project,
        purchaseDraft,
        drawingContext: { ...drawingContext, projectId: drawingContext.projectId },
        confirm,
      });
      if (!ok) return;

      setBomAddSaving(true);
      const outcome = await applyFrameBomProjectAdd({
        project,
        purchaseDraft,
        drawingContext: { ...drawingContext, projectId: drawingContext.projectId },
        updateProject: api.updateProject,
      });
      if (outcome.skipped) return;
      setProject(outcome.updated);
      setBomAddResult({
        success: true,
        ...outcome.summary,
      });
    } catch (err) {
      setBomAddResult({
        success: false,
        error: err?.message || 'Не удалось обновить закупочный лист проекта.',
      });
    } finally {
      setBomAddSaving(false);
    }
  };

  const geom = useMemo(() => calculateFrameGeometry(params), [params]);
  const hasErrors = geom.validationErrors && geom.validationErrors.length > 0;
  const geomOk = !hasErrors && geom.posts;

  const cutList = useMemo(() => (geomOk ? generateCutList(params) : []), [params, geomOk]);
  const isAngle = params.constructionType === 'perforated_angle';
  const angleGeom = useMemo(
    () => (isAngle && geomOk ? calculateFrameGeometry(params) : null),
    [params, isAngle, geomOk],
  );
  const stockOptions = useMemo(() => {
    if (!cutList.length) return null;
    if (isAngle) {
      return calculateAngleStockOptions(cutList, { overlapMm: params.angleOverlapMm });
    }
    const cuts = extractTubeCutsFromCutList(cutList);
    return calculateTubeStockOptions(cuts);
  }, [cutList, isAngle, params.angleOverlapMm]);

  const purchaseDraft = useMemo(
    () =>
      buildFramePurchaseDraftFromContext({
        params,
        cutList,
        geom: isAngle ? angleGeom : geomOk ? geom : null,
        stockOptions,
      }),
    [params, cutList, angleGeom, geom, isAngle, geomOk, stockOptions],
  );

  const crabs = useMemo(
    () => (!isAngle && params.connectionType === 'crab' && geomOk ? countConnectorsByType(geom.connectors) : null),
    [isAngle, params.connectionType, geomOk, geom.connectors],
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
          sub="Проектирование стеллажей из профильной трубы или перфоуголка"
          actions={geomOk ? (
            <FramePdfButton
              params={params}
              geom={geom}
              captureRef={captureRef}
              drawingContext={drawingContext}
              purchaseDraft={purchaseDraft}
              project={project}
              materials={materials}
              onProjectUpdated={setProject}
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
          {drawingContext.returnTo && drawingContext.projectId && (
            <div style={{ marginTop: 6 }}>
              <Link to={drawingContext.returnTo}>
                ← {buildStellagesReturnLabel(drawingContext.returnTo)}
              </Link>
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
                {crabs.A4 > 0 ? ` · 4× ${crabs.A4}` : ''}
                {crabs.A6 > 0 ? ` · 6× ${crabs.A6}` : ''}
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

      {geomOk && params.connectionType === 'crab' && !isAngle && (
        <FrameCrabGallery counts={crabs} />
      )}

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
            {!isAngle && params.connectionType === 'crab' && (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'crabs'}
                className={`fc-tabs__btn${activeTab === 'crabs' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('crabs')}
              >
                Схема крабов
              </button>
            )}
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
            {activeTab === 'drawings' && (
              <FrameDrawings2D params={params} geom={geom} />
            )}
            {activeTab === 'crabs' && !isAngle && params.connectionType === 'crab' && (
              <FrameCrabAudit
                key={`crab-${params.postCountX}x${params.postCountY}-${params.tierCount}`}
                params={params}
                geom={geom}
                cutList={cutList}
                onParamsChange={setParams}
              />
            )}
            {activeTab === 'cutlist' && (
              <FrameCutList
                params={params}
                drawingContext={drawingContext}
                project={project}
                materials={materials}
                onAddFrameBomToProject={handleAddFrameBomToProject}
                bomAddSaving={bomAddSaving}
                bomAddResult={bomAddResult}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
