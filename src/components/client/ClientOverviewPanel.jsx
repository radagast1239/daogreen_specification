import React from "react";
import { money } from "../../store/helpers.js";
import { lineGross } from "../../lib/itemHelpers.js";
import { groupByClientSection, resolveClientSection } from "../../../shared/clientSections.js";
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
        <strong style={{ fontSize: 16, color: "var(--brand)" }}>Что делать дальше</strong>
        <div style={{ margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="client-next-step">
            <b>1. Начните с приоритетных позиций</b>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Откройте закупку и сначала проверьте позиции, которые нужны в первую очередь или требуют долгой доставки.</p>
          </div>
          <div className="client-next-step">
            <b>2. Закупайте по разделам или поставщикам</b>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Можно идти по блокам фермы или открыть список по магазинам.</p>
          </div>
          <div className="client-next-step">
            <b>3. После оплаты отметьте <span style={{ color: "var(--accent)" }}>“Заказано”</span></b>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Так будет видно, что позиция уже в работе.</p>
          </div>
          <div className="client-next-step">
            <b>4. После получения отметьте <span style={{ color: "var(--ok, #2e7d32)" }}>“Куплено”</span></b>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Прогресс закупки сохранится автоматически.</p>
          </div>
          <div className="client-next-step">
            <b>5. Если товар уже есть — отметьте <span style={{ color: "var(--ok, #2e7d32)" }}>“Уже есть”</span></b>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Позиция уйдёт из активной закупки.</p>
          </div>
          <div className="client-next-step">
            <b>6. Если товара нет или нужна замена — нажмите <span style={{ color: "var(--bad, #d32f2f)" }}>“Нужна помощь”</span></b>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Daogreen проверит замену или подберёт аналог.</p>
          </div>
          <div className="client-next-step">
            <b>7. Документы для специалистов находятся во вкладке <span>“Документы”</span></b>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>PDF и Excel можно передать сантехнику, электрику или монтажнику.</p>
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 20 }}>По разделам закупки</h3>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Нажмите на раздел — откроется «Купить сейчас» с этим разделом.
      </p>
      {sections.map(([title, list]) => {
        const sum = list.reduce((s, i) => s + lineGross(i), 0);
        const done = list.filter((i) => isBoughtStatus(i.status)).length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        const sectionId = resolveClientSection(list[0] || {}).section || null;
        return (
          <button
            key={title}
            type="button"
            className="client-section-card between panel"
            style={{ padding: 12, marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer" }}
            onClick={() => onOpenPurchase?.(sectionId)}
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
