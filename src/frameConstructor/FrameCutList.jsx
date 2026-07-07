import React, { useMemo } from 'react';
import { generateCutList } from './frameCutList.js';
import { crabCatalogByConnectorId } from './frameCrabCatalog.js';
import { resolveCrabImageSrc } from './frameCrabPhotos.js';
import { useCrabPhotoVersion } from './useCrabPhotoVersion.js';
import { extractTubeCutsFromCutList, calculateTubeStockOptions } from './frameTubeStock.js';

export default function FrameCutList({ params }) {
  useCrabPhotoVersion();
  const cutList = useMemo(() => generateCutList(params), [params]);

  const stockOptions = useMemo(() => {
    if (!cutList || cutList.length === 0) return null;
    const cuts = extractTubeCutsFromCutList(cutList);
    return calculateTubeStockOptions(cuts);
  }, [cutList]);

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
          <h4 style={{ marginTop: 0, marginBottom: '12px' }}>Закупка трубы (профиль {params.tubeWidthMm}×{params.tubeHeightMm})</h4>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                Самый экономичный по отходу: {recommended.title}
              </div>
              <div style={{ marginBottom: '8px' }}>Варианты раскроя:</div>
              {options.map((opt, i) => (
                <div key={opt.key} style={{ marginBottom: '12px' }}>
                  <strong>Вариант {i + 1} — если {opt.key === 'mixed_3000_6000' ? 'можно закупить смешанно 3 м + 6 м' : opt.key === 'only_6000' ? 'есть труба 6 м' : 'есть только труба 3 м'}:</strong>
                  <div>
                    {opt.stockCounts[6000] > 0 && `6 м — ${opt.stockCounts[6000]} шт`}
                    {opt.stockCounts[6000] > 0 && opt.stockCounts[3000] > 0 && <br />}
                    {opt.stockCounts[3000] > 0 && `3 м — ${opt.stockCounts[3000]} шт`}
                    {(opt.stockCounts[6000] === 0 && opt.stockCounts[3000] === 0) && '0 шт'}
                  </div>
                  <div className="muted" style={{ fontSize: '0.9em', marginTop: '4px' }}>
                    Закупить — {(opt.totalStockLengthMm / 1000).toFixed(1)} м<br />
                    Суммарный рез — {(opt.totalCutLengthMm / 1000).toFixed(1)} м<br />
                    Остаток — {(opt.wasteMm / 1000).toFixed(1)} м<br />
                    Использование — {(opt.utilizationRatio * 100).toFixed(1)}%
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
                            <th>Труба, мм</th>
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
    </>
  );
}
