import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { money } from "../../store/helpers.js";
import { CLIENT_STATUSES, clientStatusMeta } from "../../data/clientStatuses.js";
import { getProjectStatusLabel } from "../../../shared/projectStatus.js";
import {
  clientBudgetTotal,
  clientStatusFilterOptions,
  clientsEmptyMessage,
  filterAndSortClients,
} from "../../lib/clientsListView.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Empty } from "../../components/ui.jsx";

function StatusChip({ statusId }) {
  const s = clientStatusMeta(statusId);
  return <span className={`chip chip--${s.chip} chip-dot`}>{s.label}</span>;
}

function ClientCard({ client, onSaved }) {
  const [status, setStatus] = useState(client.status || "new");
  const [comment, setComment] = useState(client.comment || "");
  const [commentOpen, setCommentOpen] = useState(false);
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

  const totalBudget = clientBudgetTotal(client);
  const currency = client.projects[0]?.currency || "₽";
  const projectCount = client.projects.length;

  return (
    <article className="card client-card">
      <div className="client-card__head">
        <div className="client-card__identity">
          <div className="client-card__title-row">
            <strong className="client-card__name">{client.name}</strong>
            {client.city ? <span className="muted client-card__city">{client.city}</span> : null}
          </div>
          <div className="client-card__meta muted">
            {projectCount} проект{projectCount === 1 ? "" : projectCount >= 2 && projectCount <= 4 ? "а" : "ов"}
          </div>
        </div>
        <div className="client-card__summary">
          <StatusChip statusId={status} />
          <span className="client-card__total num">{money(totalBudget, currency)}</span>
          {saved && !saving && <span className="muted client-card__save-hint">Сохранено</span>}
          {saving && <span className="muted client-card__save-hint">…</span>}
        </div>
      </div>

      <div className="client-card__controls">
        <label className="client-card__field">
          <span className="client-card__field-label">Статус</span>
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

        <div className="client-card__field client-card__field--comment">
          <span className="client-card__field-label">Комментарий</span>
          {!commentOpen ? (
            <button
              type="button"
              className="client-card__comment-preview"
              onClick={() => setCommentOpen(true)}
            >
              {comment.trim() ? comment : "Добавить комментарий…"}
            </button>
          ) : (
            <textarea
              rows={3}
              autoFocus
              value={comment}
              placeholder="Заметки по клиенту, договорённости, этап работ…"
              onChange={(e) => scheduleComment(e.target.value)}
              onBlur={() => setCommentOpen(false)}
            />
          )}
        </div>
      </div>

      <div className="client-card__projects">
        {client.projects.map((p) => (
          <div key={p.id} className="client-project-row">
            <div className="client-project-row__main">
              <span className="client-project-row__name">{p.name}</span>
              <span className="client-project-row__status muted">{getProjectStatusLabel(p.status)}</span>
            </div>
            <span className="client-project-row__sum num muted">{money(p.totals?.budget || 0, p.currency)}</span>
            <Link to={`/project/${p.id}`} className="btn btn-sm client-project-row__open">
              Открыть проект
            </Link>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("default");

  const load = useCallback(() => {
    setLoading(true);
    api
      .getClients()
      .then(setClients)
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statusOptions = useMemo(() => clientStatusFilterOptions(clients), [clients]);

  const visible = useMemo(
    () => filterAndSortClients(clients, { query, status, sort }),
    [clients, query, status, sort]
  );

  const emptyMsg = clientsEmptyMessage({
    sourceCount: clients.length,
    visibleCount: visible.length,
    query,
    status,
  });

  return (
    <>
      <PageHeader
        title="Клиенты"
        sub="Действующие клиенты: статусы, комментарии и проекты"
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content clients-page">
        {!loading && clients.length > 0 && (
          <div className="clients-toolbar">
            <label className="clients-toolbar__search">
              <span className="sr-only">Поиск</span>
              <input
                type="search"
                value={query}
                placeholder="Поиск: клиент, город, проект, комментарий"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="clients-toolbar__select">
              <span className="sr-only">Статус</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {statusOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="clients-toolbar__select">
              <span className="sr-only">Сортировка</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="default">По умолчанию</option>
                <option value="sum">По сумме</option>
                <option value="name">По названию</option>
              </select>
            </label>
          </div>
        )}

        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : clients.length === 0 ? (
          <Empty title="Нет клиентов" hint="Создай проект с полем «Клиент»." />
        ) : emptyMsg ? (
          <Empty title={emptyMsg} hint="Сбросьте поиск или выберите другой статус." />
        ) : (
          <div className="clients-list">
            {visible.map((c) => (
              <ClientCard key={c.key || c.name} client={c} onSaved={load} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
