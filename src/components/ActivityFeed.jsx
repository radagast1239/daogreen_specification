import React from "react";

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function ActivityFeed({ activity = [], title = "История изменений", limit = 30 }) {
  const rows = activity.slice(0, limit);
  if (!rows.length) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <h4 style={{ margin: "0 0 8px" }}>{title}</h4>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Пока нет записей — изменения статусов и комментариев появятся здесь.</p>
      </div>
    );
  }

  return (
    <div className="card activity-feed" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 700 }}>{title}</div>
      <ul className="activity-feed__list">
        {rows.map((a) => (
          <li key={a.id} className={`activity-feed__item activity-feed__item--${a.actor}`}>
            <span className={`activity-feed__badge activity-feed__badge--${a.actor}`}>
              {a.actor === "client" ? "Клиент" : "Daogreen"}
            </span>
            <span className="activity-feed__text">{a.summary}</span>
            <time className="activity-feed__time muted">{fmtTime(a.createdAt)}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
