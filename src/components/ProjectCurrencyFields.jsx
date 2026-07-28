import React, { useMemo } from "react";
import {
  PROJECT_CURRENCY_PRESETS,
  normalizeProjectCurrency,
  currencyFieldsForApi,
} from "../../shared/projectCurrency.js";

const CUSTOM_VALUE = "__custom__";

/**
 * Preset select + optional custom fields for project currency.
 * @param {{ value: object, onChange: (desc: object) => void, label?: string }} props
 */
export default function ProjectCurrencyFields({ value, onChange, label = "Валюта проекта" }) {
  const desc = useMemo(() => normalizeProjectCurrency(value || {}), [value]);
  const selectValue = desc.currencyCustom ? CUSTOM_VALUE : desc.currencyCode;

  const emitPreset = (code) => {
    const preset = PROJECT_CURRENCY_PRESETS.find((p) => p.code === code);
    if (!preset) return;
    onChange?.({
      currencyCode: preset.code,
      currencySymbol: preset.symbol,
      currencyName: preset.name,
      currencyCustom: false,
    });
  };

  const emitCustomPatch = (patch) => {
    onChange?.({
      currencyCode: desc.currencyCode === "RUB" && !desc.currencyCustom ? "CUSTOM" : desc.currencyCode,
      currencySymbol: desc.currencySymbol,
      currencyName: desc.currencyName,
      currencyCustom: true,
      ...patch,
    });
  };

  return (
    <div className="field" style={{ gridColumn: "1 / -1" }}>
      <label>{label}</label>
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_VALUE) {
            emitCustomPatch({
              currencyCode: desc.currencyCustom ? desc.currencyCode : "CUSTOM",
              currencySymbol: desc.currencyCustom ? desc.currencySymbol : "",
              currencyName: desc.currencyCustom ? desc.currencyName : "",
              currencyCustom: true,
            });
            return;
          }
          emitPreset(v);
        }}
      >
        {PROJECT_CURRENCY_PRESETS.map((p) => (
          <option key={p.code} value={p.code}>
            {p.code} — {p.name} ({p.symbol})
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Другая валюта</option>
      </select>
      {desc.currencyCustom ? (
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Код</label>
            <input
              value={desc.currencyCode || ""}
              maxLength={10}
              placeholder="USD"
              onChange={(e) => emitCustomPatch({ currencyCode: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Символ</label>
            <input
              value={desc.currencySymbol || ""}
              maxLength={8}
              placeholder="$"
              onChange={(e) => emitCustomPatch({ currencySymbol: e.target.value })}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Название</label>
            <input
              value={desc.currencyName || ""}
              maxLength={60}
              placeholder="Доллар США"
              onChange={(e) => emitCustomPatch({ currencyName: e.target.value })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Merge currency descriptor into a project form / API payload. */
export function applyCurrencyDescToForm(form, desc) {
  const fields = currencyFieldsForApi(desc);
  return {
    ...form,
    ...fields,
  };
}

export { currencyFieldsForApi, normalizeProjectCurrency };
