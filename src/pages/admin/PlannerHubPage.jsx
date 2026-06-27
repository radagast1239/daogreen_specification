import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import { Empty } from "../../components/ui.jsx";
import {
  listStandalonePlans,
  createStandalonePlan,
  deleteStandalonePlan,
  readPlanFile,
  importStandalonePlan,
} from "../../planner/standalonePlans.js";
import { AttachPlanModal } from "../../planner/ui/AttachPlanModal.jsx";
import "../../planner/planner.css";

export default function PlannerHubPage() {
  const { state, actions } = useStore();
  const navigate = useNavigate();
  const importRef = useRef(null);
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState(() => listStandalonePlans());
  const [attachDraft, setAttachDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    actions.refreshProjects?.();
  }, [actions]);

  const refreshDrafts = () => setDrafts(listStandalonePlans());

  const projects = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (state.projects || [])
      .filter((p) => {
        if (!ql) return true;
        return `${p.name} ${p.client || ""} ${p.city || ""}`.toLowerCase().includes(ql);
      })
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [state.projects, q]);

  const newDraft = () => {
    const name = prompt("Название плана:", "Новый план");
    if (name === null) return;
    const d = createStandalonePlan(name);
    refreshDrafts();
    navigate(`/planner/draft/${d.id}`);
  };

  const removeDraft = (id, name) => {
    if (!window.confirm(`Удалить черновик «${name}»?`)) return;
    deleteStandalonePlan(id);
    refreshDrafts();
  };

  const onImport = async (file) => {
    try {
      const { name, plan } = await readPlanFile(file);
      const d = importStandalonePlan({ name, plan });
      refreshDrafts();
      navigate(`/planner/draft/${d.id}`);
    } catch (e) {
      alert("Не удалось импортировать: " + (e?.message || e));
    }
  };

  const handleAttachToProject = async (project) => {
    if (!attachDraft) return;
    const itemCount = project.plan?.items?.length ?? 0;
    const wallCount = project.plan?.walls?.length ?? 0;
    if ((itemCount > 0 || wallCount > 0) && !window.confirm(
      `У проекта «${project.name}» уже есть план (${itemCount} объектов). Заменить черновиком?`,
    )) return;
    setBusy(true);
    try {
      await actions.projectUpdate(project.id, {
        plan: attachDraft.plan,
        plannerAttachedAt: new Date().toISOString(),
        plannerAttachedFrom: attachDraft.id,
      });
      setAttachDraft(null);
      const del = window.confirm(
        `План привязан к «${project.name}». Удалить черновик из браузера?`,
      );
      if (del) {
        deleteStandalonePlan(attachDraft.id);
        refreshDrafts();
      }
      navigate(`/project/${project.id}/plan`);
    } catch (e) {
      window.alert("Не удалось привязать: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Планировщик фермы"
        sub="Черновики без привязки к проекту или план внутри спецификации."
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content">
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div className="planner-hub-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <button type="button" className="btn btn-primary" onClick={newDraft}>
              + Новый план с нуля
            </button>
            <button type="button" className="btn" onClick={() => importRef.current?.click()}>
              Импорт .json
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,.daogreen-plan.json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onImport(f);
              }}
            />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Черновик хранится в браузере. Экспортируйте в файл, чтобы не потерять. Привязка к проекту — только когда нужна спецификация.
          </p>
        </div>

        <div className="card" style={{ padding: 0, marginBottom: 20, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
            Черновики ({drafts.length})
          </div>
          {!drafts.length ? (
            <div style={{ padding: 20 }}>
              <Empty title="Нет черновиков">
                <button type="button" className="btn btn-primary" onClick={newDraft}>Создать план</button>
              </Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Обновлён</th>
                    <th>Объектов</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id}>
                      <td><strong>{d.name}</strong></td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {d.updatedAt ? new Date(d.updatedAt).toLocaleString("ru-RU") : "—"}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{d.plan?.items?.length ?? 0}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Link className="btn btn-sm btn-primary" to={`/planner/draft/${d.id}`}>
                          ▦ Открыть
                        </Link>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ marginLeft: 6 }}
                          onClick={() => setAttachDraft(d)}
                        >
                          К проекту
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ marginLeft: 6 }}
                          onClick={() => removeDraft(d.id, d.name)}
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <input
            type="search"
            placeholder="Поиск проектов…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 420 }}
          />
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
            Планы проектов
          </div>
          {!projects.length ? (
            <div style={{ padding: 20 }}>
              <Empty title="Нет проектов">
                <Link className="btn btn-primary" to="/new">Создать проект</Link>
              </Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Проект</th>
                    <th>Клиент</th>
                    <th>Обновлён</th>
                    <th>План</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const itemCount = p.plan?.items?.length ?? 0;
                    const hasPlan = !!p.plan?.room;
                    return (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td className="muted">{p.client || "—"}</td>
                        <td className="num muted" style={{ fontSize: 12 }}>
                          {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString("ru-RU") : "—"}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {hasPlan ? `${itemCount} объектов` : "ещё не начат"}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <Link className="btn btn-sm btn-primary" to={`/project/${p.id}/plan`}>
                            ▦ Открыть
                          </Link>
                          <Link className="btn btn-sm" to={`/project/${p.id}`} style={{ marginLeft: 6 }}>
                            Спецификация
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <AttachPlanModal
        open={!!attachDraft}
        projects={state.projects}
        draftName={attachDraft?.name}
        busy={busy}
        onClose={() => setAttachDraft(null)}
        onAttach={handleAttachToProject}
      />
    </>
  );
}
