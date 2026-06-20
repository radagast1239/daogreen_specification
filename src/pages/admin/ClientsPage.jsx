import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { money } from "../../store/helpers.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Empty } from "../../components/ui.jsx";

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  useEffect(() => {
    api.getClients().then(setClients).catch(() => setClients([]));
  }, []);

  return (
    <>
      <PageHeader title="Клиенты" sub="Проекты сгруппированы по имени клиента" />
      <div className="content">
        {clients.length === 0 ? (
          <Empty title="Нет клиентов" hint="Создай проект с полем «Клиент»." />
        ) : (
          clients.map((c) => (
            <div key={c.name} className="card" style={{ padding: 16, marginBottom: 12 }}>
              <strong>{c.name}</strong>
              {c.city && <span className="muted"> · {c.city}</span>}
              <div style={{ marginTop: 10 }}>
                {c.projects.map((p) => (
                  <div key={p.id} className="between" style={{ fontSize: 13, marginTop: 6 }}>
                    <Link to={`/project/${p.id}`}>{p.name}</Link>
                    <span className="num">{money(p.totals?.budget || 0, p.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
