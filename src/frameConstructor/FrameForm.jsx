import React, { useEffect, useMemo, useState } from 'react';
import { calculateFrameGeometry } from './frameGeometry.js';
import { framePresets } from './framePresets.js';
import { normalizeFrameConfig } from './frameConfig.js';
import {
  deleteSavedFramePreset,
  listSavedFramePresets,
  saveFramePreset,
} from './frameSavedPresets.js';
import { getRackTypeDefaults, getPostGridDefaults, supportsTrays, totalFrameDepthMm, crossBayLengthMm, normalizeEndCapBeamLevelMask, normalizeEndCapBeamDropByLevel } from './frameCrabRules.js';
import { supportsNftChannels } from './frameNftChannels.js';

function Field({ label, hint, span, children }) {
  return (
    <label className={`fc-field${span ? ' fc-field--full' : ''}`}>
      <span className="fc-field__label">{label}</span>
      {children}
      {hint ? <span className="fc-field__hint">{hint}</span> : null}
    </label>
  );
}

export default function FrameForm({ params, onChange }) {
  const [savedPresets, setSavedPresets] = useState(() => listSavedFramePresets());
  const [activePresetId, setActivePresetId] = useState('');

  const refreshSavedPresets = () => setSavedPresets(listSavedFramePresets());

  const isSavedPresetActive = useMemo(
    () => activePresetId && savedPresets.some((p) => p.id === activePresetId),
    [activePresetId, savedPresets],
  );
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    let val = type === 'checkbox' ? checked : value;
    
    if (type === 'number') {
      val = parseFloat(val) || 0;
    }
    
    if (name === 'rackType') {
      const defs = getRackTypeDefaults(val, {
        lengthMm: params.lengthMm,
        depthMm: params.depthMm,
        tubeWidthMm: params.tubeWidthMm,
      });
      onChange({ ...params, [name]: val, ...defs });
      return;
    }

    if (name === 'postCountY') {
      const gridDefs = getPostGridDefaults(params, val);
      onChange({ ...params, ...gridDefs });
      return;
    }

    onChange({ ...params, [name]: val });
  };

  const handleBlur = (e) => {
    const { name, type } = e.target;
    if (type !== 'number') return;
    // Wheel-induced blur must not rewrite unchanged params.
    let next = { ...params, [name]: params[name] };
    if (name === 'postCountY') {
      next = { ...next, ...getPostGridDefaults(params, params.postCountY) };
    }
    const normalized = normalizeFrameConfig(next);
    const current = normalizeFrameConfig(params);
    if (JSON.stringify(normalized) === JSON.stringify(current)) return;
    onChange(normalized);
  };

  const handlePresetChange = (e) => {
    const presetId = e.target.value;
    if (!presetId) return;

    const builtIn = framePresets.find((p) => p.id === presetId);
    if (builtIn) {
      setActivePresetId(presetId);
      onChange({ ...builtIn.params });
      return;
    }

    const saved = savedPresets.find((p) => p.id === presetId);
    if (saved) {
      setActivePresetId(presetId);
      onChange({ ...saved.params });
    }
  };

  const handleSavePreset = () => {
    const saved = saveFramePreset({
      id: isSavedPresetActive ? activePresetId : undefined,
      name: params.name,
      params,
    });
    refreshSavedPresets();
    setActivePresetId(saved.id);
  };

  const handleSavePresetAsNew = () => {
    const saved = saveFramePreset({
      name: params.name,
      params,
    });
    refreshSavedPresets();
    setActivePresetId(saved.id);
  };

  const handleDeletePreset = () => {
    if (!isSavedPresetActive) return;
    const preset = savedPresets.find((p) => p.id === activePresetId);
    if (!window.confirm(`Удалить пресет «${preset?.name || 'без названия'}»?`)) return;
    deleteSavedFramePreset(activePresetId);
    refreshSavedPresets();
    setActivePresetId('');
  };

  const levelCount = params.tierCount + 1;
  const crossBeamsPerLevel = params.crossBeamsPerLevel;
  const endCapLevelMask = normalizeEndCapBeamLevelMask(params.endCapBeamLevelMask, levelCount);
  const endCapDrops = normalizeEndCapBeamDropByLevel(params.endCapBeamDropByLevel, levelCount);

  // Initialize custom layout if empty
  useEffect(() => {
    if (params.beamSpacingMode === 'custom' && (!params.customBeamLayoutByLevel || params.customBeamLayoutByLevel.length === 0)) {
      const initialLayout = Array.from({ length: levelCount }, (_, i) => ({
        levelIndex: i,
        startInsetMm: params.trayEndInsetMm,
        spacingsMm: Array(Math.max(0, crossBeamsPerLevel - 1)).fill(
          (params.lengthMm - 2 * params.trayEndInsetMm) / Math.max(1, crossBeamsPerLevel - 1)
        )
      }));
      onChange({ ...params, customBeamLayoutByLevel: initialLayout });
    }
  }, [params.beamSpacingMode, levelCount, crossBeamsPerLevel, params.lengthMm, params.trayEndInsetMm]); // eslint-disable-line

  useEffect(() => {
    if (params.endCapBeamsEnabled && endCapLevelMask.every((v) => !v)) {
      onChange({ ...params, endCapBeamLevelMask: Array(levelCount).fill(true) });
    }
  }, [params.endCapBeamsEnabled, levelCount]); // eslint-disable-line

  useEffect(() => {
    const maskLen = (params.endCapBeamLevelMask || []).length;
    const dropLen = (params.endCapBeamDropByLevel || []).length;
    if (maskLen !== levelCount || dropLen !== levelCount) {
      onChange({
        ...params,
        endCapBeamLevelMask: normalizeEndCapBeamLevelMask(params.endCapBeamLevelMask, levelCount),
        endCapBeamDropByLevel: normalizeEndCapBeamDropByLevel(params.endCapBeamDropByLevel, levelCount),
      });
    }
  }, [levelCount]); // eslint-disable-line

  const handleCustomLayoutChange = (levelIndex, field, value, spacingIndex = null) => {
    const newLayout = [...(params.customBeamLayoutByLevel || [])];
    let levelLayout = newLayout.find(l => l.levelIndex === levelIndex);
    
    if (!levelLayout) {
      levelLayout = {
        levelIndex,
        startInsetMm: params.trayEndInsetMm,
        spacingsMm: Array(Math.max(0, crossBeamsPerLevel - 1)).fill(0)
      };
      newLayout.push(levelLayout);
    } else {
      levelLayout = { ...levelLayout, spacingsMm: [...levelLayout.spacingsMm] };
      const idx = newLayout.findIndex(l => l.levelIndex === levelIndex);
      newLayout[idx] = levelLayout;
    }

    if (field === 'startInsetMm') {
      levelLayout.startInsetMm = parseFloat(value) || 0;
    } else if (field === 'spacingsMm' && spacingIndex !== null) {
      levelLayout.spacingsMm[spacingIndex] = parseFloat(value) || 0;
    }

    onChange({ ...params, customBeamLayoutByLevel: newLayout });
  };

  const copyLayoutToAll = (sourceLevelIndex) => {
    const sourceLayout = params.customBeamLayoutByLevel.find(l => l.levelIndex === sourceLevelIndex);
    if (!sourceLayout) return;

    const newLayout = Array.from({ length: levelCount }, (_, i) => ({
      levelIndex: i,
      startInsetMm: sourceLayout.startInsetMm,
      spacingsMm: [...sourceLayout.spacingsMm]
    }));
    onChange({ ...params, customBeamLayoutByLevel: newLayout });
  };

  const copyFromPrevious = (levelIndex) => {
    if (levelIndex === 0) return;
    const sourceLayout = params.customBeamLayoutByLevel.find(l => l.levelIndex === levelIndex - 1);
    if (!sourceLayout) return;

    const newLayout = [...params.customBeamLayoutByLevel];
    const targetIdx = newLayout.findIndex(l => l.levelIndex === levelIndex);
    const newLevelLayout = {
      levelIndex,
      startInsetMm: sourceLayout.startInsetMm,
      spacingsMm: [...sourceLayout.spacingsMm]
    };

    if (targetIdx >= 0) {
      newLayout[targetIdx] = newLevelLayout;
    } else {
      newLayout.push(newLevelLayout);
    }
    onChange({ ...params, customBeamLayoutByLevel: newLayout });
  };

  const resetToEqual = () => {
    onChange({ ...params, beamSpacingMode: 'equal' });
  };

  const toggleEndCapLevel = (levelIndex, checked) => {
    const mask = normalizeEndCapBeamLevelMask(params.endCapBeamLevelMask, levelCount);
    mask[levelIndex] = checked;
    onChange({ ...params, endCapBeamLevelMask: mask });
  };

  const setAllEndCapLevels = (checked) => {
    onChange({ ...params, endCapBeamLevelMask: Array(levelCount).fill(checked) });
  };

  const setEndCapDrop = (levelIndex, value) => {
    const drops = normalizeEndCapBeamDropByLevel(params.endCapBeamDropByLevel, levelCount);
    drops[levelIndex] = Math.max(0, parseFloat(value) || 0);
    onChange({ ...params, endCapBeamDropByLevel: drops });
  };

  const geom = useMemo(() => calculateFrameGeometry(params), [params]);
  const geomOk = geom && !geom.validationErrors?.length && geom.beamLayouts;

  const checkTraySupport = () => {
    if (!supportsTrays(params.rackType) || !params.trayEnabled || !geomOk) return null;
    const leftEdge = params.lengthMm / 2 - params.trayLengthMm / 2;
    const rightEdge = params.lengthMm / 2 + params.trayLengthMm / 2;
    const tolerance = 50;

    for (let l = 0; l < geom.levelCount - 1; l++) {
      const layout = geom.beamLayouts[l];
      if (!layout) continue;

      const endCapX = geom.endCapBeamLayouts?.[l]?.enabled ? geom.endCapBeamLayouts[l].xPositions : [];
      const supportX = [...layout.xPositions, ...endCapX];
      
      const hasLeftSupport = supportX.some(x => Math.abs(x - leftEdge) <= tolerance);
      const hasRightSupport = supportX.some(x => Math.abs(x - rightEdge) <= tolerance);
      
      if (!hasLeftSupport || !hasRightSupport) {
        return `На ярусе ${l + 1} поддон не опирается на крайние балки (допуск ${tolerance}мм). Левый край поддона: ${leftEdge}, правый: ${rightEdge}.`;
      }
    }
    return null;
  };

  const trayWarning = checkTraySupport();
  const totalDepthMm = geomOk
    ? geom.dimensions.depthMm
    : totalFrameDepthMm(params.depthMm, params.tubeWidthMm, params.postCountY);
  const moduleBayLength = crossBayLengthMm(params.depthMm, params.tubeWidthMm);

  return (
    <div className="fc-form">
      <div className="fc-form__head">
        <h3>Параметры каркаса</h3>
      </div>

      <div className="fc-form__scroll">
        <details className="fc-section" open>
          <summary className="fc-section__title">Пресеты и название</summary>
          <div className="fc-section__body">
            <Field label="Пресет">
              <select value={activePresetId} onChange={handlePresetChange}>
                <option value="">Выберите пресет…</option>
                <optgroup label="Встроенные">
                  {framePresets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
                {savedPresets.length > 0 && (
                  <optgroup label="Мои пресеты">
                    {savedPresets.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>
            <div className="fc-preset-bar">
              <button type="button" onClick={handleSavePreset} className="btn btn-sm btn-primary">
                {isSavedPresetActive ? 'Обновить' : 'Сохранить'}
              </button>
              <button type="button" onClick={handleSavePresetAsNew} className="btn btn-outline btn-sm">
                Сохранить как новый
              </button>
              {isSavedPresetActive && (
                <button type="button" onClick={handleDeletePreset} className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }}>
                  Удалить
                </button>
              )}
            </div>
            <p className="fc-field__hint" style={{ marginTop: '0.5rem' }}>
              Пресеты хранятся в браузере. Название — из поля ниже.
            </p>
            <div className="fc-grid" style={{ marginTop: '0.75rem' }}>
              <Field label="Название проекта">
                <input type="text" name="name" value={params.name} onChange={handleChange} />
              </Field>
              <Field label="Тип установки">
                <select name="rackType" value={params.rackType} onChange={handleChange}>
                  <option value="nft">NFT</option>
                  <option value="flood">Подтопление</option>
                  <option value="seedling">Рассада</option>
                  <option value="strawberry">Клубника</option>
                  <option value="custom">Кастомный</option>
                </select>
              </Field>
            </div>
          </div>
        </details>

        <details className="fc-section" open>
          <summary className="fc-section__title">Габариты</summary>
          <div className="fc-section__body">
            <div className="fc-grid">
              <Field label="Длина, мм">
                <input type="number" name="lengthMm" value={params.lengthMm} onChange={handleChange} onBlur={handleBlur} />
              </Field>
              <Field
                label="Глубина модуля, мм"
                hint={params.postCountY > 2
                  ? `Полная глубина каркаса: ${totalDepthMm} мм (${params.postCountY - 1} модул${params.postCountY - 1 === 1 ? 'ь' : params.postCountY - 1 < 5 ? 'я' : 'ей'} по Y)`
                  : null}
              >
                <input type="number" name="depthMm" value={params.depthMm} onChange={handleChange} onBlur={handleBlur} />
              </Field>
              <Field label="Кол-во ярусов">
                <input type="number" name="tierCount" value={params.tierCount} onChange={handleChange} onBlur={handleBlur} />
              </Field>
              <Field label="Шаг ярусов, мм">
                <input type="number" name="tierSpacingMm" value={params.tierSpacingMm} onChange={handleChange} onBlur={handleBlur} />
              </Field>
              <Field label="Нижний отступ, мм" span>
                <input type="number" name="bottomOffsetMm" value={params.bottomOffsetMm} onChange={handleChange} onBlur={handleBlur} />
              </Field>
            </div>
          </div>
        </details>

        <details className="fc-section" open>
          <summary className="fc-section__title">Конструкция</summary>
          <div className="fc-section__body">
            <div className="fc-grid">
              <Field label="Тип конструкции" span>
                <select name="constructionType" value={params.constructionType || 'tube_crab'} onChange={handleChange}>
                  <option value="tube_crab">Профильная труба + краб-система</option>
                  <option value="perforated_angle">Перфорированный уголок 30×30</option>
                </select>
              </Field>

              {params.constructionType === 'perforated_angle' ? (
                <>
                  <Field label="Профиль уголка">
                    <select name="angleProfile" value={params.angleProfile || '30×30'} onChange={handleChange}>
                      <option value="30×30">30×30 мм</option>
                    </select>
                  </Field>
                  <Field label="Нахлёст уголка, мм" hint="0 — без нахлёста. Добавляется только для деталей длиннее 2 м / 2.5 м.">
                    <input
                      type="number"
                      name="angleOverlapMm"
                      min={0}
                      max={1000}
                      value={params.angleOverlapMm !== undefined && params.angleOverlapMm !== null ? params.angleOverlapMm : 150}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                  </Field>
                  <Field label="Длина заготовки уголка" span>
                    <select
                      name="angleStockSelection"
                      value={
                        params.angleStockLengthsMm?.length === 1
                          ? params.angleStockLengthsMm[0]
                          : 'auto'
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'auto') {
                          onChange({ ...params, angleStockLengthsMm: [2000, 2500] });
                        } else {
                          onChange({ ...params, angleStockLengthsMm: [Number(val)] });
                        }
                      }}
                    >
                      <option value="2000">Только 2 м</option>
                      <option value="2500">Только 2.5 м</option>
                      <option value="auto">Автоподбор 2 м / 2.5 м</option>
                    </select>
                  </Field>
                  <Field label="Крепление поперечин" span>
                    <select
                      name="crossBeamFasteningMode"
                      value={params.crossBeamFasteningMode || 'bolts_only'}
                      onChange={handleChange}
                    >
                      <option value="bolts_only">Без крепёжных уголков (напрямую болтом)</option>
                      <option value="brackets">С крепёжными уголками</option>
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Ширина трубы, мм">
                    <input type="number" name="tubeWidthMm" value={params.tubeWidthMm} onChange={handleChange} onBlur={handleBlur} />
                  </Field>
                  <Field label="Высота трубы, мм">
                    <input type="number" name="tubeHeightMm" value={params.tubeHeightMm} onChange={handleChange} onBlur={handleBlur} />
                  </Field>
                  <Field label="Соединение" span>
                    <select name="connectionType" value={params.connectionType} onChange={handleChange}>
                      <option value="crab">Краб-система</option>
                      <option value="welded">Сварка</option>
                    </select>
                  </Field>
                </>
              )}

              <Field label="Стоек по X">
                <input type="number" name="postCountX" value={params.postCountX} onChange={handleChange} onBlur={handleBlur} />
              </Field>
              <Field label="Стоек по Y" hint="Доп. ряд — пристройка модуля снаружи (общая стойка на стыке).">
                <input type="number" name="postCountY" value={params.postCountY} onChange={handleChange} onBlur={handleBlur} />
              </Field>
              <Field label="Поперечин на ярус" span hint="На каждом горизонтальном уровне. При изменении стоек по Y пересчитывается автоматически.">
                <input type="number" name="crossBeamsPerLevel" value={params.crossBeamsPerLevel} onChange={handleChange} onBlur={handleBlur} />
              </Field>
            </div>
          </div>
        </details>

        <details className="fc-section" open={params.beamSpacingMode === 'custom'}>
          <summary className="fc-section__title">Поперечные балки по ярусам</summary>
          <div className="fc-section__body">
            <Field label="Режим раскладки">
              <select name="beamSpacingMode" value={params.beamSpacingMode} onChange={handleChange}>
                <option value="equal">Равномерно</option>
                <option value="custom">Вручную</option>
              </select>
            </Field>

            {params.beamSpacingMode === 'custom' && geomOk && (
              <>
                <div className="fc-table-wrap" style={{ marginTop: '0.65rem' }}>
                  <table className="fc-table">
                    <thead>
                      <tr>
                        <th>Ярус</th>
                        <th>Отступ слева</th>
                        {Array.from({ length: Math.max(0, crossBeamsPerLevel - 1) }).map((_, i) => (
                          <th key={i}>Шаг {i + 1}–{i + 2}</th>
                        ))}
                        <th>Остаток справа</th>
                        <th>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: levelCount }).map((_, l) => {
                        const layout = geom.beamLayouts[l] || { startInsetMm: 0, spacingsMm: [], endInsetMm: 0 };
                        const isOverLength = layout.startInsetMm + layout.spacingsMm.reduce((a, b) => a + b, 0) > params.lengthMm;

                        return (
                          <tr key={l} className={isOverLength ? 'fc-table__row--error' : ''}>
                            <td>{l + 1}</td>
                            <td>
                              <input
                                type="number"
                                value={layout.startInsetMm}
                                onChange={(e) => handleCustomLayoutChange(l, 'startInsetMm', e.target.value)}
                              />
                            </td>
                            {Array.from({ length: Math.max(0, crossBeamsPerLevel - 1) }).map((_, i) => (
                              <td key={i}>
                                <input
                                  type="number"
                                  value={layout.spacingsMm[i] || 0}
                                  onChange={(e) => handleCustomLayoutChange(l, 'spacingsMm', e.target.value, i)}
                                />
                              </td>
                            ))}
                            <td style={{ color: layout.endInsetMm < 0 ? 'var(--danger)' : 'inherit' }}>
                              {Math.round(layout.endInsetMm)}
                            </td>
                            <td>
                              <div className="fc-table-actions">
                                <button type="button" className="btn btn-outline btn-sm" onClick={() => copyLayoutToAll(l)} title="Применить ко всем">
                                  Всем
                                </button>
                                {l > 0 && (
                                  <button type="button" className="btn btn-outline btn-sm" onClick={() => copyFromPrevious(l)} title="Скопировать с предыдущего">
                                    ←
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: '0.55rem' }}>
                  <button type="button" onClick={resetToEqual} className="btn btn-outline btn-sm">
                    Сбросить раскладку равномерно
                  </button>
                </div>
              </>
            )}
          </div>
        </details>

        <details className="fc-section" open={!!params.endCapBeamsEnabled}>
          <summary className="fc-section__title">Торцевые балки</summary>
          <div className="fc-section__body">
            <label className="fc-check">
              <input type="checkbox" name="endCapBeamsEnabled" checked={!!params.endCapBeamsEnabled} onChange={handleChange} />
              Добавить торцевые поперечные балки
            </label>
            <p className="fc-field__hint" style={{ margin: '0.5rem 0 0.65rem' }}>
              На оси крайних стоек по длине. Соединение — T-краб (в общем количестве).
            </p>
            {params.endCapBeamsEnabled && (
              <>
                <div className="fc-preset-bar" style={{ marginBottom: '0.55rem' }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setAllEndCapLevels(true)}>Все уровни</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setAllEndCapLevels(false)}>Снять все</button>
                </div>
                <div className="fc-table-wrap">
                  <table className="fc-table">
                    <thead>
                      <tr>
                        <th>Уровень</th>
                        <th>Вкл.</th>
                        <th>Опуск, мм</th>
                        <th>Высота балки</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: levelCount }).map((_, l) => {
                        const levelZ = params.bottomOffsetMm + l * params.tierSpacingMm;
                        const drop = endCapDrops[l] || 0;
                        const beamZ = geomOk && geom.endCapBeamLayouts?.[l]
                          ? geom.endCapBeamLayouts[l].z
                          : Math.max(0, levelZ - drop);
                        return (
                          <tr key={l}>
                            <td>
                              {l + 1}
                              {l === levelCount - 1 && <span style={{ color: 'var(--muted)' }}> (верх)</span>}
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!endCapLevelMask[l]}
                                onChange={(e) => toggleEndCapLevel(l, e.target.checked)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                value={drop}
                                disabled={!endCapLevelMask[l]}
                                onChange={(e) => setEndCapDrop(l, e.target.value)}
                                onBlur={handleBlur}
                              />
                            </td>
                            <td style={{ color: 'var(--muted)' }}>{Math.round(beamZ)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </details>

        {params.connectionType === 'crab' && (
          <details className="fc-section">
            <summary className="fc-section__title">Краб-система</summary>
            <div className="fc-section__body">
              <div className="fc-grid fc-grid--3">
                <Field label="G (шт.)">
                  <input type="number" name="crabGQtyManual" value={params.crabGQtyManual ?? ''} onChange={handleChange} onBlur={handleBlur} placeholder="Авто" />
                </Field>
                <Field label="T (шт.)">
                  <input type="number" name="crabTQtyManual" value={params.crabTQtyManual ?? ''} onChange={handleChange} onBlur={handleBlur} placeholder="Авто" />
                </Field>
                <Field label="X (шт.)">
                  <input type="number" name="crabXQtyManual" value={params.crabXQtyManual ?? ''} onChange={handleChange} onBlur={handleBlur} placeholder="Авто" />
                </Field>
                <Field label="4× (компл.)">
                  <input type="number" name="crabA4QtyManual" value={params.crabA4QtyManual ?? ''} onChange={handleChange} onBlur={handleBlur} placeholder="Авто" />
                </Field>
                <Field label="6× (шт.)">
                  <input type="number" name="crabA6QtyManual" value={params.crabA6QtyManual ?? ''} onChange={handleChange} onBlur={handleBlur} placeholder="Авто" />
                </Field>
              </div>
              <p className="fc-field__hint">
                Ручной ввод: G, T, X — в штуках (1 комплект = 2 шт.). 6× — в штуках (1 комплект = 4 шт.). 4× — в комплектах.
              </p>
            </div>
          </details>
        )}

        {supportsNftChannels(params.rackType) && (
          <details className="fc-section" open={params.channelsEnabled}>
            <summary className="fc-section__title">NFT-каналы</summary>
            <div className="fc-section__body">
              <label className="fc-check">
                <input type="checkbox" name="channelsEnabled" checked={!!params.channelsEnabled} onChange={handleChange} />
                Включить каналы
              </label>
              <p className="fc-field__hint" style={{ marginTop: '0.5rem' }}>
                Профиль 110×55 мм (ширина×высота), длина вдоль стеллажа. На ярус:{' '}
                {Math.floor(params.depthMm / 110)} шт. × 110 мм при глубине модуля {params.depthMm} мм.
                Межярусное соединение змейкой (колено; чередование слева / справа).
              </p>
              {params.channelsEnabled && (
                <div className="fc-grid" style={{ marginTop: '0.65rem' }}>
                  <Field label="Запас заготовок 2 м, %">
                    <input
                      type="number"
                      name="channelStockMarginPct"
                      min={0}
                      max={100}
                      value={params.channelStockMarginPct ?? 8}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                  </Field>
                  <Field label="Запас муфт, %">
                    <input
                      type="number"
                      name="channelSleeveMarginPct"
                      min={0}
                      max={100}
                      value={params.channelSleeveMarginPct ?? 8}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                  </Field>
                  <Field label="Запас колен, %">
                    <input
                      type="number"
                      name="channelElbowMarginPct"
                      min={0}
                      max={100}
                      value={params.channelElbowMarginPct ?? 8}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                  </Field>
                </div>
              )}
            </div>
          </details>
        )}

        <details className="fc-section" open={supportsTrays(params.rackType) && params.trayEnabled}>
          <summary className="fc-section__title">Поддоны</summary>
          <div className="fc-section__body">
            {supportsTrays(params.rackType) ? (
              <>
                <label className="fc-check">
                  <input type="checkbox" name="trayEnabled" checked={params.trayEnabled} onChange={handleChange} />
                  Включить поддоны
                </label>
                {params.trayEnabled && (
                  <>
                    <div className="fc-grid" style={{ marginTop: '0.65rem' }}>
                      <Field label="Длина поддона, мм">
                        <input type="number" name="trayLengthMm" value={params.trayLengthMm} onChange={handleChange} onBlur={handleBlur} />
                      </Field>
                      <Field label="Ширина поддона, мм">
                        <input type="number" name="trayWidthMm" value={params.trayWidthMm} onChange={handleChange} onBlur={handleBlur} />
                      </Field>
                      <Field label="Высота поддона, мм">
                        <input type="number" name="trayHeightMm" value={params.trayHeightMm} onChange={handleChange} onBlur={handleBlur} />
                      </Field>
                      {params.beamSpacingMode === 'equal' && (
                        <Field label="Отступ балок от края, мм">
                          <input type="number" name="trayEndInsetMm" value={params.trayEndInsetMm} onChange={handleChange} onBlur={handleBlur} />
                        </Field>
                      )}
                    </div>
                    <p className="fc-field__hint" style={{ marginTop: '0.5rem' }}>
                      Макс. по модулю: {Math.max(100, params.lengthMm - 20)} × {Math.max(100, moduleBayLength - 10)} мм
                    </p>
                    {trayWarning && (
                      <div className="fc-alert fc-alert--warn" style={{ marginTop: '0.65rem' }}>
                        {trayWarning}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="fc-field__hint">Поддоны доступны для подтопления, рассады и клубники.</p>
            )}
          </div>
        </details>

        <details className="fc-section" open>
          <summary className="fc-section__title">Отображение</summary>
          <div className="fc-section__body">
            <div className="fc-check-row">
              <label className="fc-check">
                <input type="checkbox" name="showDimensions" checked={params.showDimensions} onChange={handleChange} />
                Размеры (2D)
              </label>
              <label className="fc-check">
                <input type="checkbox" name="showConnectors" checked={params.showConnectors} onChange={handleChange} />
                Крепеж
              </label>
              <label className="fc-check">
                <input type="checkbox" name="showTrays" checked={params.showTrays} onChange={handleChange} />
                Поддоны
              </label>
              {supportsNftChannels(params.rackType) && (
                <label className="fc-check">
                  <input type="checkbox" name="showChannels" checked={params.showChannels} onChange={handleChange} />
                  NFT-каналы
                </label>
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
