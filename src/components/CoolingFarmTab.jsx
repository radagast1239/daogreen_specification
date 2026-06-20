import React, { useMemo, useState } from "react";
import {
  COOLING_FARM_DEFAULTS,
  COOLING_FARM_SECTIONS,
  COOLING_SEASONS_DEFAULT,
  computeCoolingFarm,
  seasonalCooling,
} from "../lib/coolingFarmCalc.js";
import { CLIENT_COOLING_SECTIONS, COOLING_ROW_HINTS } from "../lib/coolingHints.js";

function fmt(val, row = {}) {
  if (val == null || val === "") return "—";
  if (row?.pct) return `${(Number(val) * 100).toFixed(1)}%`;
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  if (Math.abs(n) >= 1000) return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function filterSections(variant) {
  if (variant !== "client") return COOLING_FARM_SECTIONS;
  return COOLING_FARM_SECTIONS.filter((s) => CLIENT_COOLING_SECTIONS.has(s.title));
}

function rowEditable(row, variant) {
  if (variant !== "client") return !!row.input;
  return row.key === "safetyFactor";
}

function rowReadOnly(row, variant) {
  if (variant !== "client") return !row.input;
  return row.key !== "safetyFactor";
}

export default function CoolingFarmTab({
  project,
  actions,
  onApplyToProject,
  inputs: externalInputs,
  onInputsChange,
  draftArea,
  draftHeight,
  variant = "admin",
  onSafetyFactorChange,
}) {
  const baseParams =
    project?.manualParams && typeof project.manualParams === "object" ? project.manualParams : {};
  const stored =
    baseParams.coolingFarm && typeof baseParams.coolingFarm === "object" ? baseParams.coolingFarm : {};
  const [internalInputs, setInternalInputs] = useState(() => {
    const base = { ...COOLING_FARM_DEFAULTS, ...stored };
    if (draftHeight && !stored.height) base.height = Number(draftHeight) || base.height;
    if (draftArea && !stored.length && !stored.width) {
      const a = Number(draftArea);
      if (a > 0) {
        const side = Math.sqrt(a);
        base.length = Math.round(side * 100) / 100;
        base.width = Math.round(side * 100) / 100;
      }
    }
    return base;
  });
  const inputs = externalInputs ?? internalInputs;
  const [saved, setSaved] = useState(false);
  const canPersist = !!(project?.id && actions?.projectUpdate);
  const isClient = variant === "client";

  const calc = useMemo(() => computeCoolingFarm(inputs), [inputs]);
  const seasons = useMemo(() => seasonalCooling(calc, COOLING_SEASONS_DEFAULT), [calc]);
  const sections = useMemo(() => filterSections(variant), [variant]);

  const set = (key, value) => {
    const next = { ...inputs, [key]: value };
    if (onInputsChange) onInputsChange(next);
    else setInternalInputs(next);
    if (isClient && key === "safetyFactor" && onSafetyFactorChange) {
      onSafetyFactorChange(Number(value) || 1);
    }
  };

  const save = async () => {
    if (!canPersist) return;
    await actions.projectUpdate(project.id, {
      manualParams: { ...baseParams, coolingFarm: inputs },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const applyCooling = async () => {
    if (canPersist) await save();
    if (onApplyToProject) {
      await onApplyToProject({
        coolingKw: calc.totalKwSafety,
        coolingBtu: Math.round(calc.modelBtu),
      });
    }
  };

  return (
    <div className={`cooling-calc ${isClient ? "cooling-calc--client" : ""}`} style={{ marginTop: 16 }}>
      {!isClient && (
        <div className="card cooling-calc__head" style={{ padding: "18px 22px 18px 28px", marginBottom: 16 }}>
          <div className="between wrap" style={{ gap: 12 }}>
            <div>
              <h3 style={{ margin: "0 0 6px", fontWeight: 800 }}>Расчёт охлаждения фермы</h3>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Логика из «РАСЧЁТ ОХЛАЖДЕНИЯ ФЕРМА v2.xlsx». Синие поля — ввод, зелёные — результат.
              </p>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              {canPersist && (
                <button type="button" className="btn" onClick={save}>Сохранить</button>
              )}
              <button type="button" className="btn btn-primary" onClick={applyCooling}>
                {canPersist ? `Применить ${fmt(calc.totalKwSafety)} кВт к проекту` : `Использовать ${fmt(calc.totalKwSafety)} кВт`}
              </button>
            </div>
          </div>
          {saved && canPersist && <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>Сохранено в проекте</p>}
        </div>
      )}

      <div className="card cooling-calc__summary" style={{ padding: "18px 22px 18px 28px", marginBottom: 16, background: "var(--brand-tint)" }}>
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          <div>
            <div className="eyebrow">Мощность (хол)</div>
            <div className="num cooling-calc__num cooling-calc__num--hero">{fmt(calc.totalKwSafety)} кВт</div>
          </div>
          <div>
            <div className="eyebrow">BTU / модель</div>
            <div className="num cooling-calc__num cooling-calc__num--hero">{fmt(calc.standardBtu)} BTU</div>
          </div>
          {!isClient && (
            <>
              <div>
                <div className="eyebrow">Электропотребление</div>
                <div className="num cooling-calc__num">{fmt(calc.elecKw)} кВт</div>
              </div>
              <div>
                <div className="eyebrow">Э/э в месяц</div>
                <div className="num cooling-calc__num">{fmt(calc.monthlyCost)} ₽</div>
              </div>
            </>
          )}
        </div>
      </div>

      {sections.map((sec) => (
        <div key={sec.title} className="card cooling-calc__section" style={{ padding: 0, marginBottom: 14, overflow: "hidden" }}>
          <div className={`cooling-calc__section-title ${sec.highlight ? "cooling-calc__section-title--highlight" : ""}`}>
            {sec.title}
          </div>
          <table className="spec cooling-calc__table">
            <thead>
              <tr>
                <th className="cooling-calc__col-label">Параметр</th>
                <th className="cooling-calc__col-unit">Ед.</th>
                <th className="cooling-calc__col-value right">Значение</th>
              </tr>
            </thead>
            <tbody>
              {sec.rows.map((row) => {
                const hint = COOLING_ROW_HINTS[row.key];
                const editable = rowEditable(row, variant);
                const readOnly = rowReadOnly(row, variant);
                return (
                  <tr key={row.key} className={row.result ? "cooling-calc__row--result" : ""}>
                    <td className="cooling-calc__col-label">
                      <div className="cooling-calc__label">{row.label}</div>
                      {hint && <div className="cooling-calc__hint">{hint}</div>}
                    </td>
                    <td className="cooling-calc__col-unit muted">{row.unit}</td>
                    <td className="cooling-calc__col-value right">
                      {editable ? (
                        <input
                          className="spec-cell-input spec-cell-input--num cooling-calc__input"
                          type="number"
                          step="any"
                          value={inputs[row.key] ?? ""}
                          onChange={(e) => set(row.key, e.target.value === "" ? "" : Number(e.target.value))}
                        />
                      ) : (
                        <span className={`num cooling-calc__value ${row.result || readOnly ? "cooling-calc__value--bold" : ""}`}>
                          {fmt(calc[row.key], row)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="card cooling-calc__section" style={{ padding: 0, overflow: "hidden" }}>
        <div className="cooling-calc__section-title">По сезонам</div>
        <div style={{ overflowX: "auto", padding: "0 8px 12px 20px" }}>
          <table className="spec cooling-calc__table">
            <thead>
              <tr>
                <th className="cooling-calc__col-label">Параметр</th>
                {seasons.map((s) => (
                  <th key={s.id} className="right cooling-calc__col-value">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cooling-calc__label">T улица</td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num cooling-calc__value">{s.tOut}°C</td>
                ))}
              </tr>
              <tr>
                <td className="cooling-calc__label">ΔT</td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num cooling-calc__value cooling-calc__value--bold">{fmt(s.dT)}°C</td>
                ))}
              </tr>
              <tr>
                <td className="cooling-calc__label">Ограждения, BTU/ч</td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num cooling-calc__value">{fmt(s.envelope)}</td>
                ))}
              </tr>
              <tr>
                <td><strong className="cooling-calc__label">ИТОГО BTU/ч</strong></td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num cooling-calc__value cooling-calc__value--bold">{fmt(s.total)}</td>
                ))}
              </tr>
              <tr>
                <td><strong className="cooling-calc__label">ИТОГО кВт</strong></td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num cooling-calc__value cooling-calc__value--bold">{fmt(s.totalKw)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {isClient && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8, paddingLeft: 20 }}>
          Можно изменить только «Запасной коэфф.» — остальные параметры задаёт Daogreen.
        </p>
      )}
    </div>
  );
}
