import React, { useMemo, useState } from "react";
import {
  COOLING_FARM_DEFAULTS,
  COOLING_FARM_SECTIONS,
  COOLING_SEASONS_DEFAULT,
  computeCoolingFarm,
  seasonalCooling,
} from "../lib/coolingFarmCalc.js";

function fmt(val, row = {}) {
  if (val == null || val === "") return "—";
  if (row?.pct) return `${(Number(val) * 100).toFixed(1)}%`;
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  if (Math.abs(n) >= 1000) return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export default function CoolingFarmTab({
  project,
  actions,
  onApplyToProject,
  inputs: externalInputs,
  onInputsChange,
  draftArea,
  draftHeight,
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

  const calc = useMemo(() => computeCoolingFarm(inputs), [inputs]);
  const seasons = useMemo(() => seasonalCooling(calc, COOLING_SEASONS_DEFAULT), [calc]);

  const set = (key, value) => {
    const next = { ...inputs, [key]: value };
    if (onInputsChange) onInputsChange(next);
    else setInternalInputs(next);
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
    <div style={{ marginTop: 16 }}>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="between wrap" style={{ gap: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 4px" }}>Расчёт охлаждения фермы</h3>
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

      <div className="card" style={{ padding: 16, marginBottom: 16, background: "var(--brand-tint)" }}>
        <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          <div>
            <div className="eyebrow">Мощность (хол)</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 800, color: "var(--brand)" }}>
              {fmt(calc.totalKwSafety)} кВт
            </div>
          </div>
          <div>
            <div className="eyebrow">BTU / модель</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 800 }}>
              {fmt(calc.standardBtu)} BTU
            </div>
          </div>
          <div>
            <div className="eyebrow">Электропотребление</div>
            <div className="num" style={{ fontWeight: 700 }}>{fmt(calc.elecKw)} кВт</div>
          </div>
          <div>
            <div className="eyebrow">Э/э в месяц</div>
            <div className="num" style={{ fontWeight: 700 }}>{fmt(calc.monthlyCost)} ₽</div>
          </div>
        </div>
      </div>

      {COOLING_FARM_SECTIONS.map((sec) => (
        <div key={sec.title} className="card" style={{ padding: 0, marginBottom: 14, overflow: "hidden" }}>
          <div
            style={{
              padding: "10px 14px",
              fontWeight: 700,
              fontSize: 13,
              background: sec.highlight ? "var(--brand)" : "var(--brand-tint)",
              color: sec.highlight ? "#fff" : "inherit",
            }}
          >
            {sec.title}
          </div>
          <table className="spec" style={{ margin: 0 }}>
            <tbody>
              {sec.rows.map((row) => (
                <tr key={row.key}>
                  <td style={{ minWidth: 220, fontSize: 13 }}>{row.label}</td>
                  <td style={{ width: 72, fontSize: 12 }} className="muted">{row.unit}</td>
                  <td className="right" style={{ width: 160 }}>
                    {row.input ? (
                      <input
                        className="spec-cell-input spec-cell-input--num"
                        type="number"
                        step="any"
                        value={inputs[row.key] ?? ""}
                        onChange={(e) => set(row.key, e.target.value === "" ? "" : Number(e.target.value))}
                        style={{ background: "#e8f4ff" }}
                      />
                    ) : (
                      <span
                        className="num"
                        style={{
                          fontWeight: row.result ? 800 : 500,
                          color: row.result ? "var(--brand)" : "inherit",
                          fontSize: row.result ? 15 : 13,
                        }}
                      >
                        {fmt(calc[row.key], row)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="card" style={{ padding: 16 }}>
        <h4 style={{ marginTop: 0 }}>По сезонам</h4>
        <div style={{ overflowX: "auto" }}>
          <table className="spec">
            <thead>
              <tr>
                <th>Параметр</th>
                {seasons.map((s) => (
                  <th key={s.id} className="right">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>T улица</td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num">{s.tOut}°C</td>
                ))}
              </tr>
              <tr>
                <td>ΔT</td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num">{fmt(s.dT)}°C</td>
                ))}
              </tr>
              <tr>
                <td>Ограждения, BTU/ч</td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num">{fmt(s.envelope)}</td>
                ))}
              </tr>
              <tr>
                <td><strong>ИТОГО BTU/ч</strong></td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num" style={{ fontWeight: 700 }}>{fmt(s.total)}</td>
                ))}
              </tr>
              <tr>
                <td><strong>ИТОГО кВт</strong></td>
                {seasons.map((s) => (
                  <td key={s.id} className="right num" style={{ fontWeight: 700 }}>{fmt(s.totalKw)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
