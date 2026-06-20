import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, money } from "../../store/helpers.js";
import { clientLink } from "../../lib/api.js";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Progress, Empty, ClientLinkModal } from "../../components/ui.jsx";
import { useToast } from "../../components/Toast.jsx";
import { CLIENT_STATUSES, clientStatusMeta } from "../../data/clientStatuses.js";
import { getPinnedIds, isPinned, sortWithPinned, togglePinned } from "../../lib/pinnedProjects.js";
import { parsePublishRulesSettings } from "../../lib/publishRulesConfig.js";
import HomeDashboard from "../../components/HomeDashboard.jsx";

function clientKey(name) {
  return (name || "Без имени").trim().toLowerCase().replace(/\s+/g, " ");
}

export default function ProjectsPage() {
  const { state, actions } = useStore();
  const nav = useNavigate();
  const { confirm, success } = useToast();
  const projects = state.projects;
  const dash = state.dashboard;
  const [linkModal, setLinkModal] = useState(null);
  const [pinned, setPinned] = useState(getPinnedIds);
  const [clientMap, setClientMap] = useState({});
  const [companyName, setCompanyName] = useState("Daogreen");
  const [linkTemplate, setLinkTemplate] = useState("");

  const [q, setQ] = useState("");
  const [clientF, setClientF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [dateF, setDateF] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);

  useEffect(() => {
    api.getClients().then((list) => {
      const map = {};
      for (const c of list) map[c.key] = c;
      setClientMap(map);
    });
    api.getSettings().then((s) => {
      setCompanyName(s.companyName || "Daogreen");
      setLinkTemplate(parsePublishRulesSettings(s).clientLinkTemplate);
    }).catch(() => {});
  }, []);

  const problemIds = useMemo(
    () => new Set((dash?.problems || []).map((p) => String(p.projectId))),
    [dash]
  );

  const clients = useMemo(() => {
    const names = new Map();
    for (const p of projects) {
      const key = clientKey(p.client);
      if (!names.has(key)) names.set(key, (p.client || "Без имени").trim());
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [projects]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const now = Date.now();
    const day = 86400000;
    let list = projects.filter((p) => {
      if (ql) {
        const hay = `${p.name} ${p.client || ""} ${p.city || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (clientF && clientKey(p.client) !== clientF) return false;
      if (statusF) {
        const st = clientMap[clientKey(p.client)]?.status || "new";
        if (st !== statusF) return false;
      }
      if (problemsOnly && !problemIds.has(String(p.id))) return false;
      if (dateF && p.updatedAt) {
        const t = new Date(p.updatedAt).getTime();
        if (dateF === "7d" && now - t > 7 * day) return false;
        if (dateF === "30d" && now - t > 30 * day) return false;
        if (dateF === "90d" && now - t > 90 * day) return false;
      }
      return true;
    });
    return sortWithPinned(list, pinned);
  }, [projects, q, clientF, statusF, dateF, problemsOnly, clientMap, problemIds, pinned]);

  const onPin = (id) => setPinned(togglePinned(id));

  const archive = async (p) => {
    if (!(await confirm({ title: "В архив?", message: `Проект «${p.name}»` }))) return;
    await actions.archiveProject(p.id);
    success("Проект в архиве");
  };

  const remove = async (p) => {
    if (!(await confirm({ title: "Удалить проект?", message: p.name, confirmLabel: "Удалить" }))) return;
    await actions.projectDelete(p.id);
    success("Проект удалён");
  };

  const regenerate = async (p) => {
    if (
      !(await confirm({
        title: "Новая ссылка?",
        message: "Старая ссылка клиента перестанет работать.",
        confirmLabel: "Перегенерировать",
      }))
    )
      return;
    const token = await actions.regenerateToken(p.id);
    success("Ссылка обновлена");
    setLinkModal(clientLink(token));
  };

  return (
    <>
      {linkModal && (
        <ClientLinkModal
          url={linkModal.url || linkModal}
          projectName={linkModal.projectName}
          clientName={linkModal.clientName}
          companyName={companyName}
          linkTemplate={linkTemplate}
          onClose={() => setLinkModal(null)}
        />
      )}
      <PageHeader
        title="Проекты"
        sub={`${projects.length} проект(ов) · база: ${state.materials.length} материалов`}
        actions={
          <button className="btn btn-primary" onClick={() => nav("/new")}>
            ＋ Новый проект
          </button>
        }
      />
      <div className="content">
        <HomeDashboard dash={dash} />

        <div className="project-filters no-print">
          <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} />
          <select value={clientF} onChange={(e) => setClientF(e.target.value)} style={{ width: "auto" }}>
            <option value="">Все клиенты</option>
            {clients.map(([k, name]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </select>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={{ width: "auto" }}>
            <option value="">Все статусы</option>
            {CLIENT_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={dateF} onChange={(e) => setDateF(e.target.value)} style={{ width: "auto" }}>
            <option value="">Любая дата</option>
            <option value="7d">Обновлялись 7 дней</option>
            <option value="30d">30 дней</option>
            <option value="90d">90 дней</option>
          </select>
          <label className="row" style={{ fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
            С проблемами
          </label>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
            {filtered.length} из {projects.length}
          </span>
        </div>

        {projects.length === 0 ? (
          <Empty title="Пока нет проектов" hint="Создай первый проект через мастер.">
            <button className="btn btn-primary" onClick={() => nav("/new")}>
              Создать проект
            </button>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty title="Нет проектов по фильтрам" hint="Сбросьте фильтры." />
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {filtered.map((p) => {
              const t = p.totals || projectTotals(p);
              const link = p.clientToken ? clientLink(p.clientToken) : "";
              const pinnedOn = isPinned(p.id);
              const cStatus = clientStatusMeta(clientMap[clientKey(p.client)]?.status);
              return (
                <div key={p.id} className="card" style={{ padding: 18 }}>
                  <div className="between">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                        <button
                          type="button"
                          className={"pin-btn" + (pinnedOn ? " pin-btn--on" : "")}
                          title={pinnedOn ? "Открепить" : "Закрепить"}
                          onClick={() => onPin(p.id)}
                        >
                          ★
                        </button>
                        <div className="eyebrow">{p.type || "ферма"} · v{p.version || 1}</div>
                        <span className={`chip chip--${cStatus.chip}`} style={{ fontSize: 10 }}>
                          {cStatus.label}
                        </span>
                      </div>
                      <Link to={`/project/${p.id}`} style={{ fontSize: 16, fontWeight: 700 }}>
                        {p.name}
                      </Link>
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                        {p.client || "—"}
                        {p.city ? ` · ${p.city}` : ""}
                        {p.area ? ` · ${p.area} м²` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="between" style={{ marginTop: 14, marginBottom: 6 }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Закуплено
                    </span>
                    <span className="num" style={{ fontWeight: 700 }}>
                      {t.progress}%
                    </span>
                  </div>
                  <Progress value={t.progress} />

                  <div className="stat-grid" style={{ marginTop: 14 }}>
                    <div>
                      <div className="eyebrow">Бюджет</div>
                      <div className="num" style={{ fontWeight: 700 }}>
                        {money(t.budget, p.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow">Осталось</div>
                      <div className="num" style={{ fontWeight: 700 }}>
                        {money(t.remaining, p.currency)}
                      </div>
                    </div>
                  </div>

                  <div className="row wrap" style={{ marginTop: 16, gap: 6 }}>
                    <Link className="btn btn-sm" to={`/project/${p.id}`}>
                      Открыть
                    </Link>
                    {link && (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            setLinkModal({ url: link, projectName: p.name, clientName: p.client })
                          }
                        >
                          Ссылка
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => regenerate(p)}>
                          Новая ссылка
                        </button>
                        <a className="btn btn-sm" href={link} target="_blank" rel="noreferrer">
                          Клиент ↗
                        </a>
                      </>
                    )}
                    <button className="btn btn-sm" onClick={() => actions.projectDuplicate(p.id)}>
                      Дублировать
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => archive(p)}>
                      Архив
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(p)}>
                      Удалить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
