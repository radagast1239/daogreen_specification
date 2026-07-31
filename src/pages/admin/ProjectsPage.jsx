import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, money } from "../../store/helpers.js";
import { clientLink } from "../../lib/api.js";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Progress, Empty, ClientLinkModal } from "../../components/ui.jsx";
import { RowActionsMenu } from "../../components/modulesUi.jsx";
import { useToast } from "../../components/Toast.jsx";
import { getPinnedIds, isPinned, togglePinned } from "../../lib/pinnedProjects.js";
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
import {
  PROJECT_SORT_OPTIONS,
  projectsFilterEmptyTitle,
  projectsHaveActiveFilters,
  projectsSourceEmptyCopy,
  sortProjects,
} from "../../lib/projectsListView.js";

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

function ProjectCard({
  p,
  isInProgress,
  problemIds,
  pinnedOn,
  onPin,
  onArchive,
  onRemove,
  onRegenerate,
  onDupSource,
  onQuickCopy,
  onOpenLinkModal,
  onEdit,
}) {
  const t = p.totals || projectTotals(p);
  const link = !isInProgress && p.clientToken ? clientLink(p.clientToken) : "";
  const openPath = projectOpenPath(p);
  const lifecycleBadge = projectLifecycleBadge(p);
  const projectStatusLabel = getProjectStatusLabel(p.status);
  const kindBadge = getProjectKindBadge(resolveProjectKind(p));
  const itemCount = Array.isArray(p.items) ? p.items.length : Number(p.itemCount) || 0;
  const readinessLabel =
    itemCount === 0
      ? "Проект ещё не заполнен"
      : problemIds.has(String(p.id))
        ? "Есть проблемы"
        : null;
  const remainingZero = Number(t.remaining) === 0;
  const progressZero = Number(t.progress) === 0;

  const menuItems = [
    !isInProgress && {
      id: "edit",
      label: "Редактировать проект",
      onClick: () => onEdit(p),
    },
    link && {
      id: "new-link",
      label: "Создать новую клиентскую ссылку",
      onClick: () => onRegenerate(p),
    },
    link && {
      id: "open-client",
      label: "Открыть клиента",
      onClick: () => window.open(link, "_blank", "noopener,noreferrer"),
    },
    !isInProgress && {
      id: "copy",
      label: "Создать копию",
      children: [
        {
          id: "copy-quick",
          label: "Быстрая копия",
          onClick: () => onQuickCopy(p),
        },
        {
          id: "copy-based",
          label: "На основе этого проекта",
          onClick: () => onDupSource(p),
        },
      ],
    },
    { id: "sep-danger", separator: true },
    {
      id: "archive",
      label: "Архивировать",
      danger: true,
      onClick: () => onArchive(p),
    },
    {
      id: "delete",
      label: "Удалить",
      danger: true,
      onClick: () => onRemove(p),
    },
  ];

  return (
    <article className="card projects-card">
      <div className="projects-card__top">
        <button
          type="button"
          className={"pin-btn" + (pinnedOn ? " pin-btn--on" : "")}
          title={pinnedOn ? "Открепить" : "Закрепить"}
          aria-label={pinnedOn ? "Открепить" : "Закрепить"}
          onClick={() => onPin(p.id)}
        >
          ★
        </button>

        <Link to={openPath} className="projects-card__head-link">
          <div className="projects-card__meta">
            <span className="eyebrow">
              {p.type || "ферма"} · v{p.version || 1}
            </span>
            {lifecycleBadge && <span className="chip">{lifecycleBadge}</span>}
            {!isInProgress && kindBadge ? (
              <span className="chip chip--neutral">{kindBadge}</span>
            ) : null}
            {!isInProgress && (
              <span className="chip chip--brand">{projectStatusLabel}</span>
            )}
            {!isInProgress && readinessLabel && (
              <span className={`chip ${itemCount === 0 ? "chip--neutral" : "chip--amber"}`}>
                {readinessLabel}
              </span>
            )}
          </div>
          <h3 className="projects-card__title">{p.name}</h3>
          <div className="projects-card__sub muted">
            <span>{p.client || "—"}</span>
            {p.city ? <span> · {p.city}</span> : null}
            {p.area ? <span> · {p.area} м²</span> : null}
            {isInProgress && (
              <span>
                {" · шаг: "}
                {resolveBuilderWizardStep(p, "basics")}
              </span>
            )}
          </div>
          {!isInProgress && (
            <div className="projects-card__updated muted">
              Обновлено: {formatUpdatedShort(p.updatedAt || p.updated_at)}
              {p.itemCount != null ? ` · позиций: ${p.itemCount}` : ""}
            </div>
          )}
        </Link>

        {link && (
          <a
            className="projects-card__client-link"
            href={link}
            target="_blank"
            rel="noreferrer"
            title="Открыть клиентский экран"
          >
            Клиент ↗
          </a>
        )}
      </div>

      {!isInProgress && (
        <div className="projects-card__finance">
          <div
            className={
              "projects-card__progress" + (progressZero ? " projects-card__progress--zero" : "")
            }
          >
            <div className="between">
              <span className="muted">Прогресс закупки</span>
              <span className="num projects-card__progress-value">{t.progress}%</span>
            </div>
            <Progress value={t.progress} />
          </div>

          <div className="projects-card__stat-grid">
            <div className="projects-card__stat projects-card__stat--total">
              <div className="eyebrow">Итого</div>
              <div className="num projects-card__stat-value">{money(t.budget, p.currency)}</div>
            </div>
            <div
              className={
                "projects-card__stat projects-card__stat--remain" +
                (remainingZero ? " projects-card__stat--done" : "")
              }
            >
              <div className="eyebrow">Осталось</div>
              <div className="num projects-card__stat-value">
                {remainingZero ? "Закупка завершена" : money(t.remaining, p.currency)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="projects-card__actions">
        <Link className="btn btn-sm btn-primary" to={openPath}>
          {projectOpenLabel(p)}
        </Link>
        {link && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onOpenLinkModal({ url: link, projectName: p.name, clientName: p.client })
            }
          >
            Ссылка
          </button>
        )}
        <RowActionsMenu items={menuItems} label="Действия проекта" />
      </div>
    </article>
  );
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
  const [sortF, setSortF] = useState("default");
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
    const list = visibleProjects.filter((p) => {
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
    return sortProjects(list, sortF, { pinned, problemIds });
  }, [
    visibleProjects,
    q,
    clientF,
    projectStatusF,
    dateF,
    problemsOnly,
    problemIds,
    pinned,
    isInProgress,
    sortF,
  ]);

  const filtersActive = projectsHaveActiveFilters({
    q,
    clientF,
    projectStatusF: isInProgress ? "all" : projectStatusF,
    dateF,
    problemsOnly,
  });

  const resetFilters = () => {
    setQ("");
    setClientF("");
    setProjectStatusF("all");
    setDateF("");
    setProblemsOnly(false);
    setSortF("default");
  };

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

  const quickCopy = async (p) => {
    await actions.projectDuplicate(p.id, { name: `${p.name} (копия)` });
  };

  const sourceEmpty = visibleProjects.length === 0;
  const showHeaderCreate = !(isInProgress && sourceEmpty);
  const pageTitle = isInProgress ? "В процессе" : "Проекты";
  const pageSub = isInProgress
    ? "Черновики и незавершённые проекты"
    : `${visibleProjects.length} проект(ов)${matCount != null ? ` · база: ${matCount} материалов` : ""}`;

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
        title={pageTitle}
        sub={pageSub}
        actions={
          showHeaderCreate ? (
            <button className="btn btn-primary" onClick={() => nav("/new")}>
              Создать проект
            </button>
          ) : null
        }
      />
      <div className="content">
        {!isInProgress && <HomeDashboard dash={dash} />}

        {!sourceEmpty && (
          <>
            {!isInProgress && (
              <div style={{ marginBottom: 12 }}>
                <ProjectListFilters value={projectStatusF} onChange={setProjectStatusF} />
              </div>
            )}

            <div className="project-filters no-print">
              <input
                placeholder="Поиск…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ maxWidth: 200 }}
              />
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
              <select value={sortF} onChange={(e) => setSortF(e.target.value)} style={{ width: "auto" }}>
                {PROJECT_SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <label className="row" style={{ fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={problemsOnly}
                  onChange={(e) => setProblemsOnly(e.target.checked)}
                />
                С проблемами
              </label>
              <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
                {filtered.length} из {visibleProjects.length}
              </span>
            </div>
          </>
        )}

        {sourceEmpty ? (
          <Empty
            title={projectsSourceEmptyCopy(isInProgress ? "in-progress" : "active").title}
            hint={projectsSourceEmptyCopy(isInProgress ? "in-progress" : "active").hint}
          >
            <button className="btn btn-primary" onClick={() => nav("/new")}>
              {projectsSourceEmptyCopy(isInProgress ? "in-progress" : "active").cta}
            </button>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty
            title={projectsFilterEmptyTitle(isInProgress ? "in-progress" : "active")}
            hint={filtersActive ? "Измените или сбросьте фильтры." : "Сбросьте фильтры."}
          >
            <button type="button" className="btn" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          </Empty>
        ) : (
          <div className="grid projects-grid">
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                p={p}
                isInProgress={isInProgress}
                problemIds={problemIds}
                pinnedOn={isPinned(p.id)}
                onPin={onPin}
                onArchive={archive}
                onRemove={remove}
                onRegenerate={regenerate}
                onDupSource={setDupSource}
                onQuickCopy={quickCopy}
                onOpenLinkModal={setLinkModal}
                onEdit={(project) => nav(buildBuilderContinuePath(project))}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
