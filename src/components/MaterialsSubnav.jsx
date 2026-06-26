import React from "react";
import { NavLink, useSearchParams } from "react-router-dom";

const TABS = [
  { id: "base", label: "База", to: "/materials", end: true },
  { id: "import", label: "Импорт", to: "/materials?tab=import" },
  { id: "duplicates", label: "Дубликаты", to: "/materials?tab=duplicates" },
  { id: "quality", label: "Проверка", to: "/materials?tab=quality" },
  { id: "photos", label: "Фото", to: "/materials/photos" },
];

export default function MaterialsSubnav() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");

  return (
    <div className="toolbar materials-subnav" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 0, gap: 0 }}>
      {TABS.map(({ id, label, to, end }) => (
        <NavLink
          key={id}
          to={to}
          end={end}
          className={({ isActive }) => {
            const active =
              isActive ||
              (id === "import" && tabParam === "import") ||
              (id === "duplicates" && tabParam === "duplicates") ||
              (id === "quality" && tabParam === "quality");
            return "btn btn-ghost materials-subnav__link" + (active ? " materials-subnav__link--active" : "");
          }}
        >
          {label}
        </NavLink>
      ))}
    </div>
  );
}
