import React, { useId, useState } from "react";

export default function Collapsible({
  title,
  subtitle,
  actions,
  defaultOpen = true,
  children,
  className = "",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={`collapsible ${className}`}>
      <button
        type="button"
        className="collapsible__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="collapsible__chev" aria-hidden>{open ? "▾" : "▸"}</span>
        <span className="collapsible__title">{title}</span>
        {subtitle && <span className="collapsible__sub muted">{subtitle}</span>}
        {actions && (
          <span className="collapsible__actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </button>
      {open && (
        <div className="collapsible__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
