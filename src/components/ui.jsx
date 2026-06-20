import React, { useState } from "react";
import { PURCHASE_STATUSES } from "../data/modules.js";
import { copyToClipboard } from "../lib/copyText.js";

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

export function ClientLinkModal({ url, onClose }) {
  const [msg, setMsg] = useState("");
  const copy = async () => {
    const ok = await copyToClipboard(url);
    setMsg(ok ? "Скопировано" : "Выделите ссылку и Ctrl+C");
    if (ok) setTimeout(() => setMsg(""), 2000);
  };
  return (
    <Modal
      title="Ссылка для клиента"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Закрыть</button>
          <button type="button" className="btn btn-primary" onClick={copy}>Копировать</button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Отправьте клиенту эту ссылку — он увидит список закупки с фото.
      </p>
      <input className="link-copy-input" readOnly value={url} onFocus={(e) => e.target.select()} />
      {msg && <p style={{ fontSize: 13, color: "var(--ok)", marginBottom: 0 }}>{msg}</p>}
      <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 13, marginTop: 10, display: "inline-block" }}>
        Открыть в новой вкладке ↗
      </a>
    </Modal>
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
