import React from "react";
import { NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/", label: "Проекты", ic: "▣", end: true },
  { to: "/clients", label: "Клиенты", ic: "◎" },
  { to: "/materials", label: "Материалы", ic: "▤" },
  { to: "/photos", label: "Фото", ic: "◉" },
  { to: "/modules", label: "Модули", ic: "▦" },
  { to: "/suppliers", label: "Поставщики", ic: "◇" },
  { to: "/import", label: "Импорт", ic: "↓" },
  { to: "/archive", label: "Архив", ic: "▢" },
  { to: "/settings", label: "Настройки", ic: "⚙" },
  { to: "/new", label: "Новый проект", ic: "＋" },
];

export default function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brandmark">
          <div className="spine" />
          <div>
            <b>Daogreen</b>
            <span>Spec</span>
          </div>
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
          v1.0 production
          <br />
          API · #116355
        </div>
      </aside>
      <div className="main">
        <Outlet />
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
