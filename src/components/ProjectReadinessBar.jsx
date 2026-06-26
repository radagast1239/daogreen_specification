import React from "react";

function StatChip({ label, value, tone = "neutral", title }) {
  if (!value && value !== 0) return null;
  return (
    <span className={`readiness-bar__chip chip chip--${tone} chip-dot`} title={title}>
      {label}: <b className="num">{value}</b>
    </span>
  );
}

export default function ProjectReadinessBar({ stats, loading, onPrePublishCheck }) {
  if (loading && !stats) {
    return (
      <div className="readiness-bar card">
        <span className="muted" style={{ fontSize: 13 }}>Загрузка готовности…</span>
      </div>
    );
  }
  if (!stats) return null;

  const pct = stats.readinessPercent ?? 0;
  const pctTone = pct >= 90 ? "green" : pct >= 70 ? "amber" : "red";

  return (
    <div className="readiness-bar card no-print">
      <div className="readiness-bar__top between wrap" style={{ gap: 12 }}>
        <div className="readiness-bar__main">
          <div className="readiness-bar__percent">
            <span className={`readiness-bar__value readiness-bar__value--${pctTone} num`}>{pct}%</span>
            <span className="muted" style={{ fontSize: 12 }}>готовность спецификации</span>
          </div>
          <div className="readiness-bar__chips">
            <StatChip label="Позиций в проекте" value={stats.positionsInProject} />
            <StatChip label="Показано клиенту" value={stats.shownToClient} tone="green" />
            <StatChip label="Без цены" value={stats.withoutPrice} tone={stats.withoutPrice ? "amber" : "neutral"} />
            <StatChip label="Без ссылки" value={stats.withoutLink} tone="neutral" title="Не блокирует публикацию" />
            <StatChip label="Без фото" value={stats.withoutPhoto} tone={stats.withoutPhoto ? "amber" : "neutral"} />
            <StatChip label="Без поставщика" value={stats.withoutSupplier} tone={stats.withoutSupplier ? "amber" : "neutral"} />
            <StatChip label="Дубли в закупке" value={stats.purchaseDuplicates} tone={stats.purchaseDuplicates ? "amber" : "neutral"} />
            <StatChip label="Проблемные" value={stats.problematic} tone={stats.problematic ? "red" : "neutral"} />
            <StatChip label="На проверке" value={stats.onReview} tone={stats.onReview ? "amber" : "neutral"} />
            <StatChip label="Скрыто от клиента" value={stats.hiddenFromClient} tone="neutral" />
          </div>
        </div>
        {onPrePublishCheck && (
          <button type="button" className="btn btn-primary" onClick={onPrePublishCheck}>
            Проверить перед публикацией
          </button>
        )}
      </div>
    </div>
  );
}
