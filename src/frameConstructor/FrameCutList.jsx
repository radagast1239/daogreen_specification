import React, { useMemo } from 'react';
import { generateCutList } from './frameCutList.js';
import { crabCatalogByConnectorId } from './frameCrabCatalog.js';
import { resolveCrabImageSrc } from './frameCrabPhotos.js';
import { useCrabPhotoVersion } from './useCrabPhotoVersion.js';

export default function FrameCutList({ params }) {
  useCrabPhotoVersion();
  const cutList = useMemo(() => generateCutList(params), [params]);

  if (cutList.length === 0) {
    return (
      <div className="fc-cutlist__empty">
        Спецификация недоступна из-за некорректных параметров каркаса.
      </div>
    );
  }

  return (
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
  );
}
