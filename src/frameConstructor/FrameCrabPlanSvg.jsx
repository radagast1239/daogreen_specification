import React from 'react';
import { CRAB_CHIP_COLORS } from './frameCrabAudit.js';
import { crabCatalogByKey } from './frameCrabCatalog.js';

const CRAB_LABELS = { G: 'Г', T: 'T', X: 'X', A4: '4', A6: '6' };

/**
 * Схематичный план стоек сверху для выбранного уровня.
 * @param {{ grid: object[][], postCountX: number, postCountY: number, isTop?: boolean }} props
 */
export default function FrameCrabPlanSvg({
  grid,
  postCountX,
  postCountY,
  isTop = false,
  onCellClick = null,
  selectedPx = null,
  selectedPy = null,
}) {
  const cellSize = 56;
  const pad = 28;
  const labelW = 22;
  const labelH = 18;
  const w = labelW + pad * 2 + postCountX * cellSize;
  const h = labelH + pad * 2 + postCountY * cellSize;

  return (
    <svg
      className="fc-crab-plan"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="План расстановки крабов на стойках"
    >
      <rect
        x={labelW}
        y={labelH}
        width={w - labelW}
        height={h - labelH}
        rx={8}
        className="fc-crab-plan__bg"
      />

      {Array.from({ length: postCountX }, (_, px) => (
        <text
          key={`x-${px}`}
          x={labelW + pad + px * cellSize + cellSize / 2}
          y={labelH / 2 + 4}
          textAnchor="middle"
          className="fc-crab-plan__axis"
        >
          X{px + 1}
        </text>
      ))}

      {grid.map((row, py) => (
        <g key={`row-${py}`}>
          <text
            x={labelW / 2 + 2}
            y={labelH + pad + py * cellSize + cellSize / 2 + 4}
            textAnchor="middle"
            className="fc-crab-plan__axis"
          >
            Y{py + 1}
          </text>
          {row.map((gridCell, px) => {
            const cx = labelW + pad + px * cellSize + cellSize / 2;
            const cy = labelH + pad + py * cellSize + cellSize / 2;
            const r = cellSize * 0.22;
            const badgeCount = gridCell.badges.length;
            const badgeR = Math.min(11, cellSize * 0.16);

            const isSelected = selectedPx === px && selectedPy === py;
            const hitSize = cellSize - 6;
            const hitX = cx - hitSize / 2;
            const hitY = cy - hitSize / 2;

            return (
              <g
                key={`${px}-${py}`}
                className={[
                  'fc-crab-plan__post',
                  gridCell.isCorner ? 'is-corner' : '',
                  isTop && gridCell.isCorner ? 'is-top-corner' : '',
                  gridCell.isOverride ? 'is-override' : '',
                  isSelected ? 'is-selected' : '',
                ].filter(Boolean).join(' ')}
              >
                {onCellClick && (
                  <rect
                    x={hitX}
                    y={hitY}
                    width={hitSize}
                    height={hitSize}
                    fill="transparent"
                    className="fc-crab-plan__hit"
                    style={{ cursor: 'pointer' }}
                    onClick={() => onCellClick(gridCell)}
                  />
                )}
                {gridCell.isCorner && (
                  <rect
                    x={cx - cellSize / 2 + 4}
                    y={cy - cellSize / 2 + 4}
                    width={cellSize - 8}
                    height={cellSize - 8}
                    rx={6}
                    className="fc-crab-plan__corner-ring"
                  />
                )}
                <rect
                  x={cx - r}
                  y={cy - r}
                  width={r * 2}
                  height={r * 2}
                  rx={3}
                  className="fc-crab-plan__post-body"
                />
                {gridCell.badges.map((badge, bi) => {
                  const angle = badgeCount === 1
                    ? -Math.PI / 2
                    : (bi / badgeCount) * Math.PI * 2 - Math.PI / 2;
                  const dist = badgeCount > 1 ? cellSize * 0.28 : 0;
                  const bx = cx + Math.cos(angle) * dist;
                  const by = cy + Math.sin(angle) * dist;
                  const fill = CRAB_CHIP_COLORS[badge.type] || '#999';
                  const label = badge.count > 1
                    ? `${CRAB_LABELS[badge.type] || badge.type}×${badge.count}`
                    : (CRAB_LABELS[badge.type] || badge.type);
                  return (
                    <g key={`${badge.type}-${bi}`}>
                      <circle
                        cx={bx}
                        cy={by}
                        r={badgeR}
                        fill={fill}
                        stroke="#333"
                        strokeWidth={0.8}
                      />
                      <text
                        x={bx}
                        y={by + 3.5}
                        textAnchor="middle"
                        className="fc-crab-plan__badge-label"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
                {!gridCell.badges.length && (
                  <text x={cx} y={cy + 3} textAnchor="middle" className="fc-crab-plan__empty">—</text>
                )}
              </g>
            );
          })}
        </g>
      ))}

      <text x={labelW + pad} y={h - 6} className="fc-crab-plan__hint">
        ← длина (X) · глубина (Y) ↓
      </text>
    </svg>
  );
}

export function CrabLegendBar({ totals }) {
  return (
    <div className="fc-crab-plan-legend">
      {['G', 'T', 'X', 'A4', 'A6'].map((type) => {
        if (!totals?.[type]) return null;
        const catalog = crabCatalogByKey(type);
        return (
          <span key={type} className="fc-crab-plan-legend__item">
            <span
              className="fc-crab-plan-legend__dot"
              style={{ backgroundColor: CRAB_CHIP_COLORS[type] }}
            />
            <span>{catalog?.shortLabel ?? type}</span>
            <span className="fc-crab-plan-legend__name">{catalog?.label}</span>
          </span>
        );
      })}
    </div>
  );
}
