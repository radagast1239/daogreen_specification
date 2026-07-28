import React from "react";
import { money } from "../../store/helpers.js";
import { lineGross } from "../../lib/itemHelpers.js";
import { groupByClientSection, resolveClientSection } from "../../../shared/clientSections.js";
import { isBoughtStatus } from "./ClientItemCard.jsx";
import ActivityFeed from "../ActivityFeed.jsx";
import { Progress } from "../ui.jsx";
import ClientCoolingCalculations from "./ClientCoolingCalculations.jsx";
import ClientFarmPowerSummary from "./ClientFarmPowerSummary.jsx";
import { t, tSection } from "../../../shared/clientI18n.js";

export default function ClientOverviewPanel({
  project,
  totals,
  items,
  branding,
  activity,
  qrUrl,
  onOpenPurchase,
  language = "ru",
}) {
  const sections = groupByClientSection(items);
  const boughtCount = items.filter((i) => isBoughtStatus(i.status)).length;

  return (
    <div className="client-overview" style={{ marginTop: 16 }}>
      <div className="stat-grid client-stat-grid--4">
        <div className="card stat">
          <div className="k">{t(language, "client.overview.total")}</div>
          <div className="v num">{money(totals.budget, project.currency)}</div>
        </div>
        <div className="card stat">
          <div className="k">{t(language, "client.overview.bought")}</div>
          <div className="v num">{money(totals.spent, project.currency)}</div>
        </div>
        <div className="card stat">
          <div className="k">{t(language, "client.overview.remaining")}</div>
          <div className="v num">{money(totals.remaining, project.currency)}</div>
        </div>
        <div className="card stat">
          <div className="k">{t(language, "client.overview.readiness")}</div>
          <div className="v num">{totals.progress}%</div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <Progress value={totals.progress} />
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          {t(language, "client.overview.boughtCount", { bought: boughtCount, total: items.length })}
        </p>
      </div>

      <ClientCoolingCalculations rooms={project.rooms || []} />
      <ClientFarmPowerSummary farmPower={project.farmPower} />

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <strong style={{ fontSize: 16, color: "var(--brand)" }}>{t(language, "client.overview.nextStepsTitle")}</strong>
        <div style={{ margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3, 4, 5, 6, 7].map((step) => (
            <div className="client-next-step" key={step}>
              <b>{t(language, `client.guide.step${step}.title`)}</b>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
                {t(language, `client.guide.step${step}.text`)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <h3 style={{ marginTop: 20 }}>{t(language, "client.overview.sectionsTitle")}</h3>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        {t(language, "client.overview.sectionsHint")}
      </p>
      {sections.map(([title, list]) => {
        const sum = list.reduce((s, i) => s + lineGross(i), 0);
        const done = list.filter((i) => isBoughtStatus(i.status)).length;
        const pct = list.length ? Math.round((done / list.length) * 100) : 0;
        const sectionId = resolveClientSection(list[0] || {}).section || null;
        const sectionTitle = tSection(language, sectionId, title);
        return (
          <button
            key={sectionId || title}
            type="button"
            className="client-section-card between panel"
            style={{ padding: 12, marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer" }}
            onClick={() => onOpenPurchase?.(sectionId)}
          >
            <span>
              <strong>{sectionTitle}</strong>
              <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                {t(language, "client.overview.sectionMeta", { n: list.length, pct })}
              </span>
            </span>
            <span className="muted num" style={{ fontSize: 13 }}>{money(sum, project.currency)}</span>
          </button>
        );
      })}

      <div style={{ marginTop: 20 }}>
        <ActivityFeed activity={activity} title={t(language, "client.overview.activityTitle")} />
      </div>

      {qrUrl && (
        <div className="card" style={{ padding: 16, marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <img src={qrUrl} alt={t(language, "client.overview.qrTitle")} width={120} height={120} />
          <div>
            <strong>{t(language, "client.overview.qrTitle")}</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              {t(language, "client.overview.qrHint", { company: branding?.companyName || "Daogreen" })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
