import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { money } from "../../store/helpers.js";
import { PageHeader } from "../../components/Layout.jsx";

export default function ReportsPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getAnalytics().then(setData).catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <>
        <PageHeader title="Отчёты и аналитика" sub="Загрузка…" />
      </>
    );
  }

  const mr = data.materialsReport;

  return (
    <>
      <PageHeader title="Отчёты и аналитика" sub="Статистика по проектам и базе материалов" />
      <div className="content">
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          <div className="card stat">
            <div className="k">Без фото</div>
            <div className="v num">{mr.noPhoto}</div>
          </div>
          <div className="card stat">
            <div className="k">Без цены</div>
            <div className="v num">{mr.noPrice}</div>
          </div>
          <div className="card stat">
            <div className="k">Без ссылки</div>
            <div className="v num">{mr.noLink}</div>
          </div>
          <div className="card stat">
            <div className="k">Материалов всего</div>
            <div className="v num">{mr.total}</div>
          </div>
        </div>

        <CollapsibleBlock title="Себестоимость 1 м² посевной площади">
          {data.costPerM2.length === 0 ? (
            <p className="muted">Укажите «посевную площадь» в проектах.</p>
          ) : (
            <table className="spec card" style={{ padding: 8 }}>
              <thead>
                <tr>
                  <th>Проект</th>
                  <th>Тип</th>
                  <th className="right">м²</th>
                  <th className="right">Бюджет</th>
                  <th className="right">₽/м²</th>
                </tr>
              </thead>
              <tbody>
                {data.costPerM2.map((r) => (
                  <tr key={r.projectId}>
                    <td>
                      <Link to={`/project/${r.projectId}`}>{r.name}</Link>
                    </td>
                    <td>{r.type}</td>
                    <td className="right num">{r.sowingArea}</td>
                    <td className="right num">{money(r.budget)}</td>
                    <td className="right num" style={{ fontWeight: 700 }}>
                      {money(r.perM2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CollapsibleBlock>

        <CollapsibleBlock title="Средний бюджет по типу фермы">
          <table className="spec card" style={{ padding: 8 }}>
            <thead>
              <tr>
                <th>Тип</th>
                <th className="right">Проектов</th>
                <th className="right">Средний бюджет</th>
              </tr>
            </thead>
            <tbody>
              {data.avgBudgetByType.map((r) => (
                <tr key={r.type}>
                  <td>{r.type}</td>
                  <td className="right num">{r.count}</td>
                  <td className="right num">{money(r.avgBudget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleBlock>

        <CollapsibleBlock title="Закупка → монтаж (дни)">
          {data.purchaseToInstallDays.length === 0 ? (
            <p className="muted">Нужны даты: первая отметка «куплено» и статус «Смонтировано» у клиента.</p>
          ) : (
            <table className="spec card" style={{ padding: 8 }}>
              <thead>
                <tr>
                  <th>Проект</th>
                  <th>Клиент</th>
                  <th className="right">Дней</th>
                </tr>
              </thead>
              <tbody>
                {data.purchaseToInstallDays.map((r) => (
                  <tr key={r.projectId}>
                    <td>
                      <Link to={`/project/${r.projectId}`}>{r.name}</Link>
                    </td>
                    <td>{r.client}</td>
                    <td className="right num">{r.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CollapsibleBlock>
      </div>
    </>
  );
}

function CollapsibleBlock({ title, children }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  );
}
