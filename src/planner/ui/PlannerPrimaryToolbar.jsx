import React from "react";

const ICON = {
  select: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M5 3l6 16 2-6 6-2L5 3z" />
    </svg>
  ),
  walls: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 8h16v8H4z" />
      <path d="M4 12h16" />
      <path d="M9 8v8M15 8v8" />
    </svg>
  ),
  door: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <circle cx="15" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M12 21V3" opacity="0.35" />
    </svg>
  ),
  window: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="1" />
      <path d="M12 5v14M4 12h16" />
    </svg>
  ),
  measure: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 16l12-12 4 4-12 12H4v-4z" />
      <path d="M9 15l2-2M12 12l2-2M15 9l2-2" />
    </svg>
  ),
  objects: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  ),
  engineering: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M13 2L5 14h7l-1 8 9-13h-7l1-7z" />
    </svg>
  ),
  zones: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3.5 2.5" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  ),
  pan: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M12 3v18M3 12h18" />
      <path d="M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" />
    </svg>
  ),
};

export const PRIMARY_TOOLS = [
  { id: "select", label: "Выбор", icon: "select", title: "Выбор (Esc)" },
  { id: "walls", label: "Стены", icon: "walls", title: "Стены и перегородки" },
  { id: "door", label: "Дверь", icon: "door", title: "Дверь" },
  { id: "window", label: "Окно", icon: "window", title: "Окно" },
  { id: "measure", label: "Размер", icon: "measure", title: "Размеры" },
  { id: "objects", label: "Объекты", icon: "objects", title: "Стеллажи и объекты" },
  { id: "engineering", label: "Инженерия", icon: "engineering", title: "Инженерные сети" },
  { id: "zones", label: "Зоны", icon: "zones", title: "Зоны фермы" },
  { id: "pan", label: "Панорама", icon: "pan", title: "Панорама (рука)" },
];

export function PlannerPrimaryToolbar({ activeToolKey = "select", onPick }) {
  return (
    <nav className="planner-primary-toolbar no-print" aria-label="Основные инструменты">
      {PRIMARY_TOOLS.map((t) => {
        const active = activeToolKey === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className={"planner-primary-tool" + (active ? " is-active" : "")}
            title={t.title}
            aria-label={t.label}
            aria-pressed={active}
            onClick={() => onPick?.(t.id)}
          >
            <span className="planner-primary-tool__icon">{ICON[t.icon]}</span>
            <span className="planner-primary-tool__label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
