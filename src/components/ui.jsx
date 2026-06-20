import React from "react";
import { PURCHASE_STATUSES } from "../data/modules.js";

export function Chip({ kind = "neutral", children, dot = true }) {
  return <span className={`chip chip--${kind} ${dot ? "chip-dot" : ""}`}>{children}</span>;
}

export function StatusChip({ status }) {
  const s = PURCHASE_STATUSES.find((x) => x.id === status) || PURCHASE_STATUSES[0];
  return <Chip kind={s.chip}>{s.label}</Chip>;
}

export function Progress({ value }) {
  return (
    <div className="bar" title={`${value}%`}>
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Stat({ k, v, sub }) {
  return (
    <div className="card stat">
      <div className="k">{k}</div>
      <div className="v num">{v}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button className="btn-ghost btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, hint, children }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{title}</div>
      {hint && <div style={{ marginTop: 6 }}>{hint}</div>}
      {children && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}
