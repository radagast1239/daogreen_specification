import React from "react";
import { Link } from "react-router-dom";
import { money } from "../store/helpers.js";

function DashSection({ title, tone, items, renderLine }) {
  if (!items?.length) return null;
  return (
    <div className={`home-dash-section home-dash-section--${tone}`}>
      <div className="home-dash-section__title">{title}</div>
      <ul className="home-dash-section__list">
        {items.slice(0, 8).map((row) => (
          <li key={`${row.type}-${row.projectId}`}>{renderLine(row)}</li>
        ))}
      </ul>
      {items.length > 8 && <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>…ещё {items.length - 8}</p>}
    </div>
  );
}

export default function HomeDashboard({ dash }) {
  if (!dash) return null;
  const g = dash.groups || {};

  return (
    <div className="home-dashboard">
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="k">Проектов</div>
          <div className="v num">{dash.projectCount}</div>
        </div>
        <div className="card stat">
          <div className="k">Без фото (база)</div>
          <div className="v num">{dash.noPhoto}</div>
        </div>
        <div className="card stat">
          <div className="k">Чеклист ✕</div>
          <div className="v num" style={{ color: g.publishCheck?.length ? "var(--danger)" : undefined }}>
            {g.publishCheck?.length || 0}
          </div>
        </div>
        <div className="card stat">
          <div className="k">Нужна помощь</div>
          <div className="v num" style={{ color: g.needHelp?.length ? "#c45a00" : undefined }}>
            {g.needHelp?.length || 0}
          </div>
        </div>
      </div>

      <div className="home-dash-grid">
        <DashSection
          title="Красный чеклист — не готово к клиенту"
          tone="danger"
          items={g.publishCheck}
          renderLine={(p) => (
            <>
              <Link to={`/project/${p.projectId}`}>{p.name}</Link>
              <span className="muted"> — {p.issueCount} замечаний · для клиента {p.clientItems} поз.</span>
            </>
          )}
        />
        <DashSection
          title="Нужна помощь (клиент)"
          tone="warn"
          items={g.needHelp}
          renderLine={(p) => (
            <>
              <Link to={`/project/${p.projectId}`}>{p.name}</Link>
              <span className="muted"> — {p.count} поз.</span>
            </>
          )}
        />
        <DashSection
          title="Клиент давно не отмечал"
          tone="muted"
          items={g.inactiveClient}
          renderLine={(p) => (
            <>
              <Link to={`/project/${p.projectId}`}>{p.name}</Link>
              <span className="muted">
                {" "}
                — закупка {p.progress}% · {p.days >= 999 ? "нет активности" : `${p.days} дн. назад`}
              </span>
            </>
          )}
        />
        <DashSection
          title="Застряли на закупке"
          tone="stuck"
          items={g.stuckPurchase}
          renderLine={(p) => (
            <>
              <Link to={`/project/${p.projectId}`}>{p.name}</Link>
              <span className="muted"> — {p.progress}% · без движения {p.days >= 999 ? "давно" : `${p.days} дн.`}</span>
            </>
          )}
        />
      </div>

      {dash.analyticsPreview?.avgBudgetByType?.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div className="between wrap" style={{ gap: 8, marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>Средний бюджет по типу фермы</strong>
            <Link to="/reports" className="btn btn-sm btn-ghost">
              Все отчёты →
            </Link>
          </div>
          <div className="home-analytics-preview">
            {dash.analyticsPreview.avgBudgetByType.map((r) => (
              <div key={r.type} className="home-analytics-preview__row">
                <span>{r.type}</span>
                <span className="muted">{r.count} пр.</span>
                <span className="num" style={{ fontWeight: 700 }}>
                  {money(r.avgBudget)}
                </span>
              </div>
            ))}
          </div>
          {(dash.analyticsPreview.costPerM2Count > 0 || dash.analyticsPreview.timelineCount > 0) && (
            <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
              {dash.analyticsPreview.costPerM2Count > 0 && `₽/м²: ${dash.analyticsPreview.costPerM2Count} проект(ов) · `}
              {dash.analyticsPreview.timelineCount > 0 && `срок закупка→монтаж: ${dash.analyticsPreview.timelineCount} проект(ов)`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
