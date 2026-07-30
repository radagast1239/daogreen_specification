import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { generateCutList } from './frameCutList.js';
import { canExportFramePdf, exportFrameToPdf } from './framePdfExport.js';
import { exportFrameToPdfBlob } from './framePdfExport.js';
import { buildFramePdfFilename } from './framePdfData.js';
import {
  buildFrameDrawingSavePayload,
  normalizeFrameSourceType,
  FRAME_SOURCE_MODULE_RACK,
  FRAME_SOURCE_PRESET,
  buildStellagesReturnLabel,
  resolveFramePdfExportUi,
  STANDALONE_FRAME_SAVE_HINT,
} from '../../shared/frameDrawingContext.js';
import {
  evaluateFrameSavePdfAndBom,
  executeFrameSavePdfAndBom,
  FRAME_SAVE_PDF_AND_BOM_BUTTON_LABEL,
  FRAME_SAVE_PDF_ONLY_BUTTON_LABEL,
} from './frameBomAddToProject.js';
import { buildClientBrand } from '../lib/clientBrandConfig.js';
import { api, photoSrc } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useStore } from '../store/StoreContext.jsx';

function saveButtonLabel(ctx, pdfOnlyMode = false) {
  if (pdfOnlyMode) return FRAME_SAVE_PDF_ONLY_BUTTON_LABEL;
  const src = normalizeFrameSourceType(ctx?.sourceType);
  if (src === FRAME_SOURCE_PRESET) return 'Сохранить PDF к пресету';
  if (src === FRAME_SOURCE_MODULE_RACK && !ctx?.projectId) return 'Сохранить PDF к модулю';
  if (ctx?.projectId) return 'Сохранить PDF в проект';
  return 'Сохранить PDF';
}

export default function FramePdfButton({
  params,
  geom,
  captureRef,
  drawingContext,
  onSaved,
  purchaseDraft = [],
  project = null,
  materials = null,
  onProjectUpdated = null,
}) {
  const { confirm } = useToast();
  const { actions } = useStore();
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [comboBusy, setComboBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedDrawing, setSavedDrawing] = useState(null);
  const [combinedResult, setCombinedResult] = useState(null);
  const [branding, setBranding] = useState(() => buildClientBrand({}));

  useEffect(() => {
    let cancelled = false;
    api.getSettings()
      .then((settings) => {
        if (!cancelled) setBranding(buildClientBrand(settings));
      })
      .catch(() => {
        if (!cancelled) setBranding(buildClientBrand({}));
      });
    return () => { cancelled = true; };
  }, []);

  const comboEval = useMemo(
    () => evaluateFrameSavePdfAndBom({
      projectId: drawingContext?.projectId,
      project,
      purchaseDraft,
      drawingContext,
      materials,
    }),
    [drawingContext, project, purchaseDraft, materials],
  );

  const exportUi = useMemo(
    () => resolveFramePdfExportUi(drawingContext, comboEval),
    [drawingContext, comboEval],
  );

  const disabled = !canExportFramePdf(geom) || busy || saveBusy || comboBusy;
  const isReplaceMode = drawingContext?.mode === 'replace' && drawingContext?.drawingId;
  const isNewVersionMode = drawingContext?.mode === 'new_version';
  const canSave = exportUi.showSavePdfButton;
  const showComboButton = exportUi.showComboButton;
  const showPdfOnlyAsSecondary = showComboButton;

  const buildPdfPayload = useCallback(async () => {
    const cutList = generateCutList(params);
    let isoImageDataUrl = null;
    if (captureRef?.current?.captureIso) {
      try {
        isoImageDataUrl = await captureRef.current.captureIso();
      } catch {
        isoImageDataUrl = null;
      }
    }
    return { config: params, geometry: geom, cutList, isoImageDataUrl, branding };
  }, [params, geom, captureRef, branding]);

  const performSavePdf = useCallback(async (replace = false) => {
    const payload = await buildPdfPayload();
    const { blob, filename } = await exportFrameToPdfBlob(payload);
    const savePayload = buildFrameDrawingSavePayload(params, drawingContext, {
      replace: replace && !isNewVersionMode,
      drawingId: isNewVersionMode ? null : (replace ? drawingContext.drawingId : drawingContext.drawingId || null),
    });
    savePayload.pdfFilename = filename || buildFramePdfFilename(params);
    const result = await api.uploadFrameDrawing(
      {
        projectId: savePayload.projectId,
        moduleId: savePayload.moduleId,
        stellageId: savePayload.stellageId,
        moduleRackKey: savePayload.moduleRackKey,
        presetId: savePayload.presetId,
        sourceType: savePayload.sourceType,
        title: savePayload.title,
        rackType: savePayload.rackType,
        frameConfigJson: savePayload.frameConfigJson,
        isClientVisible: savePayload.isClientVisible,
        drawingId: replace ? drawingContext.drawingId : null,
        pdfFilename: savePayload.pdfFilename,
      },
      blob,
      savePayload.pdfFilename,
      replace && !isNewVersionMode,
    );
    setSavedDrawing(result);
    onSaved?.(result);
    return result;
  }, [buildPdfPayload, params, drawingContext, isNewVersionMode, onSaved]);

  const handleExport = useCallback(async () => {
    if (!canExportFramePdf(geom)) {
      setError('Исправьте ошибки параметров перед экспортом PDF.');
      return;
    }
    setBusy(true);
    setError('');
    setCombinedResult(null);
    try {
      const payload = await buildPdfPayload();
      await exportFrameToPdf(payload);
    } catch (err) {
      setError(err?.message || 'Не удалось сформировать PDF.');
    } finally {
      setBusy(false);
    }
  }, [geom, buildPdfPayload]);

  const handleSave = useCallback(async (replace = false) => {
    if (!canExportFramePdf(geom) || !drawingContext) return;
    setSaveBusy(true);
    setError('');
    setCombinedResult(null);
    try {
      await performSavePdf(replace);
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить PDF.');
    } finally {
      setSaveBusy(false);
    }
  }, [geom, drawingContext, performSavePdf]);

  const handleSavePdfAndBom = useCallback(async () => {
    if (!canExportFramePdf(geom) || !drawingContext?.projectId || !project?.items) return;
    setComboBusy(true);
    setError('');
    setCombinedResult(null);
    try {
      let catalog = materials;
      if (!catalog?.length) {
        catalog = await api.getMaterials();
      }
      if (!catalog?.length) {
        throw new Error('Не удалось загрузить базу материалов для BOM.');
      }
      const outcome = await executeFrameSavePdfAndBom({
        confirm,
        savePdf: () => performSavePdf(isReplaceMode),
        project,
        purchaseDraft,
        drawingContext: { ...drawingContext, projectId: drawingContext.projectId },
        updateProject: (id, patch) => actions.projectUpdate(id, patch),
        materials: catalog,
      });
      if (outcome.cancelled) return;
      if (outcome.skipped) return;
      onProjectUpdated?.(outcome.updated);
      setCombinedResult(outcome.combinedSummary);
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить чертёж и BOM.');
    } finally {
      setComboBusy(false);
    }
  }, [
    geom,
    drawingContext,
    project,
    purchaseDraft,
    confirm,
    performSavePdf,
    isReplaceMode,
    onProjectUpdated,
    actions,
    materials,
  ]);

  const returnLabel = buildStellagesReturnLabel(drawingContext?.returnTo);
  const successDrawing = savedDrawing;

  return (
    <div className="fc-export">
      {showComboButton && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSavePdfAndBom}
          disabled={disabled}
          title={FRAME_SAVE_PDF_AND_BOM_BUTTON_LABEL}
        >
          {comboBusy ? 'Сохранение…' : FRAME_SAVE_PDF_AND_BOM_BUTTON_LABEL}
        </button>
      )}
      {canSave && (
        <button
          type="button"
          className={`btn ${showPdfOnlyAsSecondary ? 'btn-outline' : 'btn-primary'}`}
          onClick={() => handleSave(isReplaceMode)}
          disabled={disabled}
          title={isReplaceMode ? 'Заменить существующий PDF' : 'Сохранить PDF'}
        >
          {saveBusy
            ? 'Сохранение…'
            : isReplaceMode
              ? 'Заменить PDF'
              : isNewVersionMode
                ? 'Сохранить новую версию'
                : saveButtonLabel(drawingContext, showPdfOnlyAsSecondary)}
        </button>
      )}
      <button
        type="button"
        className={`btn ${canSave ? 'btn-outline' : 'btn-primary'}`}
        onClick={handleExport}
        disabled={disabled}
        title={disabled && !busy ? 'Экспорт недоступен при ошибках геометрии' : 'Скачать PDF сборочного чертежа'}
      >
        {busy ? 'Формирование PDF…' : 'Скачать PDF'}
      </button>
      {exportUi.showStandaloneSaveHint && (
        <p className="fc-export__hint muted" style={{ fontSize: 12, margin: '6px 0 0', width: '100%' }}>
          {STANDALONE_FRAME_SAVE_HINT}
        </p>
      )}
      {canSave && drawingContext?.projectId && !comboEval.canSavePdfAndBom && comboEval.addDisabledReason && (
        <p className="fc-export__hint muted" style={{ fontSize: 12, margin: '6px 0 0', width: '100%' }}>
          {comboEval.addDisabledReason}
        </p>
      )}
      {combinedResult && (
        <span className="fc-export__ok">
          <strong>{combinedResult.title}</strong>
          {' '}
          <span className="muted">{combinedResult.detail}</span>
          {successDrawing && (
            <>
              {' · '}
              <a href={photoSrc(successDrawing.pdfUrl)} target="_blank" rel="noreferrer">Открыть PDF</a>
            </>
          )}
          {(exportUi.showReturnToProjectSetup || exportUi.showReturnToStellages) && (
            <>
              {' · '}
              <Link to={drawingContext.returnTo}>{returnLabel}</Link>
            </>
          )}
        </span>
      )}
      {!combinedResult && successDrawing && (
        <span className="fc-export__ok">
          {successDrawing.isNewVersion ? 'Новая версия сохранена. ' : 'Чертёж сохранён. '}
          <a href={photoSrc(successDrawing.pdfUrl)} target="_blank" rel="noreferrer">Открыть PDF</a>
          {exportUi.showReturnToStellages && (
            <> · <Link to={drawingContext.returnTo}>{returnLabel}</Link></>
          )}
        </span>
      )}
      {error && <span className="fc-export__error">{error}</span>}
    </div>
  );
}
