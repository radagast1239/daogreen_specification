import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, money } from "../../store/helpers.js";
import { clientLink } from "../../lib/api.js";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Progress, Empty, ClientLinkModal } from "../../components/ui.jsx";
import { useToast } from "../../components/Toast.jsx";
import { getPinnedIds, isPinned, sortWithPinned, togglePinned } from "../../lib/pinnedProjects.js";
import { parsePublishRulesSettings } from "../../lib/publishRulesConfig.js";
import HomeDashboard from "../../components/HomeDashboard.jsx";
import DuplicateProjectModal from "../../components/DuplicateProjectModal.jsx";
import {
  isActiveProject,
  isDraftProject,
  projectLifecycleBadge,
  projectOpenLabel,
  projectOpenPath,
  resolveBuilderWizardStep,
  buildBuilderContinuePath,
} from "../../../shared/projectLifecycle.js";
import {
  getProjectStatusLabel,
  projectMatchesStatusFilter,
} from "../../../shared/projectStatus.js";
import {
  getProjectKindBadge,
  resolveProjectKind,
} from "../../../shared/projectCreation.js";
import ProjectListFilters from "../../components/ProjectListFilters.jsx";

function clientKey(name) {
  return (name || "Без имени").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatUpdatedShort(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function ProjectsPage({ variant = "active" } = {}) {
  const isInProgress = variant === "in-progress";
  const { state, actions } = useStore();
  const nav = useNavigate();
  const { confirm, success } = useToast();
  const projects = state.projects;
  const visibleProjects = useMemo(
    () => projects.filter((p) => (isInProgress ? isDraftProject(p) : isActiveProject(p))),
    [projects, isInProgress],
  );
  const dash = state.dashboard;
  const [linkModal, setLinkModal] = useState(null);
  const [dupSource, setDupSource] = useState(null);
  const [pinned, setPinned] = useState(getPinnedIds);
  const [companyName, setCompanyName] = useState("Daogreen");
  const [linkTemplate, setLinkTemplate] = useState("");

  const [q, setQ] = useState("");
  const [clientF, setClientF] = useState("");
  const [projectStatusF, setProjectStatusF] = useState("all");
  const [dateF, setDateF] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [matCount, setMatCount] = useState(null);

  useEffect(() => {
    api.health().then((h) => setMatCount(h.materials)).catch(() => {});
  }, []);

  useEffect(() => {
    actions.refreshDashboard();
  }, [actions]);

  useEffect(() => {
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
    for (const p of visibleProjects) {
      const key = clientKey(p.client);
      if (!names.has(key)) names.set(key, (p.client || "Без имени").trim());
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [visibleProjects]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const now = Date.now();
    const day = 86400000;
    let list = visibleProjects.filter((p) => {
      if (ql) {
        const hay = `${p.name} ${p.client || ""} ${p.city || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (clientF && clientKey(p.client) !== clientF) return false;
      if (!isInProgress && !projectMatchesStatusFilter(p, projectStatusF)) return false;
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
  }, [visibleProjects, q, clientF, projectStatusF, dateF, problemsOnly, problemIds, pinned, isInProgress]);

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
      {dupSource && (
        <DuplicateProjectModal
          sourceProject={dupSource}
          onClose={() => setDupSource(null)}
          onSubmit={async (body) => {
            const p = await actions.projectDuplicate(dupSource.id, body);
            setDupSource(null);
            success(`Создан проект «${p.name}»`);
            nav(`/project/${p.id}`);
          }}
        />
      )}
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
        title={isInProgress ? "Проекты в настройке" : "Проекты"}
        sub={`${visibleProjects.length} ${isInProgress ? "черновик(ов)" : "проект(ов)"}${matCount != null ? ` · база: ${matCount} материалов` : ""}`}
        actions={
          <button className="btn btn-primary" onClick={() => nav("/new")}>
            Создать проект
          </button>
        }
      />
      <div className="content">
        {!isInProgress && <HomeDashboard dash={dash} />}

        {!isInProgress && (
          <div style={{ marginBottom: 12 }}>
            <ProjectListFilters value={projectStatusF} onChange={setProjectStatusF} />
          </div>
        )}

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
            {filtered.length} из {visibleProjects.length}
          </span>
        </div>

        {visibleProjects.length === 0 ? (
          <Empty
            title={isInProgress ? "Нет проектов в настройке" : "Пока нет проектов"}
            hint={isInProgress ? "Сохраните черновик в мастере — он появится здесь." : "Создай первый проект через мастер."}
          >
            <button className="btn btn-primary" onClick={() => nav("/new")}>
              {isInProgress ? "Новый проект" : "Создать проект"}
            </button>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty title="Нет проектов по фильтрам" hint="Сбросьте фильтры." />
        ) : (
          <div className="grid projects-grid">
            {filtered.map((p) => {
              const t = p.totals || projectTotals(p);
              const link = !isInProgress && p.clientToken ? clientLink(p.clientToken) : "";
              const pinnedOn = isPinned(p.id);
              const openPath = projectOpenPath(p);
              const lifecycleBadge = projectLifecycleBadge(p);
              const projectStatusLabel = getProjectStatusLabel(p.status);
              const kindBadge = getProjectKindBadge(resolveProjectKind(p));
              const itemCount = Array.isArray(p.items)
                ? p.items.length
                : Number(p.itemCount) || 0;
              const readinessLabel =
                itemCount === 0
                  ? "Проект ещё не заполнен"
                  : problemIds.has(String(p.id))
                    ? "Есть проблемы"
                    : null;
              return (
                <div key={p.id} className="card" style={{ padding: 18 }}>
                  <div className="between">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="row"
                        style={{ gap: 6, marginBottom: 4, flexWrap: "wrap", maxWidth: "100%" }}
                      >
                        <button
                          type="button"
                          className={"pin-btn" + (pinnedOn ? " pin-btn--on" : "")}
                          title={pinnedOn ? "Открепить" : "Закрепить"}
                          onClick={() => onPin(p.id)}
                        >
                          ★
                        </button>
                        <div className="eyebrow">{p.type || "ферма"} · v{p.version || 1}</div>
                        {lifecycleBadge && (
                          <span className="chip" style={{ fontSize: 10 }}>
                            {lifecycleBadge}
                          </span>
                        )}
                        {!isInProgress && kindBadge ? (
                          <span className="chip chip--neutral" style={{ fontSize: 10 }}>
                            {kindBadge}
                          </span>
                        ) : null}
                        {!isInProgress && (
                          <span className="chip chip--brand" style={{ fontSize: 10 }}>
                            {projectStatusLabel}
                          </span>
                        )}
                        {!isInProgress && readinessLabel && (
                          <span
                            className={`chip ${itemCount === 0 ? "chip--neutral" : "chip--amber"}`}
                            style={{ fontSize: 10 }}
                          >
                            {readinessLabel}
                          </span>
                        )}
                      </div>
                      <Link to={openPath} style={{ fontSize: 16, fontWeight: 700 }}>
                        {p.name}
                      </Link>
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                        {p.client || "—"}
                        {p.city ? ` · ${p.city}` : ""}
                        {p.area ? ` · ${p.area} м²` : ""}
                        {isInProgress && (
                          <span>
                            {" · шаг: "}
                            {resolveBuilderWizardStep(p, "basics")}
                          </span>
                        )}
                      </div>
                      {!isInProgress && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          Обновлено: {formatUpdatedShort(p.updatedAt || p.updated_at)}
                          {p.itemCount != null ? ` · позиций: ${p.itemCount}` : ""}
                        </div>
                      )}
                    </div>
                  </div>

                  {!isInProgress && (
                    <>
                      <div className="between" style={{ marginTop: 14, marginBottom: 6 }}>
                        <span className="muted" style={{ fontSize: 12 }}>
                          Прогресс закупки
                        </span>
                        <span className="num" style={{ fontWeight: 700 }}>
                          {t.progress}%
                        </span>
                      </div>
                      <Progress value={t.progress} />

                      <div className="stat-grid" style={{ marginTop: 14 }}>
                        <div>
                          <div className="eyebrow">Итог</div>
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
                    </>
                  )}

                  <div className="row wrap" style={{ marginTop: 16, gap: 6 }}>
                    <Link className={`btn btn-sm${isInProgress ? " btn-primary" : " btn-primary"}`} to={openPath}>
                      {projectOpenLabel(p)}
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
                    {!isInProgress && (
                      <>
                        <Link
                          className="btn btn-sm"
                          to={buildBuilderContinuePath(p)}
                          title="Открыть мастер без создания нового projectId"
                        >
                          Редактировать проект
                        </Link>
                        <button className="btn btn-sm" onClick={() => setDupSource(p)}>
                          На основе прошлого
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => actions.projectDuplicate(p.id, { name: `${p.name} (копия)` })}>
                          Быстрая копия
                        </button>
                      </>
                    )}
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
