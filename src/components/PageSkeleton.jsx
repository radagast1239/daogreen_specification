import React from "react";

export default function PageSkeleton({ lines = 4 }) {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Загрузка">
      <div className="page-skeleton__bar" />
      <div className="page-skeleton__bar page-skeleton__bar--short" />
      <div className="page-skeleton__grid">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="page-skeleton__card" />
        ))}
      </div>
    </div>
  );
}
