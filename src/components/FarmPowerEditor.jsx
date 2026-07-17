import React, { useEffect, useRef, useState } from "react";
import { farmPowerFingerprint, farmPowerTotals, normalizeFarmPower } from "../../shared/farmPower.js";

function newDevice() {
  return { id: `power_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name: "", normalKw: 0, peakKw: 0 };
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

export default function FarmPowerEditor({ manualParams, onChange }) {
  const incoming = normalizeFarmPower(manualParams?.farmPower);
  const [devices, setDevices] = useState(incoming.devices);
  const pendingFingerprint = useRef("");
  const incomingFingerprint = farmPowerFingerprint(incoming);
  useEffect(() => {
    if (pendingFingerprint.current && incomingFingerprint !== pendingFingerprint.current) return;
    pendingFingerprint.current = "";
    setDevices(incoming.devices);
  }, [incomingFingerprint]);
  const farmPower = { devices };
  const totals = farmPowerTotals(farmPower);
  const save = (nextDevices) => {
    const next = normalizeFarmPower({ devices: nextDevices });
    setDevices(next.devices);
    pendingFingerprint.current = farmPowerFingerprint(next);
    onChange({ ...(manualParams || {}), farmPower: next });
  };
  const patch = (id, field, value) => save(farmPower.devices.map((device) => device.id === id ? { ...device, [field]: value } : device));

  return (
    <div className="farm-power-editor">
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Ручной ввод. Укажите обычную и пиковую мощность каждого электрического прибора.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="spec" style={{ minWidth: 620 }}>
          <thead><tr><th>Прибор</th><th style={{ width: 150 }}>Общее, кВт</th><th style={{ width: 150 }}>Пиковое, кВт</th><th style={{ width: 70 }} /></tr></thead>
          <tbody>
            {farmPower.devices.map((device) => (
              <tr key={device.id}>
                <td><DraftInput value={device.name} placeholder="Насос, вентилятор, кондиционер…" onCommit={(value) => patch(device.id, "name", value)} /></td>
                <td><DraftInput type="number" value={device.normalKw} onCommit={(value) => patch(device.id, "normalKw", value)} /></td>
                <td><DraftInput type="number" value={device.peakKw} onCommit={(value) => patch(device.id, "peakKw", value)} /></td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => save(farmPower.devices.filter((item) => item.id !== device.id))}>Убрать</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th>Итого по ферме</th><th className="num">{totals.normalKw.toLocaleString("ru-RU")} кВт</th><th className="num">{totals.peakKw.toLocaleString("ru-RU")} кВт</th><th /></tr></tfoot>
        </table>
      </div>
      <button type="button" className="btn btn-sm btn-outline" style={{ marginTop: 10 }} onClick={() => save([...farmPower.devices, newDevice()])}>+ Добавить прибор</button>
    </div>
  );
}
