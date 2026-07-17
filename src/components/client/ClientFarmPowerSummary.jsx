import React from "react";
import { farmPowerTotals, normalizeFarmPower } from "../../../shared/farmPower.js";

export default function ClientFarmPowerSummary({ farmPower }) {
  const normalized = normalizeFarmPower(farmPower);
  const devices = normalized.devices.filter((device) => device.name || device.normalKw > 0 || device.peakKw > 0);
  if (!devices.length) return null;
  const totals = farmPowerTotals({ devices });
  return (
    <section className="card" style={{ padding: 16, marginTop: 20 }}>
      <h3 style={{ margin: "0 0 12px" }}>Электропотребление фермы</h3>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(2, minmax(160px, 1fr))", marginBottom: 12 }}>
        <div className="stat"><div className="k">Общее потребление</div><div className="v num">{totals.normalKw.toLocaleString("ru-RU")} кВт</div></div>
        <div className="stat"><div className="k">Пиковое потребление</div><div className="v num">{totals.peakKw.toLocaleString("ru-RU")} кВт</div></div>
      </div>
      <table className="spec">
        <thead><tr><th>Прибор</th><th className="right">Общее, кВт</th><th className="right">Пиковое, кВт</th></tr></thead>
        <tbody>{devices.map((device) => <tr key={device.id}><td>{device.name || "Прибор"}</td><td className="right num">{device.normalKw.toLocaleString("ru-RU")}</td><td className="right num">{device.peakKw.toLocaleString("ru-RU")}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
