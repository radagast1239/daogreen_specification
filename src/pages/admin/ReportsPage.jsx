import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api.js";
import { money } from "../../store/helpers.js";
import { PageHeader } from "../../components/Layout.jsx";
import { PURCHASE_STATUS_CHIPS } from "../../../shared/purchaseStatusRules.js";
import {
  REPORT_ISSUE_TYPES,
  buildReportsR1,
  filterReportIssues,
  filterReportPurchases,
  groupPurchasesBySupplier,
} from "../../../shared/projectReportsR1.js";
import {
  REPORT_TABS_ALL,
  MATERIAL_DRIFT_TYPES,
  parseReportTabAll,
  buildReportsR2,
  filterReportPublications,
  filterReportMaterialDrift,
} from "../../../shared/projectReportsR2.js";

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseReportTabAll(searchParams.get("report"));
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getReportsR1()
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPayload(null);
          setError(e?.message || "Не удалось загрузить отчёты");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const report = useMemo(() => {
    if (!payload) return null;
    const projects = payload.projects || [];
    const materials = payload.materials || [];
    return {
      ...buildReportsR1(projects, materials),
      ...buildReportsR2(projects, materials),
    };
  }, [payload]);

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set("report", parseReportTabAll(next));
    setSearchParams(params, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Отчёты"
        sub="Сводная информация по проектам, публикациям, базе и закупкам"
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content reports-r1">
        <div className="reports-r1__tabs" role="tablist">
          {REPORT_TABS_ALL.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`btn btn-sm${tab === t.id ? " btn-primary" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="muted">Загрузка…</p>}
        {error && <p className="muted" style={{ color: "var(--danger)" }}>{error}</p>}
        {!loading && !error && report && tab === "overview" && <OverviewTab overview={report.overview} />}
        {!loading && !error && report && tab === "issues" && (
          <IssuesTab issues={report.issues.issues} projects={report.overview.projects} />
        )}
        {!loading && !error && report && tab === "purchases" && (
          <PurchasesTab purchases={report.purchases} projects={report.overview.projects} />
        )}
        {!loading && !error && report && tab === "publications" && (
          <PublicationsTab publications={report.publications} projects={report.overview.projects} />
        )}
        {!loading && !error && report && tab === "material-drift" && (
          <MaterialDriftTab drift={report.materialDrift} projects={report.overview.projects} />
        )}
      </div>
    </>
  );
}

function OverviewTab({ overview }) {
  const c = overview.cards || {};
  const cards = [
    { label: "Активные проекты", value: c.activeProjects },
    { label: "Требуют внимания", value: c.needsAttention },
    { label: "Не опубликованы", value: c.unpublished },
    { label: "Есть изменения после публикации", value: c.withChanges },
    { label: "Общая сумма активных", value: money(c.activeTotal), money: true },
    { label: "Ещё не закуплены", value: money(c.unpurchasedTotal), money: true },
  ];

  return (
    <div className="reports-r1__panel">
      <div className="reports-r1__cards">
        {cards.map((card) => (
          <div key={card.label} className="card reports-r1__card">
            <div className="k">{card.label}</div>
            <div className={`v${card.money ? " num" : " num"}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="card reports-r1__table-card">
        <div className="table-scroll-wrap reports-r1__scroll">
          <table className="spec reports-r1__table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Клиент</th>
                <th>Статус</th>
                <th className="right">Рабочая сумма</th>
                <th className="right">Опубликовано</th>
                <th>Готовность</th>
                <th>Публикация</th>
                <th className="right">Проблемы</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(overview.projects || []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">Нет активных проектов</td>
                </tr>
              ) : (
                overview.projects.map((row) => (
                  <tr key={row.projectId}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.hasUnpublishedChanges && (
                        <span className="chip chip--amber" style={{ marginLeft: 6, fontSize: 11 }}>Есть изменения</span>
                      )}
                    </td>
                    <td>{row.client}</td>
                    <td>{row.statusLabel}</td>
                    <td className="right num">{money(row.workingTotal)}</td>
                    <td className="right num">
                      {row.publishedLabel === "Не опубликован"
                        ? "Не опубликован"
                        : money(row.publishedTotal || 0)}
                    </td>
                    <td>{row.readinessLabel}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {row.lastPublishedVersion
                        ? `v${row.lastPublishedVersion}${row.lastPublishedAt ? ` · ${formatDate(row.lastPublishedAt)}` : ""}`
                        : "—"}
                    </td>
                    <td className="right num">{row.issueCount}</td>
                    <td>
                      <Link className="btn btn-sm" to={row.openPath}>Открыть проект</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function IssuesTab({ issues, projects }) {
  const [projectId, setProjectId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () => filterReportIssues(issues, { projectId, typeId, level, q }),
    [issues, projectId, typeId, level, q]
  );

  return (
    <div className="reports-r1__panel">
      <div className="reports-r1__filters row wrap">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Проект">
          <option value="">Все проекты</option>
          {(projects || []).map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.name}</option>
          ))}
        </select>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Тип проблемы">
          <option value="">Все типы</option>
          {REPORT_ISSUE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Уровень">
          <option value="">Все уровни</option>
          <option value="error">Ошибка</option>
          <option value="warning">Предупреждение</option>
          <option value="info">Информация</option>
        </select>
        <input
          type="search"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск"
        />
      </div>

      <div className="card reports-r1__table-card">
        <div className="table-scroll-wrap reports-r1__scroll">
          <table className="spec reports-r1__table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Позиция</th>
                <th>Раздел</th>
                <th>Проблема</th>
                <th>Уровень</th>
                <th className="right">Цена</th>
                <th>Поставщик</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">Проблем не найдено</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.projectName}</td>
                    <td>{row.itemName}</td>
                    <td>{row.section}</td>
                    <td>{row.typeLabel}</td>
                    <td>
                      <span className={`chip chip--${row.level === "error" ? "danger" : row.level === "warning" ? "amber" : "neutral"}`}>
                        {row.levelLabel}
                      </span>
                    </td>
                    <td className="right num">{money(row.price)}</td>
                    <td>{row.supplier || "—"}</td>
                    <td>
                      <Link className="btn btn-sm" to={row.openPath}>Открыть в проекте</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PurchasesTab({ purchases, projects }) {
  const [projectId, setProjectId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () => filterReportPurchases(purchases.rows, { projectId, supplier, status, q }),
    [purchases.rows, projectId, supplier, status, q]
  );
  const groups = useMemo(() => groupPurchasesBySupplier(filtered), [filtered]);
  const suppliers = useMemo(() => {
    const set = new Set((purchases.rows || []).map((r) => r.supplier).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [purchases.rows]);

  const t = purchases.totals || {};

  return (
    <div className="reports-r1__panel">
      <div className="reports-r1__cards">
        <div className="card reports-r1__card"><div className="k">Общая сумма</div><div className="v num">{money(t.totalSum)}</div></div>
        <div className="card reports-r1__card"><div className="k">Не заказано</div><div className="v num">{money(t.notOrderedSum)}</div></div>
        <div className="card reports-r1__card"><div className="k">Заказано</div><div className="v num">{money(t.orderedSum)}</div></div>
        <div className="card reports-r1__card"><div className="k">Получено</div><div className="v num">{money(t.receivedSum)}</div></div>
        <div className="card reports-r1__card"><div className="k">Поставщиков</div><div className="v num">{t.supplierCount}</div></div>
      </div>

      <div className="reports-r1__filters row wrap">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Проект">
          <option value="">Все проекты</option>
          {(projects || []).map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.name}</option>
          ))}
        </select>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Поставщик">
          <option value="">Все поставщики</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус закупки">
          <option value="">Все статусы</option>
          {PURCHASE_STATUS_CHIPS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск"
        />
      </div>

      {groups.length === 0 ? (
        <p className="muted">Нет позиций для закупки</p>
      ) : (
        groups.map((g) => (
          <div key={g.supplier} className="card reports-r1__table-card" style={{ marginBottom: 14 }}>
            <div className="between wrap" style={{ marginBottom: 8, gap: 8 }}>
              <strong>{g.supplier}</strong>
              <span className="muted num">{money(g.sum)}</span>
            </div>
            <div className="table-scroll-wrap reports-r1__scroll">
              <table className="spec reports-r1__table">
                <thead>
                  <tr>
                    <th>Проект</th>
                    <th>Позиция</th>
                    <th>Ед.</th>
                    <th className="right">Кол-во</th>
                    <th className="right">Цена</th>
                    <th className="right">Сумма</th>
                    <th>Статус</th>
                    <th>Ссылка</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((row) => (
                    <tr key={row.id}>
                      <td>{row.projectName}</td>
                      <td>{row.itemName}</td>
                      <td>{row.unit}</td>
                      <td className="right num">{row.qty}</td>
                      <td className="right num">{money(row.price)}</td>
                      <td className="right num">{money(row.sum)}</td>
                      <td>{row.statusLabel}</td>
                      <td>
                        {row.link ? (
                          <a href={row.link} target="_blank" rel="noreferrer">↗</a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <Link className="btn btn-sm" to={row.openPath}>Открыть проект</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("ru-RU");
  } catch {
    return "";
  }
}

function formatDelta(delta) {
  if (delta == null || Number.isNaN(Number(delta))) return "—";
  const n = Number(delta);
  const sign = n > 0 ? "+" : "";
  return `${sign}${money(n)}`;
}

function PublicationsTab({ publications, projects }) {
  const [projectId, setProjectId] = useState("");
  const [published, setPublished] = useState("");
  const [sync, setSync] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () => filterReportPublications(publications.rows, { projectId, published, sync, q }),
    [publications.rows, projectId, published, sync, q]
  );

  const emptyMsg =
    publications.emptyAllCurrent && !projectId && !published && !sync && !q
      ? "Все проекты опубликованы и актуальны"
      : "Нет проектов по фильтру";

  return (
    <div className="reports-r1__panel">
      <div className="reports-r1__filters row wrap">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Проект">
          <option value="">Все проекты</option>
          {(projects || []).map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.name}</option>
          ))}
        </select>
        <select value={published} onChange={(e) => setPublished(e.target.value)} aria-label="Публикация">
          <option value="">Все</option>
          <option value="yes">Опубликован</option>
          <option value="no">Не опубликован</option>
        </select>
        <select value={sync} onChange={(e) => setSync(e.target.value)} aria-label="Актуальность">
          <option value="">Все статусы</option>
          <option value="changes">Есть изменения</option>
          <option value="current">Актуально</option>
          <option value="unpublished">Не опубликован</option>
        </select>
        <input
          type="search"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск"
        />
      </div>

      <div className="card reports-r1__table-card">
        <div className="table-scroll-wrap reports-r1__scroll">
          <table className="spec reports-r1__table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Клиент</th>
                <th>Статус</th>
                <th className="right">Рабочая</th>
                <th className="right">Опубликовано</th>
                <th className="right">Разница</th>
                <th>Версия</th>
                <th>Дата</th>
                <th>Синхр.</th>
                <th className="right">+/−/~</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="muted">{emptyMsg}</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.projectId}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.client}</td>
                    <td>{row.statusLabel}</td>
                    <td className="right num">{money(row.workingTotal)}</td>
                    <td className="right num">
                      {row.hasPublished ? money(row.publishedTotal || 0) : "Не опубликован"}
                    </td>
                    <td
                      className={`right num${row.delta > 0 ? " reports-r1__delta--up" : row.delta < 0 ? " reports-r1__delta--down" : ""}`}
                    >
                      {row.hasPublished ? formatDelta(row.delta) : "—"}
                    </td>
                    <td>{row.publishedVersion != null ? `v${row.publishedVersion}` : "—"}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {row.publishedAt ? formatDate(row.publishedAt) : "—"}
                    </td>
                    <td>
                      <span
                        className={`chip chip--${
                          row.syncStatus === "changes"
                            ? "amber"
                            : row.syncStatus === "current"
                              ? "ok"
                              : "neutral"
                        }`}
                      >
                        {row.syncBadge}
                      </span>
                    </td>
                    <td className="right muted" style={{ fontSize: 12 }}>
                      {row.hasPublished
                        ? `+${row.addedCount} / −${row.removedCount} / ~${row.changedCount}`
                        : "—"}
                    </td>
                    <td>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <Link className="btn btn-sm" to={row.openPath}>Открыть проект</Link>
                        {row.hasClientLink ? (
                          <Link className="btn btn-sm" to={row.clientPath} target="_blank" rel="noreferrer">
                            Клиентская версия
                          </Link>
                        ) : (
                          <button type="button" className="btn btn-sm" disabled title="Нет публикации">
                            Клиентская версия
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MaterialDriftTab({ drift, projects }) {
  const [projectId, setProjectId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [q, setQ] = useState("");
  const [onlyDiffs, setOnlyDiffs] = useState(true);

  const filtered = useMemo(
    () => filterReportMaterialDrift(drift.rows, { projectId, typeId, supplier, q, onlyDiffs }),
    [drift.rows, projectId, typeId, supplier, q, onlyDiffs]
  );
  const suppliers = useMemo(() => {
    const set = new Set((drift.rows || []).map((r) => r.supplier).filter((s) => s && s !== "—"));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [drift.rows]);

  return (
    <div className="reports-r1__panel">
      <div className="reports-r1__filters row wrap">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Проект">
          <option value="">Все проекты</option>
          {(projects || []).map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.name}</option>
          ))}
        </select>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Тип отличия">
          <option value="">Все типы</option>
          {MATERIAL_DRIFT_TYPES.filter((t) => t.id !== "matches_base" || !onlyDiffs).map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <select value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Поставщик">
          <option value="">Все поставщики</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={onlyDiffs}
            onChange={(e) => setOnlyDiffs(e.target.checked)}
          />
          Только отличия
        </label>
        <input
          type="search"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск"
        />
      </div>

      <div className="card reports-r1__table-card">
        <div className="table-scroll-wrap reports-r1__scroll">
          <table className="spec reports-r1__table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Позиция в проекте</th>
                <th>Материал из базы</th>
                <th className="right">Цена проекта</th>
                <th className="right">Цена базы</th>
                <th>Поставщик</th>
                <th>Тип отличия</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">Отличий от базы не найдено</td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id}>
                    <td>{row.projectName}</td>
                    <td>{row.itemName}</td>
                    <td>{row.materialName}</td>
                    <td className="right num">{money(row.projectPrice)}</td>
                    <td className="right num">{row.basePrice == null ? "—" : money(row.basePrice)}</td>
                    <td>{row.supplier}</td>
                    <td>{row.typeLabel}</td>
                    <td>
                      <Link className="btn btn-sm" to={row.openPath}>Открыть проект</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
