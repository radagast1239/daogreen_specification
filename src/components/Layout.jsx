import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import AppModeNav from "./AppModeNav.jsx";

const NAV = [
  { to: "/", label: "Проекты", ic: "▣", end: true },
  { to: "/clients", label: "Клиенты", ic: "◎" },
  { to: "/materials", label: "Материалы", ic: "▤" },
  { to: "/modules", label: "Пресеты", ic: "▦" },
  { to: "/suppliers", label: "Поставщики", ic: "◇" },
  { to: "/import", label: "Импорт", ic: "↓" },
  { to: "/archive", label: "Архив", ic: "▢" },
  { to: "/settings", label: "Настройки", ic: "⚙" },
  { to: "/new", label: "Новый проект", ic: "＋" },
];

export default function Layout() {
  return (
    <div className="app-frame">
      <AppModeNav active="spec" />
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__head">
            <span className="eyebrow" style={{ color: "#9ecdb8" }}>Меню</span>
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
        <div className="spacer" />
        <div className="foot">
          Спецификации v1
        </div>
      </aside>
      <div className="main">
        <div className="main-inner">
          <Outlet />
        </div>
      </div>
    </div>
    </div>
  );
}

export function PageHeader({ title, sub, actions }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  );
}
