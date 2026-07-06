import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { generateCutList } from './frameCutList.js';
import { canExportFramePdf, exportFrameToPdf } from './framePdfExport.js';
import { exportFrameToPdfBlob } from './framePdfExport.js';
import { buildFramePdfFilename } from './framePdfData.js';
import {
  buildFrameDrawingSavePayload,
  hasFrameDrawingSaveTarget,
  normalizeFrameSourceType,
  FRAME_SOURCE_MODULE_RACK,
  FRAME_SOURCE_PRESET,
} from '../../shared/frameDrawingContext.js';
import { api, photoSrc } from '../lib/api.js';

function saveButtonLabel(ctx) {
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
}) {
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedDrawing, setSavedDrawing] = useState(null);

  const disabled = !canExportFramePdf(geom) || busy || saveBusy;
  const canSave = hasFrameDrawingSaveTarget(drawingContext);
  const isReplaceMode = drawingContext?.mode === 'replace' && drawingContext?.drawingId;
  const isNewVersionMode = drawingContext?.mode === 'new_version';

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
    return { config: params, geometry: geom, cutList, isoImageDataUrl };
  }, [params, geom, captureRef]);

  const handleExport = useCallback(async () => {
    if (!canExportFramePdf(geom)) {
      setError('Исправьте ошибки параметров перед экспортом PDF.');
      return;
    }
    setBusy(true);
    setError('');
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
    try {
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
      if (result.isNewVersion) {
        setError('');
      }
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить PDF.');
    } finally {
      setSaveBusy(false);
    }
  }, [geom, drawingContext, params, buildPdfPayload, onSaved, isNewVersionMode]);

  return (
    <div className="fc-export">
      {canSave && (
        <button
          type="button"
          className="btn btn-primary"
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
                : saveButtonLabel(drawingContext)}
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
      {savedDrawing && (
        <span className="fc-export__ok">
          {savedDrawing.isNewVersion ? 'Новая версия сохранена. ' : 'Чертёж сохранён. '}
          <a href={photoSrc(savedDrawing.pdfUrl)} target="_blank" rel="noreferrer">Открыть PDF</a>
          {drawingContext?.returnTo && (
            <> · <Link to={drawingContext.returnTo}>Вернуться</Link></>
          )}
        </span>
      )}
      {error && <span className="fc-export__error">{error}</span>}
    </div>
  );
}
