import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/StoreContext.jsx";
import { api } from "../lib/api.js";
import { formatMaterialModulesLabel } from "../../shared/materialModules.js";

export default function GlobalSearch() {
  const { state } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => {
    api.getClients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (ql.length < 2) return [];
    const out = [];
    for (const p of state.projects) {
      const hay = `${p.name} ${p.client || ""} ${p.city || ""}`.toLowerCase();
      if (hay.includes(ql)) {
        out.push({ kind: "project", id: p.id, label: p.name, sub: p.client || "—", to: `/project/${p.id}` });
      }
    }
    for (const c of clients) {
      const hay = `${c.name} ${c.city || ""}`.toLowerCase();
      if (hay.includes(ql)) {
        out.push({ kind: "client", id: c.key, label: c.name, sub: `${c.projects?.length || 0} проект(ов)`, to: "/clients" });
      }
    }
    for (const m of state.materials) {
      const hay = `${m.name} ${formatMaterialModulesLabel(m)} ${m.supplier || ""}`.toLowerCase();
      if (hay.includes(ql)) {
        out.push({ kind: "material", id: m.id, label: m.name, sub: formatMaterialModulesLabel(m), to: "/materials" });
        if (out.length >= 14) break;
      }
    }
    return out.slice(0, 12);
  }, [q, state.projects, state.materials, clients]);

  const go = (to) => {
    setOpen(false);
    setQ("");
    nav(to);
  };

  return (
    <div className="global-search" ref={wrapRef}>
      <input
        type="search"
        placeholder="Поиск: проект, клиент, материал…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Глобальный поиск"
      />
      {open && q.trim().length >= 2 && (
        <div className="global-search__drop">
          {results.length === 0 ? (
            <div className="global-search__empty muted">Ничего не найдено</div>
          ) : (
            results.map((r) => (
              <button key={`${r.kind}-${r.id}`} type="button" className="global-search__row" onClick={() => go(r.to)}>
                <span className={`global-search__tag global-search__tag--${r.kind}`}>
                  {r.kind === "project" ? "Проект" : r.kind === "client" ? "Клиент" : "Материал"}
                </span>
                <span>
                  <strong>{r.label}</strong>
                  <span className="muted" style={{ display: "block", fontSize: 12 }}>
                    {r.sub}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
