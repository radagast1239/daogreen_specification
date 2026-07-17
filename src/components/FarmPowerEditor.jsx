import React, { useEffect, useRef, useState } from "react";
import { automaticFarmPowerDevices, farmPowerFingerprint, farmPowerTotals, normalizeFarmPower } from "../../shared/farmPower.js";

function newDevice() {
  return { id: `power_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name: "", powerKw: 0, quantity: 1, hoursPerDay: 0, peakPowerKw: 0, source: "manual" };
}

function DraftInput({ value, type = "text", placeholder, onCommit }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => setDraft(String(value ?? "")), [value]);
  return (
    <input
      className="spec-cell-input"
      type={type}
      min={type === "number" ? 0 : undefined}
      step={type === "number" ? "any" : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(type === "number" ? Math.max(0, Number(draft) || 0) : draft.trim())}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

export default function FarmPowerEditor({ manualParams, onChange, rooms = [] }) {
  const incoming = normalizeFarmPower(manualParams?.farmPower);
  const [model, setModel] = useState(incoming);
  const pendingFingerprint = useRef("");
  const incomingFingerprint = farmPowerFingerprint(incoming);
  useEffect(() => {
    if (pendingFingerprint.current && incomingFingerprint !== pendingFingerprint.current) return;
    pendingFingerprint.current = "";
    setModel(incoming);
  }, [incomingFingerprint]);
  const automaticDevices = automaticFarmPowerDevices(model, rooms);
  const allDevices = [...automaticDevices, ...model.devices];
  const totals = farmPowerTotals({ ...model, devices: allDevices });
  const save = (rawNext) => {
    const next = normalizeFarmPower(rawNext);
    setModel(next);
    pendingFingerprint.current = farmPowerFingerprint(next);
    onChange({ ...(manualParams || {}), farmPower: next });
  };
  const patch = (id, field, value) => save({ ...model, devices: model.devices.map((device) => device.id === id ? { ...device, [field]: value } : device) });

  return (
    <div className="farm-power-editor">
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Освещение и фактическое потребление кондиционеров берутся из расчётов комнат. Для остальных приборов укажите мощность, количество и часы работы.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="spec" style={{ minWidth: 980 }}>
          <thead><tr><th>Прибор</th><th>Мощность, кВт</th><th>Кол-во</th><th>Часов/сут</th><th>Установлено, кВт</th><th>Пик, кВт</th><th>кВт·ч/сут</th><th>кВт·ч/мес</th><th /></tr></thead>
          <tbody>
            {automaticDevices.map((device) => <tr key={device.id}><td><b>{device.name}</b><div className="muted" style={{ fontSize: 11 }}>{device.details}</div></td><td colSpan={3} className="muted">автоматически</td><td className="num">{device.normalKw.toLocaleString("ru-RU")}</td><td className="num">{device.peakKw.toLocaleString("ru-RU")}</td><td className="num">{device.dailyKwh.toLocaleString("ru-RU")}</td><td className="num">{(device.dailyKwh * model.daysPerMonth).toLocaleString("ru-RU")}</td><td /></tr>)}
            {model.devices.map((device) => (
              <tr key={device.id}>
                <td><DraftInput value={device.name} placeholder="Насос, вентилятор, кондиционер…" onCommit={(value) => patch(device.id, "name", value)} /></td>
                <td><DraftInput type="number" value={device.powerKw} onCommit={(value) => patch(device.id, "powerKw", value)} /></td>
                <td><DraftInput type="number" value={device.quantity} onCommit={(value) => patch(device.id, "quantity", value)} /></td>
                <td><DraftInput type="number" value={device.hoursPerDay} onCommit={(value) => patch(device.id, "hoursPerDay", Math.min(24, value))} /></td>
                <td className="num">{device.normalKw.toLocaleString("ru-RU")}</td>
                <td><DraftInput type="number" value={device.peakPowerKw} onCommit={(value) => patch(device.id, "peakPowerKw", value)} /></td>
                <td className="num">{device.dailyKwh.toLocaleString("ru-RU")}</td>
                <td className="num">{(device.dailyKwh * model.daysPerMonth).toLocaleString("ru-RU")}</td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ ...model, devices: model.devices.filter((item) => item.id !== device.id) })}>Убрать</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={4}>Итого по ферме</th><th className="num">{totals.normalKw.toLocaleString("ru-RU")}</th><th className="num">{totals.peakKw.toLocaleString("ru-RU")}</th><th className="num">{totals.dailyKwh.toLocaleString("ru-RU")}</th><th className="num">{totals.monthlyKwh.toLocaleString("ru-RU")}</th><th /></tr></tfoot>
        </table>
      </div>
      <button type="button" className="btn btn-sm btn-outline" style={{ marginTop: 10 }} onClick={() => save({ ...model, devices: [...model.devices, newDevice()] })}>+ Добавить прибор</button>
      <div className="row wrap" style={{ gap: 12, marginTop: 14 }}>
        <label>Дней в месяце<DraftInput type="number" value={model.daysPerMonth} onCommit={(value) => save({ ...model, daysPerMonth: Math.max(1, value) })} /></label>
        <label>Стоимость 1 кВт·ч, ₽<DraftInput type="number" value={model.tariffPerKwh} onCommit={(value) => save({ ...model, tariffPerKwh: value })} /></label>
        <div className="card" style={{ padding: 10 }}><b>Затраты в месяц: <span className="num">{totals.monthlyCost.toLocaleString("ru-RU")} ₽</span></b></div>
      </div>
    </div>
  );
}
