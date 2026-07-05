import React, { useMemo } from 'react';
import { generateCutList } from './frameCutList.js';

export default function FrameCutList({ params }) {
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
            <th>Позиция</th>
            <th>Профиль</th>
            <th>Длина, мм</th>
            <th>Кол-во</th>
            <th>Рез</th>
            <th>Примечание</th>
          </tr>
        </thead>
        <tbody>
          {cutList.map((item, idx) => (
            <tr key={idx}>
              <td>{item.name}</td>
              <td>{item.profile}</td>
              <td>{item.length}</td>
              <td>{item.qty}</td>
              <td>{item.id?.startsWith('nft-channel') ? '—' : (item.cut ?? '—')}</td>
              <td>{item.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
