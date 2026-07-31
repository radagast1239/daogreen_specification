import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { berryCalculatorUrl, economicCalculatorUrl, saladEconomicsUrl } from "../lib/calcUrls.js";
import { api } from "../lib/api.js";
import GlobalSearch from "./GlobalSearch.jsx";
import { getCompactMode, setCompactMode } from "../lib/compactMode.js";
import { getSidebarCollapsed, setSidebarCollapsed } from "../lib/sidebarPrefs.js";
import { NavIcon } from "./NavIcons.jsx";
import { useStore } from "../store/StoreContext.jsx";

const NAV_GROUPS = [
  {
    id: "projects",
    label: "Проекты",
    items: [
      { to: "/", label: "Проекты", icon: "projects", end: true },
      { to: "/clients", label: "Клиенты", icon: "clients" },
      { to: "/reports", label: "Отчёты", icon: "reports" },
      { to: "/storage", label: "Файлы и хранилище", icon: "archive" },
      { to: "/projects/in-progress", label: "В процессе", icon: "progress", secondary: true },
      { to: "/archive", label: "Архив", icon: "archive", secondary: true },
      { to: "/new", label: "+ Создать проект", icon: "new", cta: true },
    ],
  },
  {
    id: "base",
    label: "База",
    items: [
      { to: "/materials", label: "Материалы", icon: "materials" },
      { to: "/suppliers", label: "Поставщики", icon: "suppliers" },
      { to: "/modules", label: "Шаблоны и справочники", icon: "modules" },
    ],
  },
  {
    id: "design",
    label: "Проектирование",
    items: [
      { to: "/planner", label: "Планировщик", icon: "planner" },
      { to: "/planner/frame", label: "Конструктор каркасов", icon: "modules" },
    ],
  },
];

const SYSTEM_ITEMS = [{ to: "/settings", label: "Настройки", icon: "settings" }];

const CALC_LINKS = [
  { href: economicCalculatorUrl, label: "Калькулятор салатов", icon: "calc" },
  { href: saladEconomicsUrl, label: "Экономика", icon: "economics" },
  { href: berryCalculatorUrl, label: "Калькулятор ягод", icon: "berry" },
];

function NavItem({ to, end, label, icon, onNavigate, collapsed, secondary, cta }) {
  const extra = [secondary ? "navlink--secondary" : "", cta ? "navlink--cta" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => "navlink" + (isActive ? " active" : "") + (extra ? ` ${extra}` : "")}
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

function SidebarNav({ compact, collapsed, onToggleCompact, onToggleCollapse, onNavigate, onLogout }) {
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

      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="sidebar__group">
          <div className="sidebar__sep" title={collapsed ? group.label : undefined}>
            <span className="sidebar__sep-text">{group.label}</span>
          </div>
          {group.items.map((n) => (
            <NavItem key={n.to} {...n} onNavigate={onNavigate} collapsed={collapsed} />
          ))}
        </div>
      ))}

      <div className="sidebar__sep" title={collapsed ? "Калькуляторы" : undefined}>
        <span className="sidebar__sep-text">Калькуляторы</span>
      </div>
      {CALC_LINKS.map((n) => (
        <ExtNavItem key={n.label} {...n} onNavigate={onNavigate} collapsed={collapsed} />
      ))}

      <div className="sidebar__sep" title={collapsed ? "Система" : undefined}>
        <span className="sidebar__sep-text">Система</span>
      </div>
      {SYSTEM_ITEMS.map((n) => (
        <NavItem key={n.to} {...n} onNavigate={onNavigate} collapsed={collapsed} />
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
      <button
        type="button"
        className="navlink navlink--toggle"
        onClick={onLogout}
        title={collapsed ? "Выйти" : undefined}
      >
        <NavIcon name="settings" />
        <span className="navlink__label">Выйти</span>
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
  const { pathname, search } = useLocation();
  const builderStep = new URLSearchParams(search).get("step");
  const builderWide =
    pathname === "/new" && (builderStep === "stellages" || builderStep === "general");
  const wideLayout = builderWide || /^\/(materials|project\/|modules|reports|planner)/.test(pathname);
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

  const handleLogout = async () => {
    try {
      await api.logoutAdmin();
    } catch {
      /* still leave the session UI */
    }
    const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    window.location.assign(`${base}login`);
  };

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
          onLogout={handleLogout}
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
