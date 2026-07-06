import React, { useMemo, useState } from 'react';
import { buildCrabAudit, CRAB_CHIP_COLORS } from './frameCrabAudit.js';
import { crabCatalogByKey } from './frameCrabCatalog.js';
import { CRAB_TIER_TOP } from './frameCrabOverrides.js';
import { defaultPostCrabCounts } from './frameCrabRules.js';
import {
  badgesToCrabCounts,
  setCrabPostOverride,
} from './frameCrabOverrides.js';
import FrameCrabPlanSvg, { CrabLegendBar } from './FrameCrabPlanSvg.jsx';
import FrameCrabCellEditor from './FrameCrabCellEditor.jsx';

function CrabChip({ type, count }) {
  const catalog = crabCatalogByKey(type);
  const label = catalog?.shortLabel ?? type;
  const text = count > 1 ? `${label}×${count}` : label;
  return (
    <span
      className={`fc-crab-chip fc-crab-chip--${type.toLowerCase()}`}
      style={{ backgroundColor: CRAB_CHIP_COLORS[type] }}
      title={catalog?.label ?? type}
    >
      {text}
    </span>
  );
}

function ComparisonRow({ row }) {
  const catalog = crabCatalogByKey(row.type);
  return (
    <tr className={row.match ? undefined : 'fc-crab-audit__row--warn'}>
      <td>
        <CrabChip type={row.type} count={1} />
        <span className="fc-crab-audit__type-name">{catalog?.label ?? row.type}</span>
      </td>
      <td className="fc-crab-audit__num">{row.geometrySets}</td>
      <td className="fc-crab-audit__num">{row.geometryPieces}</td>
      <td className="fc-crab-audit__num">{row.cutSets}</td>
      <td className="fc-crab-audit__num">{row.cutPieces}</td>
      <td className="fc-crab-audit__status">
        {row.match ? (
          <span className="fc-crab-audit__ok">✓</span>
        ) : (
          <span className="fc-crab-audit__warn">≠</span>
        )}
      </td>
    </tr>
  );
}

/**
 * @param {{ params: object, geom: object, cutList: object[], onParamsChange: (p: object) => void }} props
 */
export default function FrameCrabAudit({ params, geom, cutList, onParamsChange }) {
  const audit = useMemo(
    () => buildCrabAudit(params, geom, cutList),
    [params, geom, cutList],
  );

  const [editTierId, setEditTierId] = useState(CRAB_TIER_TOP);
  const [selected, setSelected] = useState(null);

  const tier = audit.tiers.find((t) => t.id === editTierId) || audit.tiers[0];

  const selectedCell = selected?.tierId === tier?.id
    ? tier?.grid[selected.py]?.[selected.px]
    : null;

  const handleCellClick = (cell) => {
    if (!tier) return;
    setSelected({ tierId: tier.id, px: cell.px, py: cell.py });
  };

  const handleApplyOverride = (counts) => {
    if (!selected || !tier || !onParamsChange) return;
    onParamsChange(setCrabPostOverride(params, tier.isTop, selected.px, selected.py, counts));
    setSelected(null);
  };

  const handleResetOverride = () => {
    if (!selected || !tier || !onParamsChange) return;
    onParamsChange(setCrabPostOverride(params, tier.isTop, selected.px, selected.py, null));
    setSelected(null);
  };

  if (!tier) {
    return (
      <div className="fc-crab-audit__empty">
        Нет данных о краб-системе для текущей конфигурации.
      </div>
    );
  }

  const autoCounts = selectedCell
    ? defaultPostCrabCounts({
      px: selectedCell.px,
      py: selectedCell.py,
      postCountX: params.postCountX,
      postCountY: params.postCountY,
      isTopLevel: tier.isTop,
    })
    : null;

  return (
    <div className="fc-crab-audit">
      <p className="fc-crab-audit__hint-bar">
        Все обычные ярусы одинаковые — настраиваются один раз. Верхний ярус — отдельно.
        Нажмите на стойку для редактирования.
        {audit.overrideCount > 0 && (
          <span className="fc-crab-audit__override-badge">
            Ручных правок: {audit.overrideCount}
          </span>
        )}
      </p>

      <div className="fc-crab-audit__toolbar">
        <div className="fc-crab-audit__tier-tabs" role="tablist" aria-label="Тип яруса">
          {audit.tiers.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={editTierId === t.id}
              className={`fc-crab-audit__tier-btn${editTierId === t.id ? ' is-active' : ''}${t.isTop ? ' is-top' : ''}`}
              onClick={() => {
                setEditTierId(t.id);
                setSelected(null);
              }}
            >
              <span className="fc-crab-audit__tier-title">{t.label}</span>
              <span className="fc-crab-audit__tier-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedCell && autoCounts && (
        <FrameCrabCellEditor
          tierLabel={tier.label}
          px={selectedCell.px}
          py={selectedCell.py}
          role={selectedCell.role}
          currentCounts={badgesToCrabCounts(selectedCell.badges)}
          autoCounts={autoCounts}
          isOverride={selectedCell.isOverride}
          onApply={handleApplyOverride}
          onReset={handleResetOverride}
          onClose={() => setSelected(null)}
        />
      )}

      <div className={`fc-crab-audit__main${tier.isTop ? ' is-top-level' : ''}`}>
        <div className="fc-crab-audit__plan-panel">
          <h4 className="fc-crab-audit__panel-title">{tier.label}</h4>
          <p className="fc-crab-audit__panel-sub">{tier.hint}</p>
          <FrameCrabPlanSvg
            grid={tier.grid}
            postCountX={audit.postCountX}
            postCountY={audit.postCountY}
            isTop={tier.isTop}
            selectedPx={selected?.tierId === tier.id ? selected.px : null}
            selectedPy={selected?.tierId === tier.id ? selected.py : null}
            onCellClick={handleCellClick}
          />
          <CrabLegendBar totals={tier.postCounts} />
        </div>

        <div className="fc-crab-audit__detail-panel">
          <h4 className="fc-crab-audit__panel-title">Стойки — {tier.label.toLowerCase()}</h4>
          <div className="fc-crab-audit__cells">
            {tier.grid.map((row, py) => (
              <div key={`row-${py}`} className="fc-crab-audit__detail-row">
                <div className="fc-crab-audit__row-label">Y{py + 1}</div>
                <div
                  className="fc-crab-audit__row-cells"
                  style={{ gridTemplateColumns: `repeat(${audit.postCountX}, minmax(0, 1fr))` }}
                >
                  {row.map((cell) => {
                    const isSelected = selected?.tierId === tier.id
                      && selected.px === cell.px
                      && selected.py === cell.py;
                    return (
                      <button
                        key={`${cell.px}-${cell.py}`}
                        type="button"
                        className={[
                          'fc-crab-audit__cell',
                          'fc-crab-audit__cell-btn',
                          cell.isCorner ? 'is-corner' : '',
                          cell.endCap ? 'is-endcap' : '',
                          cell.isOverride ? 'is-override' : '',
                          isSelected ? 'is-selected' : '',
                        ].filter(Boolean).join(' ')}
                        title={`${cell.role} — нажмите для редактирования`}
                        onClick={() => handleCellClick(cell)}
                      >
                        <div className="fc-crab-audit__cell-head">
                          <span className="fc-crab-audit__cell-coord">X{cell.px + 1}</span>
                          {cell.isCorner && <span className="fc-crab-audit__cell-tag">угол</span>}
                          {cell.isOverride && <span className="fc-crab-audit__cell-tag is-manual">ручн.</span>}
                        </div>
                        <div className="fc-crab-audit__cell-badges">
                          {cell.badges.length > 0 ? (
                            cell.badges.map((b) => (
                              <CrabChip key={b.type} type={b.type} count={b.count} />
                            ))
                          ) : (
                            <span className="fc-crab-audit__cell-empty">—</span>
                          )}
                        </div>
                        <div className="fc-crab-audit__cell-role">{cell.role}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <aside className="fc-crab-audit__level-summary">
            <dl>
              <div>
                <dt>Итого на стойках (1 уровень)</dt>
                <dd className="fc-crab-audit__summary-chips">
                  {['G', 'T', 'X', 'A4', 'A6'].map((type) => {
                    const n = tier.postCounts[type];
                    if (!n) return null;
                    return <CrabChip key={type} type={type} count={n} />;
                  })}
                  {!Object.values(tier.postCounts).some((n) => n > 0) && '—'}
                </dd>
              </div>
              {!tier.isTop && audit.regularLevelCount > 1 && (
                <div>
                  <dt>Повторяется на уровнях</dt>
                  <dd>{audit.regularLevelCount} раз (все кроме верхнего)</dd>
                </div>
              )}
              {tier.crossBeamT > 0 && (
                <div>
                  <dt>T на поперечинах</dt>
                  <dd>{tier.crossBeamT} компл. (между стоек)</dd>
                </div>
              )}
              {tier.hasEndCap && (
                <div>
                  <dt>Торцевые балки</dt>
                  <dd>Есть на этом уровне</dd>
                </div>
              )}
            </dl>
          </aside>
        </div>
      </div>

      <section className="fc-crab-audit__compare" aria-label="Сверка подсчёта">
        <div className="fc-crab-audit__compare-head">
          <h4>Сверка: каркас ↔ спецификация</h4>
          {audit.manualOverride ? (
            <span className="fc-crab-audit__manual">Есть ручные правки</span>
          ) : audit.allMatch ? (
            <span className="fc-crab-audit__ok-badge">Совпадает</span>
          ) : (
            <span className="fc-crab-audit__warn-badge">Есть расхождения</span>
          )}
        </div>
        <div className="table-responsive">
          <table className="fc-crab-audit__table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>Компл. в каркасе</th>
                <th>Шт. в каркасе</th>
                <th>Компл. в спецификации</th>
                <th>Шт. в спецификации</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {audit.comparisons
                .filter((row) => row.geometrySets > 0 || row.cutSets > 0)
                .map((row) => (
                  <ComparisonRow key={row.type} row={row} />
                ))}
            </tbody>
          </table>
        </div>
        <p className="fc-crab-audit__note">
          G, T, X: шт. (1 комплект = 2 шт.). 6×: шт. (1 комплект = 4 шт.). 4×: компл.
          {' '}Обычный шаблон × {audit.regularLevelCount} ярусов + верхний ярус (T на поперечинах включены).
          {audit.impliedTotals?.T > 0 && (
            <> Ожидаемо T: {audit.impliedTotals.T} компл.</>
          )}
        </p>
      </section>
    </div>
  );
}
