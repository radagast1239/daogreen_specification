import React from "react";
import CoolingFarmTab from "../CoolingFarmTab.jsx";
import { roomAcRecommendedBtu, roomAcRecommendedElecKw, roomAcRecommendedKw } from "../../../shared/roomAcSpec.js";

function fmt(value, maximumFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("ru-RU", { maximumFractionDigits });
}

function RoomAcSelection({ room }) {
  const units = (room.acUnits || []).filter((unit) => Number(unit?.qty) > 0 || Number(unit?.coolingKw) > 0 || unit?.link);
  if (!units.length) return null;
  return (
    <div className="card" style={{ padding: 14, margin: "12px 0" }}>
      <strong>Подобранные кондиционеры</strong>
      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
        {units.map((unit, index) => (
          <li key={unit.id || index} style={{ marginBottom: 6 }}>
            <span className="num">{fmt(unit.qty || 1, 0)} шт.</span>
            {Number(unit.coolingKw) > 0 ? <> × <span className="num">{fmt(unit.coolingKw)} кВт</span></> : null}
            {unit.link ? <> · <a href={unit.link} target="_blank" rel="noreferrer">ссылка на модель</a></> : null}
            {unit.comment ? <div className="muted" style={{ fontSize: 12 }}>{unit.comment}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ClientCoolingCalculations({ rooms = [] }) {
  const calculatedRooms = (rooms || []).filter((room) => room?.cooling?.params);
  if (!calculatedRooms.length) return null;

  return (
    <section className="client-cooling-calculations" style={{ marginTop: 20 }}>
      <h3 style={{ marginBottom: 6 }}>Расчёт кондиционирования по комнатам</h3>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
        Зафиксированный расчёт из опубликованной версии проекта. Откройте комнату, чтобы увидеть все исходные параметры и результаты.
      </p>
      {calculatedRooms.map((room, index) => (
        <details key={room.id || index} className="card" style={{ padding: 14, marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            {room.name || `Комната ${index + 1}`}
            {roomAcRecommendedKw(room) > 0 ? ` · ${fmt(roomAcRecommendedKw(room))} кВт` : ""}
            {roomAcRecommendedBtu(room) > 0 ? ` · ${fmt(roomAcRecommendedBtu(room), 0)} BTU` : ""}
            {roomAcRecommendedElecKw(room) > 0 ? ` · потребление ~${fmt(roomAcRecommendedElecKw(room))} кВт` : ""}
          </summary>
          <RoomAcSelection room={room} />
          <CoolingFarmTab inputs={room.cooling.params} variant="client_full" />
        </details>
      ))}
    </section>
  );
}
