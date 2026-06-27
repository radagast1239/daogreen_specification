import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { berryCalculatorUrl, economicCalculatorUrl, saladEconomicsUrl } from "../lib/calcUrls.js";
import GlobalSearch from "./GlobalSearch.jsx";
import { getCompactMode, setCompactMode } from "../lib/compactMode.js";
import { getSidebarCollapsed, setSidebarCollapsed } from "../lib/sidebarPrefs.js";
import { NavIcon } from "./NavIcons.jsx";
import { useStore } from "../store/StoreContext.jsx";

const NAV = [
  { to: "/", label: "Проекты", icon: "projects", end: true },
  { to: "/clients", label: "Клиенты", icon: "clients" },
  { to: "/materials", label: "Материалы", icon: "materials" },
  { to: "/modules", label: "Модули и шаблоны", icon: "modules" },
  { to: "/suppliers", label: "Поставщики", icon: "suppliers" },
  { to: "/reports", label: "Отчёты", icon: "reports" },
  { to: "/archive", label: "Архив", icon: "archive" },
  { to: "/settings", label: "Настройки", icon: "settings" },
  { to: "/new", label: "Новый проект", icon: "new" },
];

const CALC_LINKS = [
  { href: economicCalculatorUrl, label: "Калькулятор салатов", icon: "calc" },
  { href: saladEconomicsUrl, label: "Экономика", icon: "economics" },
  { href: berryCalculatorUrl, label: "Калькулятор ягод", icon: "berry" },
];

function NavItem({ to, end, label, icon, onNavigate, collapsed }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => "navlink" + (isActive ? " active" : "")}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
    >
      <NavIcon name={icon} />
      <span className="navlink__label">{label}</span>
    </NavLink>
  );
}

function ExtNavItem({ href, label, icon, onNavigate, collapsed }) {
  return (
    <a
      className="navlink navlink--ext"
      href={href()}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      title={collapsed ? label : undefined}
    >
      <NavIcon name={icon} />
      <span className="navlink__label">{label}</span>
      <span className="navlink__ext" aria-hidden>↗</span>
    </a>
  );
}

function SidebarNav({ compact, collapsed, onToggleCompact, onToggleCollapse, onNavigate }) {
  return (
    <>
      <div className="sidebar__head">
        <div className="sidebar__brand" title="Daogreen · Spec">
          <span className="sidebar__brand-mark" aria-hidden>DG</span>
          <span className="sidebar__brand-text eyebrow">Daogreen · Spec</span>
        </div>
        <button
          type="button"
          className="sidebar__toggle no-print"
          onClick={onToggleCollapse}
          title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
        >
          <NavIcon name={collapsed ? "panel-open" : "panel-close"} />
        </button>
      </div>

      {NAV.map((n) => (
        <NavItem key={n.to} {...n} onNavigate={onNavigate} collapsed={collapsed} />
      ))}

      <div className="sidebar__sep" title={collapsed ? "Планировщик" : undefined}>
        <span className="sidebar__sep-text">Планировщик</span>
      </div>
      <NavItem to="/planner" label="Планировщик" icon="planner" onNavigate={onNavigate} collapsed={collapsed} />

      <div className="sidebar__sep" title={collapsed ? "Калькуляторы" : undefined}>
        <span className="sidebar__sep-text">Калькуляторы</span>
      </div>
      {CALC_LINKS.map((n) => (
        <ExtNavItem key={n.label} {...n} onNavigate={onNavigate} collapsed={collapsed} />
      ))}

      <div className="spacer" />
      <button
        type="button"
        className="navlink navlink--toggle"
        onClick={onToggleCompact}
        title={collapsed ? (compact ? "Обычные таблицы" : "Компактные таблицы") : undefined}
      >
        <NavIcon name="compact" />
        <span className="navlink__label">{compact ? "Обычные таблицы" : "Компактные таблицы"}</span>
      </button>
      <div className="foot">Спецификации v1</div>
    </>
  );
}

export default function Layout() {
  const [compact, setCompact] = useState(getCompactMode());
  const [collapsed, setCollapsed] = useState(getSidebarCollapsed());
  const [menuOpen, setMenuOpen] = useState(false);
  const { actions } = useStore();
  const { pathname } = useLocation();

  const wideLayout = /^\/(materials|project\/|modules|reports|planner)/.test(pathname);
  const plannerFocus = /\/project\/[^/]+\/plan$/.test(pathname);

  useEffect(() => {
    const needMats = /^\/(materials|modules|new|project\/|planner)/.test(pathname);
    const needMods = /^\/(modules|new|project\/|planner)/.test(pathname);
    if (needMats) actions.ensureMaterials();
    if (needMods) actions.ensureModules();
  }, [pathname, actions]);

  const toggleCompact = () => {
    const next = !compact;
    setCompactMode(next);
    setCompact(next);
  };

  const toggleCollapse = () => {
    const next = !collapsed;
    setSidebarCollapsed(next);
    setCollapsed(next);
  };

  useEffect(() => {
    document.body.classList.toggle("nav-open", menuOpen);
    return () => document.body.classList.remove("nav-open");
  }, [menuOpen]);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed && !menuOpen);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [collapsed, menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={"shell" + (collapsed ? " shell--sidebar-collapsed" : "")}>
      <button
        type="button"
        className="mobile-menu-btn no-print"
        aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <NavIcon name={menuOpen ? "close" : "menu"} />
      </button>
      {menuOpen && <button type="button" className="sidebar-backdrop" aria-label="Закрыть" onClick={closeMenu} />}
      <aside className={"sidebar" + (menuOpen ? " sidebar--open" : "") + (collapsed ? " sidebar--collapsed" : "")}>
        <SidebarNav
          compact={compact}
          collapsed={collapsed}
          onToggleCompact={toggleCompact}
          onToggleCollapse={toggleCollapse}
          onNavigate={closeMenu}
        />
      </aside>
      <div className="main">
        {!plannerFocus && <GlobalSearch />}
        <div className={"main-inner" + (wideLayout ? " main-inner--wide" : "") + (plannerFocus ? " main-inner--planner" : "")}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export function BackLink({ to, label = "Проекты", onClick }) {
  const content = <>← {label}</>;
  if (onClick) {
    return (
      <button type="button" className="back-link back-link--btn" onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <Link to={to || "/"} className="back-link">
      {content}
    </Link>
  );
}

export function PageHeader({ title, sub, actions, breadcrumbs, back }) {
  return (
    <header className="page-head">
      <div>
        {back && (
          <BackLink
            to={back.to}
            label={back.label}
            onClick={back.onClick}
          />
        )}
        {breadcrumbs}
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row wrap page-head__actions">{actions}</div>}
    </header>
  );
}
