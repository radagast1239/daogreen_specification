import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, money } from "../../store/helpers.js";
import { clientLink } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Progress, Empty, ClientLinkModal } from "../../components/ui.jsx";

export default function ProjectsPage() {
  const { state, actions } = useStore();
  const nav = useNavigate();
  const projects = state.projects;
  const dash = state.dashboard;
  const [linkModal, setLinkModal] = useState(null);

  return (
    <>
      {linkModal && <ClientLinkModal url={linkModal} onClose={() => setLinkModal(null)} />}
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
        {dash && (
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="card stat">
              <div className="k">Без фото</div>
              <div className="v num">{dash.noPhoto}</div>
            </div>
            <div className="card stat">
              <div className="k">Без цены</div>
              <div className="v num">{dash.noPrice}</div>
            </div>
            <div className="card stat">
              <div className="k">Без ссылки</div>
              <div className="v num">{dash.noLink}</div>
            </div>
            <div className="card stat">
              <div className="k">Проблемы</div>
              <div className="v num">{dash.problems?.length || 0}</div>
            </div>
          </div>
        )}

        {dash?.problems?.length > 0 && (
          <div className="card" style={{ padding: 14, marginBottom: 20 }}>
            <div className="eyebrow">Требуют внимания</div>
            {dash.problems.slice(0, 8).map((p, i) => (
              <div key={i} className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                <Link to={`/project/${p.projectId}`}>{p.name}</Link>
                {" — "}
                {p.type === "need_help" ? `нужна помощь (${p.count})` : "клиент давно не отмечал"}
              </div>
            ))}
          </div>
        )}

        {projects.length === 0 ? (
          <Empty title="Пока нет проектов" hint="Создай первый проект: выбери модули и количество стеллажей.">
            <button className="btn btn-primary" onClick={() => nav("/new")}>
              Создать проект
            </button>
          </Empty>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {projects.map((p) => {
              const t = p.totals || projectTotals(p);
              const link = p.clientToken ? clientLink(p.clientToken) : "";
              return (
                <div key={p.id} className="card" style={{ padding: 18 }}>
                  <div className="between">
                    <div>
                      <div className="eyebrow">{p.type || "ферма"} · v{p.version || 1}</div>
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
                        <button type="button" className="btn btn-sm" onClick={() => setLinkModal(link)}>
                          Ссылка
                        </button>
                        <a className="btn btn-sm" href={link} target="_blank" rel="noreferrer">
                          Клиент ↗
                        </a>
                      </>
                    )}
                    <button className="btn btn-sm" onClick={() => actions.projectDuplicate(p.id)}>
                      Дублировать
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => confirm("В архив?") && actions.archiveProject(p.id)}
                    >
                      Архив
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => confirm("Удалить проект?") && actions.projectDelete(p.id)}
                    >
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
