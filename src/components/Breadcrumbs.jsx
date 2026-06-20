import React from "react";
import { Link } from "react-router-dom";

export default function Breadcrumbs({ items }) {
  if (!items?.length) return null;
  return (
    <nav className="breadcrumbs" aria-label="Навигация">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="breadcrumbs__item">
            {i > 0 && <span className="breadcrumbs__sep">/</span>}
            {last || !item.to ? (
              <span className={last ? "breadcrumbs__current" : "muted"}>{item.label}</span>
            ) : (
              <Link to={item.to}>{item.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
