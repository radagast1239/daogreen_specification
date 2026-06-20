import React from "react";
import { NavLink, Link, useLocation } from "react-router-dom";

const MODES = [
  { id: "hub", to: "/hub", label: "Главная", end: false },
  { id: "spec", to: "/", label: "Спецификации", end: true },
  { id: "economic", to: "/tools/economic", label: "Салаты", end: false },
  { id: "berry", to: "/tools/berry", label: "Ягоды", end: false },
];

export default function AppModeNav({ active }) {
  const loc = useLocation();
  const current =
    active ||
    (loc.pathname.startsWith("/tools/economic")
      ? "economic"
      : loc.pathname.startsWith("/tools/berry")
        ? "berry"
        : loc.pathname.startsWith("/hub")
          ? "hub"
          : "spec");

  return (
    <header className="mode-nav">
      <Link to="/hub" className="mode-nav__brand">
        <span className="mode-nav__spine" />
        <span>
          <strong>Daogreen</strong>
          <small>инструменты фермы</small>
        </span>
      </Link>
      <nav className="mode-nav__tabs" aria-label="Режимы">
        {MODES.map((m) => (
          <NavLink
            key={m.id}
            to={m.to}
            end={m.end}
            className={() =>
              "mode-nav__tab" + (current === m.id ? " mode-nav__tab--active" : "")
            }
          >
            {m.label}
          </NavLink>
        ))}
      </nav>
      <Link to="/login" className="mode-nav__login btn btn-sm">
        Вход
      </Link>
    </header>
  );
}
