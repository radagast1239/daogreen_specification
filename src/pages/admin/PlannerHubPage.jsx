import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import { Empty } from "../../components/ui.jsx";

export default function PlannerHubPage() {
  const { state, actions } = useStore();
  const [q, setQ] = useState("");

  useEffect(() => {
    actions.refreshProjects?.();
  }, [actions]);

  const projects = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (state.projects || [])
      .filter((p) => {
        if (!ql) return true;
        return `${p.name} ${p.client || ""} ${p.city || ""}`.toLowerCase().includes(ql);
      })
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [state.projects, q]);

  return (
    <>
      <PageHeader
        title="Планировщик фермы"
        sub="2D-план помещения, слои, объекты и связь со спецификацией. Выберите проект."
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content">
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
            Откройте план проекта, расставьте стеллажи и оборудование, затем нажмите «В спецификацию» на странице плана.
          </p>
          <input
            type="search"
            placeholder="Поиск по названию, клиенту, городу…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 420 }}
          />
        </div>

        {!projects.length ? (
          <Empty title="Нет проектов">
            <Link className="btn btn-primary" to="/new">Создать проект</Link>
          </Empty>
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
                        {hasPlan ? `${itemCount} объектов на плане` : "ещё не начат"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Link className="btn btn-sm btn-primary" to={`/project/${p.id}/plan`}>
                          ▦ Открыть план
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
    </>
  );
}
