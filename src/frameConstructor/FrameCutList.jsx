import React, { useMemo } from 'react';
import { generateCutList } from './frameCutList.js';
import { calculateFrameGeometry } from './frameGeometry.js';
import { crabCatalogByConnectorId } from './frameCrabCatalog.js';
import { resolveCrabImageSrc } from './frameCrabPhotos.js';
import { useCrabPhotoVersion } from './useCrabPhotoVersion.js';
import { extractTubeCutsFromCutList, calculateTubeStockOptions } from './frameTubeStock.js';
import { calculateAngleStockOptions, calculateAngleFastenerVariants, perforatedAngleProfileLabel } from './frameAngleStock.js';
import FrameBomPurchasePreview from './FrameBomPurchasePreview.jsx';
import { buildFramePurchaseDraftFromContext } from './frameBomPurchasePreviewData.js';
import { evaluateFrameBomAddToProject } from './frameBomAddToProject.js';

function renderFastenerBlock(title, fasteners, profile) {
  const rows = [
    fasteners.fasteningAngles > 0 && ['Крепёжный уголок', profile, fasteners.fasteningAngles],
    fasteners.boltsM6x20 > 0 && ['Болт М6×20', 'М6', fasteners.boltsM6x20],
    fasteners.nutsM6 > 0 && ['Гайка М6', 'М6', fasteners.nutsM6],
    fasteners.growersM6 > 0 && ['Гровер М6', 'М6', fasteners.growersM6],
    fasteners.footPlates > 0 && ['Подпятник пластиковый', profile, fasteners.footPlates],
  ].filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <div key={title} style={{ marginTop: '16px' }}>
      <h5 style={{ margin: '0 0 8px' }}>{title}</h5>
      <div className="table-responsive">
        <table style={{ width: '100%', fontSize: '0.85em', background: '#fff' }}>
          <thead>
            <tr>
              <th>Позиция</th>
              <th>Профиль</th>
              <th>Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, prof, qty]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{prof}</td>
                <td>{qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FrameCutList({
  params,
  drawingContext = {},
  project = null,
  materials = null,
  onAddFrameBomToProject = null,
  bomAddSaving = false,
  bomAddResult = null,
}) {
  useCrabPhotoVersion();
  const cutList = useMemo(() => generateCutList(params), [params]);

  const isAngle = params.constructionType === 'perforated_angle';

  const geom = useMemo(() => (isAngle ? calculateFrameGeometry(params) : null), [params, isAngle]);

  const stockOptions = useMemo(() => {
    if (!cutList || cutList.length === 0) return null;
    if (isAngle) {
      return calculateAngleStockOptions(cutList, { overlapMm: params.angleOverlapMm });
    } else {
      const cuts = extractTubeCutsFromCutList(cutList);
      return calculateTubeStockOptions(cuts);
    }
  }, [cutList, isAngle, params.angleOverlapMm]);

  const fastenerVariants = useMemo(() => {
    if (!isAngle || !geom || geom.validationErrors?.length) return null;
    return calculateAngleFastenerVariants(geom);
  }, [isAngle, geom]);

  const purchaseDraft = useMemo(
    () =>
      buildFramePurchaseDraftFromContext({
        params,
        cutList,
        geom: isAngle ? geom : null,
        stockOptions,
      }),
    [params, cutList, geom, isAngle, stockOptions],
  );

  const bomAddEval = useMemo(
    () =>
      evaluateFrameBomAddToProject({
        projectId: drawingContext.projectId,
        project,
        purchaseDraft,
        drawingContext: {
          ...drawingContext,
          projectId: drawingContext.projectId,
        },
        materials,
      }),
    [drawingContext, project, purchaseDraft, materials],
  );

  if (cutList.length === 0) {
    return (
      <div className="fc-cutlist__empty">
        Спецификация недоступна из-за некорректных параметров каркаса.
      </div>
    );
  }

  const { recommended, options } = stockOptions || {};

  return (
    <>
      <div className="fc-cutlist table-responsive">
        <table>
          <thead>
            <tr>
              <th className="fc-cutlist__col-photo" />
              <th>Позиция</th>
              <th>Профиль</th>
              <th>Длина, мм</th>
              <th>Кол-во</th>
              <th>Рез</th>
              <th>Примечание</th>
            </tr>
          </thead>
          <tbody>
            {cutList.map((item, idx) => {
              const crab = item.id?.startsWith('connector-')
                ? crabCatalogByConnectorId(item.id)
                : null;
              return (
                <tr key={idx} className={crab ? 'fc-cutlist__row--crab' : undefined}>
                  <td className="fc-cutlist__photo">
                    {crab ? (
                      <img
                        src={resolveCrabImageSrc(crab)}
                        alt={crab.label}
                        className="fc-cutlist__thumb"
                        loading="lazy"
                      />
                    ) : (
                      <span className="fc-cutlist__photo-empty" aria-hidden>—</span>
                    )}
                  </td>
                  <td>{item.name}</td>
                  <td>{item.profile}</td>
                  <td>{item.length}</td>
                  <td>{item.qty}</td>
                  <td>{item.id?.startsWith('nft-channel') ? '—' : (item.cut ?? '—')}</td>
                  <td>{item.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {recommended && (
        <div className="fc-tube-stock" style={{ marginTop: '24px', padding: '16px', background: '#f8f9fa', borderRadius: '8px' }}>
          <h4 style={{ marginTop: 0, marginBottom: '12px' }}>
            {isAngle
              ? `Закупка: ${perforatedAngleProfileLabel(params.angleProfile)}`
              : `Закупка трубы (профиль ${params.tubeWidthMm}×${params.tubeHeightMm})`
            }
          </h4>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                Самый экономичный по отходу: {recommended.title}
              </div>
              <div style={{ marginBottom: '8px' }}>Варианты раскроя:</div>
              {options.map((opt, i) => (
                <div key={opt.key} style={{ marginBottom: '12px' }}>
                  <strong>
                    {isAngle ? (
                      <>
                        Вариант {i + 1} — если {opt.key === 'auto_2000_2500' ? 'можно закупить смешанно 2 м + 2.5 м' : opt.key === 'only_2500' ? 'есть уголок 2.5 м' : 'есть только уголок 2 м'}:
                      </>
                    ) : (
                      <>
                        Вариант {i + 1} — если {opt.key === 'mixed_3000_6000' ? 'можно закупить смешанно 3 м + 6 м' : opt.key === 'only_6000' ? 'есть труба 6 м' : 'есть только труба 3 м'}:
                      </>
                    )}
                  </strong>
                  <div>
                    {isAngle ? (
                      <>
                        {opt.stockCounts[2500] > 0 && `2.5 м — ${opt.stockCounts[2500]} шт`}
                        {opt.stockCounts[2500] > 0 && opt.stockCounts[2000] > 0 && <br />}
                        {opt.stockCounts[2000] > 0 && `2 м — ${opt.stockCounts[2000]} шт`}
                        {(opt.stockCounts[2500] === 0 && opt.stockCounts[2000] === 0) && '0 шт'}
                      </>
                    ) : (
                      <>
                        {opt.stockCounts[6000] > 0 && `6 м — ${opt.stockCounts[6000]} шт`}
                        {opt.stockCounts[6000] > 0 && opt.stockCounts[3000] > 0 && <br />}
                        {opt.stockCounts[3000] > 0 && `3 м — ${opt.stockCounts[3000]} шт`}
                        {(opt.stockCounts[6000] === 0 && opt.stockCounts[3000] === 0) && '0 шт'}
                      </>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: '0.9em', marginTop: '4px' }}>
                    {isAngle ? (
                      <>
                        Чистый рез — {(opt.cleanCutLengthMm / 1000).toFixed(1)} м<br />
                        Нахлёсты — {(opt.totalSpliceCount || 0) > 0
                          ? `${opt.totalSpliceCount} шт (+${(opt.overlapMaterialMm / 1000).toFixed(1)} м)`
                          : 'не требуются'}<br />
                        Рез с нахлёстом — {(opt.requiredCutLengthMm / 1000).toFixed(1)} м<br />
                        Закупить — {(opt.totalStockLengthMm / 1000).toFixed(1)} м<br />
                        Остаток — {(opt.wasteMm / 1000).toFixed(1)} м<br />
                        Использование — {(opt.utilizationRatio * 100).toFixed(1)}%
                      </>
                    ) : (
                      <>
                        Закупить — {(opt.totalStockLengthMm / 1000).toFixed(1)} м<br />
                        Суммарный рез — {(opt.totalCutLengthMm / 1000).toFixed(1)} м<br />
                        Остаток — {(opt.wasteMm / 1000).toFixed(1)} м<br />
                        Использование — {(opt.utilizationRatio * 100).toFixed(1)}%
                      </>
                    )}
                  </div>
                  {opt.warnings.length > 0 && (
                    <div style={{ color: '#d32f2f', marginTop: '4px', fontSize: '0.9em', fontWeight: '500' }}>
                      {opt.warnings.map((w, wi) => <div key={wi}>{w}</div>)}
                    </div>
                  )}
                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: '500', fontSize: '0.9em' }}>Детальный раскрой ({opt.title})</summary>
                    <div className="table-responsive" style={{ marginTop: '8px' }}>
                      <table style={{ width: '100%', fontSize: '0.85em', background: '#fff' }}>
                        <thead>
                          <tr>
                            <th>№</th>
                            <th>{isAngle ? 'Уголок, мм' : 'Труба, мм'}</th>
                            <th>Резы, мм</th>
                            <th>Занято</th>
                            <th>Остаток</th>
                          </tr>
                        </thead>
                        <tbody>
                          {opt.bars.map((bar, bi) => (
                            <tr key={bi}>
                              <td>{bi + 1}</td>
                              <td>{bar.lengthMm}</td>
                              <td>{bar.cuts.map(c => c.lengthMm).join(' + ')}</td>
                              <td>{bar.usedMm}</td>
                              <td>{bar.lengthMm - bar.usedMm}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isAngle && fastenerVariants && (
        <div className="fc-tube-stock" style={{ marginTop: '16px', padding: '16px', background: '#f8f9fa', borderRadius: '8px' }}>
          <h4 style={{ marginTop: 0, marginBottom: '8px' }}>Крепёж</h4>
          {renderFastenerBlock(
            'Вариант А — поперечины без крепёжных уголков',
            fastenerVariants.variantA,
            params.angleProfile || '30×30',
          )}
          {renderFastenerBlock(
            'Вариант Б — поперечины с крепёжными уголками',
            fastenerVariants.variantB,
            params.angleProfile || '30×30',
          )}
          <p className="muted" style={{ fontSize: '0.85em', marginTop: '12px', marginBottom: 0 }}>
            Рекомендация: для жёсткости можно использовать крепёжные уголки на поперечинах.
            Если нагрузка небольшая, допускается крепление поперечин только болт + гайка с двух сторон.
          </p>
        </div>
      )}

      <FrameBomPurchasePreview
        purchaseDraft={purchaseDraft}
        constructionType={params.constructionType || 'tube_crab'}
        stockRecommended={recommended}
        canAddToProject={bomAddEval.canAddToProject}
        addDisabledReason={bomAddEval.addDisabledReason}
        addWarnings={bomAddEval.warnings}
        onAddToProject={
          drawingContext.projectId && onAddFrameBomToProject
            ? () => onAddFrameBomToProject(purchaseDraft)
            : null
        }
        isSaving={bomAddSaving}
        lastResult={bomAddResult}
      />
    </>
  );
}
