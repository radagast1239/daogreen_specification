import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { money } from "../../store/helpers.js";
import { CLIENT_STATUSES, clientStatusMeta } from "../../data/clientStatuses.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Empty } from "../../components/ui.jsx";

function StatusChip({ statusId }) {
  const s = clientStatusMeta(statusId);
  return <span className={`chip chip--${s.chip} chip-dot`}>{s.label}</span>;
}

function ClientCard({ client, onSaved }) {
  const [status, setStatus] = useState(client.status || "new");
  const [comment, setComment] = useState(client.comment || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setStatus(client.status || "new");
    setComment(client.comment || "");
  }, [client.status, client.comment]);

  const persist = useCallback(
    async (patch) => {
      setSaving(true);
      try {
        await api.patchClientProfile({ clientName: client.name, ...patch });
        onSaved?.();
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (e) {
        alert(e.message);
      } finally {
        setSaving(false);
      }
    },
    [client.name, onSaved]
  );

  const scheduleComment = (text) => {
    setComment(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist({ comment: text }), 700);
  };

  const totalBudget = client.projects.reduce((s, p) => s + (p.totals?.budget || 0), 0);
  const currency = client.projects[0]?.currency || "₽";

  return (
    <div className="card client-card" style={{ padding: 18, marginBottom: 14 }}>
      <div className="client-card-head between wrap" style={{ gap: 12 }}>
        <div>
          <strong style={{ fontSize: 17 }}>{client.name}</strong>
          {client.city && <span className="muted"> · {client.city}</span>}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {client.projects.length} проект(ов) · итого{" "}
            <span className="num">{money(totalBudget, currency)}</span>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <StatusChip statusId={status} />
          {saved && !saving && <span className="muted" style={{ fontSize: 12 }}>Сохранено</span>}
          {saving && <span className="muted" style={{ fontSize: 12 }}>…</span>}
        </div>
      </div>

      <div className="form-grid" style={{ marginTop: 14 }}>
        <label>
          Статус
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              persist({ status: e.target.value });
            }}
          >
            {CLIENT_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Комментарий
          <textarea
            rows={2}
            value={comment}
            placeholder="Заметки по клиенту, договорённости, этап работ…"
            onChange={(e) => scheduleComment(e.target.value)}
          />
        </label>
      </div>

      <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        {client.projects.map((p) => (
          <div key={p.id} className="between wrap client-project-row" style={{ fontSize: 13, marginTop: 8, gap: 8 }}>
            <Link to={`/project/${p.id}`}>{p.name}</Link>
            <span className="num muted">{money(p.totals?.budget || 0, p.currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .getClients()
      .then(setClients)
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <PageHeader title="Клиенты" sub="Статусы, комментарии и проекты по каждому клиенту" back={{ to: "/", label: "Проекты" }} />
      <div className="content">
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : clients.length === 0 ? (
          <Empty title="Нет клиентов" hint="Создай проект с полем «Клиент»." />
        ) : (
          clients.map((c) => <ClientCard key={c.key || c.name} client={c} onSaved={load} />)
        )}
      </div>
    </>
  );
}
