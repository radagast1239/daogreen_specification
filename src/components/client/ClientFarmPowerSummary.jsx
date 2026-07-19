import React from "react";
import { farmPowerTotals, normalizeFarmPower } from "../../../shared/farmPower.js";

export default function ClientFarmPowerSummary({ farmPower }) {
  const normalized = normalizeFarmPower(farmPower);
  const devices = normalized.devices.filter((device) => device.name || device.normalKw > 0 || device.peakKw > 0);
  if (!devices.length) return null;
  const totals = farmPowerTotals({ ...normalized, devices });
  return (
    <section className="card" style={{ padding: 16, marginTop: 20, overflow: "hidden" }}>
      <h3 style={{ margin: "0 0 12px" }}>Электропотребление фермы</h3>
      <div className="stat-grid client-stat-grid--4" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="k">Установленная мощность</div><div className="v num">{totals.normalKw.toLocaleString("ru-RU")} кВт</div></div>
        <div className="stat"><div className="k">Пиковое потребление</div><div className="v num">{totals.peakKw.toLocaleString("ru-RU")} кВт</div></div>
        <div className="stat"><div className="k">Потребление в месяц</div><div className="v num">{totals.monthlyKwh.toLocaleString("ru-RU")} кВт·ч</div></div>
        <div className="stat"><div className="k">Затраты в месяц</div><div className="v num">{totals.monthlyCost.toLocaleString("ru-RU")} ₽</div><div className="muted">{normalized.tariffPerKwh.toLocaleString("ru-RU")} ₽/кВт·ч</div></div>
      </div>
      <div className="table-scroll-wrap">
        <table className="spec">
          <thead><tr><th>Прибор</th><th className="right">Установлено, кВт</th><th className="right">Пиковое, кВт</th><th className="right">кВт·ч/сут</th><th className="right">кВт·ч/мес</th></tr></thead>
          <tbody>{devices.map((device) => <tr key={device.id}><td>{device.name || "Прибор"}{device.details ? <div className="muted" style={{ fontSize: 11 }}>{device.details}</div> : null}</td><td className="right num">{device.normalKw.toLocaleString("ru-RU")}</td><td className="right num">{device.peakKw.toLocaleString("ru-RU")}</td><td className="right num">{device.dailyKwh > 0 ? device.dailyKwh.toLocaleString("ru-RU") : "—"}</td><td className="right num">{device.dailyKwh > 0 ? (device.dailyKwh * normalized.daysPerMonth).toLocaleString("ru-RU") : "—"}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
