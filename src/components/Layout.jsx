import React, { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { berryCalculatorUrl, economicCalculatorUrl } from "../lib/calcUrls.js";
import GlobalSearch from "./GlobalSearch.jsx";
import { getCompactMode, setCompactMode } from "../lib/compactMode.js";

const NAV = [
  { to: "/", label: "Проекты", ic: "▣", end: true },
  { to: "/clients", label: "Клиенты", ic: "◎" },
  { to: "/materials", label: "Материалы", ic: "▤" },
  { to: "/modules", label: "Модули / разделы", ic: "▦" },
  { to: "/suppliers", label: "Поставщики", ic: "◇" },
  { to: "/archive", label: "Архив", ic: "▢" },
  { to: "/settings", label: "Настройки", ic: "⚙" },
  { to: "/new", label: "Новый проект", ic: "＋" },
];

const CALC_LINKS = [
  { href: economicCalculatorUrl, label: "Калькулятор салатов", ic: "◫" },
  { href: berryCalculatorUrl, label: "Калькулятор ягод", ic: "◉" },
];

export default function Layout() {
  const [compact, setCompact] = useState(getCompactMode());

  const toggleCompact = () => {
    const next = !compact;
    setCompactMode(next);
    setCompact(next);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__head">
          <span className="eyebrow" style={{ color: "#9ecdb8" }}>Daogreen · Spec</span>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => "navlink" + (isActive ? " active" : "")}
          >
            <span className="ic">{n.ic}</span>
            {n.label}
          </NavLink>
        ))}
        <div className="sidebar__sep">Калькуляторы</div>
        {CALC_LINKS.map((n) => (
          <a
            key={n.label}
            className="navlink navlink--ext"
            href={n.href()}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="ic">{n.ic}</span>
            {n.label}
            <span className="navlink__ext" aria-hidden>↗</span>
          </a>
        ))}
        <div className="spacer" />
        <button type="button" className="navlink navlink--toggle" onClick={toggleCompact}>
          <span className="ic">≡</span>
          {compact ? "Обычные таблицы" : "Компактные таблицы"}
        </button>
        <div className="foot">Спецификации v1</div>
      </aside>
      <div className="main">
        <GlobalSearch />
        <div className="main-inner">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, sub, actions, breadcrumbs }) {
  return (
    <header className="page-head">
      <div>
        {breadcrumbs}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  );
}
