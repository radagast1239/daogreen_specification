import React from "react";

/**
 * Автоматическая готовность выдачи (не путать с ручным статусом).
 */
export default function ProjectReadinessBadge({
  readiness,
  onFilterSelect,
  compact = false,
}) {
  if (!readiness) return null;
  const empty = readiness.status === "empty" || readiness.isEmpty;
  const ok = readiness.status === "ok";
  const tone = empty ? "neutral" : ok ? "ok" : "danger";
  const chipTone = empty ? "neutral" : ok ? "ok" : "danger";

  return (
    <div className={`project-readiness-badge project-readiness-badge--${tone}`}>
      <span className={`chip chip--${chipTone}`}>
        {compact ? readiness.shortTitle : readiness.title}
      </span>
      {!ok && !empty && readiness.detailLines?.length > 0 ? (
        <div className="project-readiness-badge__counts">
          {readiness.detailLines.map((line) => {
            const clickable = !!onFilterSelect && !!line.filterKey;
            const Tag = clickable ? "button" : "span";
            return (
              <Tag
                key={line.key}
                type={clickable ? "button" : undefined}
                className={`project-readiness-badge__count${clickable ? " project-readiness-badge__count--btn" : ""}`}
                onClick={clickable ? () => onFilterSelect(line.filterKey) : undefined}
                title={clickable ? "Показать в спецификации" : undefined}
              >
                {line.label}: {line.count}
              </Tag>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
