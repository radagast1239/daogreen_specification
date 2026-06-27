import React from "react";
import { CATEGORIES } from "../plannerCategories.js";

const ICONS = {
  walls: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <path d="M3 12h18" />
    </svg>
  ),
  openings: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5" y="4" width="14" height="16" rx="1" />
      <path d="M12 16V8" />
    </svg>
  ),
  parts: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 6h16M4 12h10M4 18h16" />
    </svg>
  ),
  zones: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2" />
    </svg>
  ),
  racks: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5" y="4" width="14" height="16" rx="1" />
      <path d="M5 9h14M5 14h14M9 4v16M15 4v16" />
    </svg>
  ),
  furn: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="10" width="16" height="4" rx="1" />
      <path d="M6 14v4M18 14v4" />
    </svg>
  ),
  plumb: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <ellipse cx="12" cy="14" rx="5" ry="3" />
      <path d="M12 11V6M10 6h4" />
    </svg>
  ),
  water: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3c3 4 6 7 6 10a6 6 0 11-12 0c0-3 3-6 6-10z" />
    </svg>
  ),
  drain: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 8h12v8H6z" />
      <path d="M9 16v3M15 16v3" />
    </svg>
  ),
  power: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M13 2L5 14h7l-1 8 9-13h-7l1-7z" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="10" r="4" />
      <path d="M9 18h6M10 22h4" />
    </svg>
  ),
  climate: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3v15M8 9l4-4 4 4" />
      <path d="M6 20h12" />
    </svg>
  ),
  ac: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4" y="8" width="16" height="8" rx="1" />
      <path d="M7 11h10M7 13h10" />
    </svg>
  ),
  vent: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  cold: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="6" y="5" width="12" height="14" rx="1" />
      <path d="M9 9h6M9 13h6" />
    </svg>
  ),
  hygiene: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M8 4h8v4H8zM10 8v12M14 8v12" />
    </svg>
  ),
  routes: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 17l8-9" strokeDasharray="3 2" />
    </svg>
  ),
  safety: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l8 4v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" />
    </svg>
  ),
  comments: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 5h16v10H8l-4 4V5z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="6" />
      <path d="M15 15l5 5" />
    </svg>
  ),
  help: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 014.8 1c0 2-3 2-3 4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </svg>
  ),
};

export function CategoryIcon({ name }) {
  return ICONS[name] || ICONS.walls;
}

export function PlannerCategoryRail({ activeCategoryId, onPick, onSearch, onHelp }) {
  return (
    <nav className="planner-category-rail no-print" aria-label="Категории инструментов">
      <div className="planner-category-rail__main">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={"planner-category-btn" + (activeCategoryId === cat.id ? " planner-category-btn--active" : "")}
            onClick={() => onPick(cat)}
            title={cat.label}
            aria-label={cat.label}
          >
            <CategoryIcon name={cat.icon} />
          </button>
        ))}
      </div>
      <div className="planner-category-rail__footer">
        <button type="button" className="planner-category-btn" onClick={onSearch} title="Поиск" aria-label="Поиск">
          <CategoryIcon name="search" />
        </button>
        <button type="button" className="planner-category-btn" onClick={onHelp} title="Помощь" aria-label="Помощь">
          <CategoryIcon name="help" />
        </button>
        <button type="button" className="planner-category-btn" title="Видеоинструкция" aria-label="Видеоинструкция" disabled>
          <CategoryIcon name="video" />
        </button>
      </div>
    </nav>
  );
}
