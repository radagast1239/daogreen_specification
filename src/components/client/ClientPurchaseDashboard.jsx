import React from "react";
import { money } from "../../store/helpers.js";
import { clientPurchaseDashboard, supplierPurchaseProgress } from "../../../shared/clientPurchaseStats.js";

export default function ClientPurchaseDashboard({ items, currency, onModeSelect }) {
  const dash = clientPurchaseDashboard(items);
  const suppliers = supplierPurchaseProgress(items);

  const kpis = [
    { key: "total", label: "Всего", value: dash.totalCount, sub: money(dash.totalSum, currency) },
    { key: "bought", label: "Куплено", value: dash.boughtCount, sub: money(dash.boughtSum, currency) },
    { key: "remaining", label: "Осталось", value: dash.remainingCount, sub: money(dash.remainingSum, currency) },
    { key: "ordered", label: "Заказано", value: dash.orderedCount },
    { key: "need_help", label: "Нужна помощь", value: dash.needHelpCount, attention: true },
    { key: "replacement_check", label: "Замены на проверке", value: dash.replacementCount, attention: true },
  ];

  return (
    <div className="client-purchase-dashboard" style={{ marginBottom: 16 }}>
      <div className="stat-grid client-stat-grid--6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
        {kpis.map((k) => (
          <button
            key={k.key}
            type="button"
            className="card stat"
            style={{ textAlign: "left", cursor: onModeSelect ? "pointer" : "default" }}
            onClick={() => onModeSelect?.(k.key)}
          >
            <div className="k">{k.label}</div>
            <div className="v num" style={{ color: k.attention && k.value ? "var(--warn)" : undefined }}>
              {k.value}
            </div>
            {k.sub && (
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {k.sub}
              </div>
            )}
          </button>
        ))}
      </div>

      {suppliers.length > 0 && (
        <div className="card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Прогресс по поставщикам</strong>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="spec" style={{ margin: 0, fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Поставщик</th>
                  <th className="right">Всего</th>
                  <th className="right">Куплено</th>
                  <th className="right">Заказано</th>
                  <th className="right">Осталось</th>
                  <th className="right">Помощь</th>
                  <th className="right">Сумма</th>
                  <th className="right">Куплено ₽</th>
                  <th className="right">Осталось ₽</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.supplier}>
                    <td>{s.supplier}</td>
                    <td className="right num">{s.totalCount}</td>
                    <td className="right num">{s.boughtCount}</td>
                    <td className="right num">{s.orderedCount}</td>
                    <td className="right num">{s.remainingCount}</td>
                    <td className="right num">{s.needHelpCount || "—"}</td>
                    <td className="right num">{money(s.totalSum, currency)}</td>
                    <td className="right num">{money(s.boughtSum, currency)}</td>
                    <td className="right num">{money(s.remainingSum, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
