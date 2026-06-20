import React, { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { berryCalculatorUrl, economicCalculatorUrl } from "../lib/calcUrls.js";
import GlobalSearch from "./GlobalSearch.jsx";
import { getCompactMode, setCompactMode } from "../lib/compactMode.js";
import { NavIcon } from "./NavIcons.jsx";

const NAV = [
  { to: "/", label: "Проекты", icon: "projects", end: true },
  { to: "/clients", label: "Клиенты", icon: "clients" },
  { to: "/materials", label: "Материалы", icon: "materials" },
  { to: "/modules", label: "Модули / разделы", icon: "modules" },
  { to: "/suppliers", label: "Поставщики", icon: "suppliers" },
  { to: "/reports", label: "Отчёты", icon: "reports" },
  { to: "/archive", label: "Архив", icon: "archive" },
  { to: "/settings", label: "Настройки", icon: "settings" },
  { to: "/new", label: "Новый проект", icon: "new" },
];

const CALC_LINKS = [
  { href: economicCalculatorUrl, label: "Калькулятор салатов", icon: "calc" },
  { href: berryCalculatorUrl, label: "Калькулятор ягод", icon: "berry" },
];

function SidebarNav({ compact, onToggleCompact, onNavigate }) {
  return (
    <>
      <div className="sidebar__head">
        <span className="eyebrow" style={{ color: "#9ecdb8" }}>Daogreen · Spec</span>
      </div>
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) => "navlink" + (isActive ? " active" : "")}
          onClick={onNavigate}
        >
          <NavIcon name={n.icon} />
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
          onClick={onNavigate}
        >
          <NavIcon name={n.icon} />
          {n.label}
          <span className="navlink__ext" aria-hidden>↗</span>
        </a>
      ))}
      <div className="spacer" />
      <button type="button" className="navlink navlink--toggle" onClick={onToggleCompact}>
        <NavIcon name="compact" />
        {compact ? "Обычные таблицы" : "Компактные таблицы"}
      </button>
      <div className="foot">Спецификации v1</div>
    </>
  );
}

export default function Layout() {
  const [compact, setCompact] = useState(getCompactMode());
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleCompact = () => {
    const next = !compact;
    setCompactMode(next);
    setCompact(next);
  };

  useEffect(() => {
    document.body.classList.toggle("nav-open", menuOpen);
    return () => document.body.classList.remove("nav-open");
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="shell">
      <button
        type="button"
        className="mobile-menu-btn no-print"
        aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <NavIcon name={menuOpen ? "close" : "menu"} />
      </button>
      {menuOpen && <button type="button" className="sidebar-backdrop" aria-label="Закрыть" onClick={closeMenu} />}
      <aside className={"sidebar" + (menuOpen ? " sidebar--open" : "")}>
        <SidebarNav compact={compact} onToggleCompact={toggleCompact} onNavigate={closeMenu} />
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
