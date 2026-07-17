import React, { useEffect, useRef, useState } from "react";
import { automaticFarmPowerDevices, farmPowerFingerprint, farmPowerTotals, normalizeFarmPower } from "../../shared/farmPower.js";

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
  const totals = farmPowerTotals({ devices: [...model.devices, ...automaticDevices] });
  const save = (rawNext) => {
    const next = normalizeFarmPower(rawNext);
    setModel(next);
    pendingFingerprint.current = farmPowerFingerprint(next);
    onChange({ ...(manualParams || {}), farmPower: next });
  };
  const patch = (id, field, value) => save({ ...model, devices: model.devices.map((device) => device.id === id ? { ...device, [field]: value } : device) });
  const scheduleFor = (roomId) => model.acSchedules.find((schedule) => schedule.roomId === roomId) || { roomId, dayKw: 0, dayHours: 16, nightKw: 0, nightHours: 8 };
  const patchSchedule = (roomId, field, value) => {
    const current = scheduleFor(roomId);
    const exists = model.acSchedules.some((schedule) => schedule.roomId === roomId);
    save({ ...model, acSchedules: exists
      ? model.acSchedules.map((schedule) => schedule.roomId === roomId ? { ...schedule, [field]: value } : schedule)
      : [...model.acSchedules, { ...current, [field]: value }],
    });
  };

  return (
    <div className="farm-power-editor">
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Освещение берётся из расчёта комнат автоматически. Для кондиционеров указывается только фактическое электрическое потребление — не мощность холода.
      </p>
      {(rooms || []).some((room) => room?.cooling?.params) && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <strong>Автоматически из расчётов комнат</strong>
          {(rooms || []).filter((room) => room?.cooling?.params).map((room) => {
            const roomId = String(room.id || "");
            const schedule = scheduleFor(roomId);
            const light = automaticFarmPowerDevices(model, [room]).find((device) => device.source === "cooling_lighting");
            return (
              <div key={room.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <b>{room.name || "Комната"}</b>
                <div className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                  Освещение: <span className="num">{(light?.normalKw || 0).toLocaleString("ru-RU")} кВт</span>
                  {light?.dailyKwh > 0 ? ` · ${light.dailyKwh.toLocaleString("ru-RU")} кВт·ч/сут` : ""}
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <label style={{ minWidth: 130 }}>Кондиционер день, кВт<DraftInput type="number" value={schedule.dayKw} onCommit={(value) => patchSchedule(roomId, "dayKw", value)} /></label>
                  <label style={{ minWidth: 110 }}>День, ч/сут<DraftInput type="number" value={schedule.dayHours} onCommit={(value) => patchSchedule(roomId, "dayHours", Math.min(24, value))} /></label>
                  <label style={{ minWidth: 130 }}>Кондиционер ночь, кВт<DraftInput type="number" value={schedule.nightKw} onCommit={(value) => patchSchedule(roomId, "nightKw", value)} /></label>
                  <label style={{ minWidth: 110 }}>Ночь, ч/сут<DraftInput type="number" value={schedule.nightHours} onCommit={(value) => patchSchedule(roomId, "nightHours", Math.min(24, value))} /></label>
                </div>
                {schedule.dayKw > 0 || schedule.nightKw > 0 ? (
                  <div className="muted" style={{ fontSize: 12, marginTop: 7 }}>
                    Кондиционер: {(schedule.dayKw * schedule.dayHours + schedule.nightKw * schedule.nightHours).toLocaleString("ru-RU")} кВт·ч/сут · пик {Math.max(schedule.dayKw, schedule.nightKw).toLocaleString("ru-RU")} кВт
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="spec" style={{ minWidth: 620 }}>
          <thead><tr><th>Прибор</th><th style={{ width: 150 }}>Общее, кВт</th><th style={{ width: 150 }}>Пиковое, кВт</th><th style={{ width: 70 }} /></tr></thead>
          <tbody>
            {model.devices.map((device) => (
              <tr key={device.id}>
                <td><DraftInput value={device.name} placeholder="Насос, вентилятор, кондиционер…" onCommit={(value) => patch(device.id, "name", value)} /></td>
                <td><DraftInput type="number" value={device.normalKw} onCommit={(value) => patch(device.id, "normalKw", value)} /></td>
                <td><DraftInput type="number" value={device.peakKw} onCommit={(value) => patch(device.id, "peakKw", value)} /></td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ ...model, devices: model.devices.filter((item) => item.id !== device.id) })}>Убрать</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th>Итого по ферме</th><th className="num">{totals.normalKw.toLocaleString("ru-RU")} кВт</th><th className="num">{totals.peakKw.toLocaleString("ru-RU")} кВт</th><th /></tr></tfoot>
        </table>
      </div>
      {automaticDevices.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Автоматических строк: {automaticDevices.length}. «Общее» для кондиционера — средняя электрическая мощность по заданным часам; «пиковое» — максимальный режим.
        </div>
      )}
      <button type="button" className="btn btn-sm btn-outline" style={{ marginTop: 10 }} onClick={() => save({ ...model, devices: [...model.devices, newDevice()] })}>+ Добавить прибор</button>
    </div>
  );
}
