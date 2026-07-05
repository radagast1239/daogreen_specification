import React, { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { generateCutList } from './frameCutList.js';
import { canExportFramePdf, exportFrameToPdf } from './framePdfExport.js';
import { exportFrameToPdfBlob } from './framePdfExport.js';
import { buildFramePdfFilename } from './framePdfData.js';
import { buildFrameDrawingSavePayload, hasFrameDrawingSaveTarget } from '../../shared/frameDrawingContext.js';
import { api, photoSrc } from '../lib/api.js';

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
  const canSaveToProject = hasFrameDrawingSaveTarget(drawingContext);

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

  const handleSaveToProject = useCallback(async (replace = false) => {
    if (!canExportFramePdf(geom) || !drawingContext) return;
    setSaveBusy(true);
    setError('');
    try {
      const payload = await buildPdfPayload();
      const { blob, filename } = await exportFrameToPdfBlob(payload);
      const savePayload = buildFrameDrawingSavePayload(params, drawingContext, {
        replace,
        drawingId: drawingContext.drawingId,
      });
      savePayload.pdfFilename = filename || buildFramePdfFilename(params);
      const result = await api.uploadFrameDrawing(
        {
          projectId: savePayload.projectId,
          moduleId: savePayload.moduleId,
          stellageId: savePayload.stellageId,
          presetId: savePayload.presetId,
          sourceType: savePayload.sourceType,
          title: savePayload.title,
          rackType: savePayload.rackType,
          frameConfigJson: savePayload.frameConfigJson,
          isClientVisible: savePayload.isClientVisible,
          drawingId: savePayload.drawingId,
          pdfFilename: savePayload.pdfFilename,
        },
        blob,
        savePayload.pdfFilename,
        replace,
      );
      setSavedDrawing(result);
      onSaved?.(result);
    } catch (err) {
      if (err.status === 409 && err.data?.existing) {
        const ok = window.confirm(
          'Для этого стеллажа уже есть чертёж. Заменить существующий PDF?',
        );
        if (ok) {
          setSaveBusy(false);
          return handleSaveToProject(true);
        }
        setError('Сохранение отменено — чертёж уже существует.');
      } else {
        setError(err?.message || 'Не удалось сохранить PDF в проект.');
      }
    } finally {
      setSaveBusy(false);
    }
  }, [geom, drawingContext, params, buildPdfPayload, onSaved]);

  return (
    <div className="fc-export">
      {canSaveToProject && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => handleSaveToProject(false)}
          disabled={disabled}
          title="Сохранить PDF в документы проекта"
        >
          {saveBusy ? 'Сохранение…' : 'Сохранить PDF в проект'}
        </button>
      )}
      <button
        type="button"
        className={`btn ${canSaveToProject ? 'btn-outline' : 'btn-primary'}`}
        onClick={handleExport}
        disabled={disabled}
        title={disabled && !busy ? 'Экспорт недоступен при ошибках геометрии' : 'Скачать PDF сборочного чертежа'}
      >
        {busy ? 'Формирование PDF…' : 'Скачать PDF'}
      </button>
      {savedDrawing && (
        <span className="fc-export__ok">
          Чертёж сохранён.{' '}
          <a href={photoSrc(savedDrawing.pdfUrl)} target="_blank" rel="noreferrer">Открыть PDF</a>
          {drawingContext?.returnTo && (
            <> · <Link to={drawingContext.returnTo}>Вернуться в проект</Link></>
          )}
        </span>
      )}
      {error && <span className="fc-export__error">{error}</span>}
    </div>
  );
}
