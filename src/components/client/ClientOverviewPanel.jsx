import React from "react";
import { money } from "../../store/helpers.js";
import { lineGross } from "../../lib/itemHelpers.js";
import { groupByClientSection } from "../../../shared/clientSections.js";
import { isBoughtStatus } from "./ClientItemCard.jsx";
import ActivityFeed from "../ActivityFeed.jsx";
import { Progress } from "../ui.jsx";

export default function ClientOverviewPanel({
  project,
  totals,
  items,
  branding,
  activity,
  qrUrl,
  onOpenPurchase,
}) {
  const sections = groupByClientSection(items);
  const boughtCount = items.filter((i) => isBoughtStatus(i.status)).length;

  const nextSteps = [];
  if (sections.some(([t]) => /стеллаж/i.test(t))) nextSteps.push("Закупить позиции из раздела «Стеллажи и каркас»");
  if (items.some((i) => i.responsible === "plumber")) nextSteps.push("Передать список сантехнику");
  if (items.some((i) => i.responsible === "electrician")) nextSteps.push("Передать список электрику");
  nextSteps.push("Отметить купленные позиции в разделе «Закупка»");

  return (
    <div className="client-overview" style={{ marginTop: 16 }}>
      <div className="stat-grid client-stat-grid--4">
        <div className="card stat">
          <div className="k">Всего</div>
          <div className="v num">{money(totals.budget, project.currency)}</div>
        </div>
        <div className="card stat">
          <div className="k">Куплено</div>
          <div className="v num">{money(totals.spent, project.currency)}</div>
        </div>
        <div className="card stat">
          <div className="k">Осталось</div>
          <div className="v num">{money(totals.remaining, project.currency)}</div>
        </div>
        <div className="card stat">
          <div className="k">Готовность</div>
          <div className="v num">{totals.progress}%</div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <Progress value={totals.progress} />
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Куплено {boughtCount} из {items.length} позиций
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <strong>Что делать дальше</strong>
        <ol style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: 14 }}>
          {nextSteps.map((s) => (
            <li key={s} style={{ marginBottom: 6 }}>{s}</li>
          ))}
        </ol>
      </div>

      <h3 style={{ marginTop: 20 }}>По разделам закупки</h3>
      {sections.map(([title, list]) => {
        const sum = list.reduce((s, i) => s + lineGross(i), 0);
        const done = list.filter((i) => isBoughtStatus(i.status)).length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        return (
          <button
            key={title}
            type="button"
            className="client-section-card between panel"
            style={{ padding: 12, marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer" }}
            onClick={() => onOpenPurchase?.()}
          >
            <span>
              <strong>{title}</strong>
              <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                {list.length} поз. · готово {pct}%
              </span>
            </span>
            <span className="muted num" style={{ fontSize: 13 }}>{money(sum, project.currency)}</span>
          </button>
        );
      })}

      <div style={{ marginTop: 20 }}>
        <ActivityFeed activity={activity} title="Что менялось (вы и Daogreen)" />
      </div>

      {qrUrl && (
        <div className="card" style={{ padding: 16, marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <img src={qrUrl} alt="QR ссылка проекта" width={120} height={120} />
          <div>
            <strong>QR-код проекта</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              {branding?.companyName || "Daogreen"} · отсканируйте для открытия на телефоне
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
