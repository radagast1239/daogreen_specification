import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api.js";
import { money } from "../../store/helpers.js";
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
import {
  SECTION_CARD_KEYS,
  NO_ROOM_GROUP,
  buildReportsSections,
  filterReportSections,
  filterReportRooms,
} from "../../../shared/projectReportsR3.js";
import { PROJECT_STATUS_LIST_FILTERS } from "../../../shared/projectStatus.js";
import { downloadReportsPurchaseExcel } from "../../lib/reportsPurchaseExcel.js";
import {
  REPORT_TAB_SHORT_LABELS,
  shouldShowReportKpi,
  countIssuesByLevel,
  filterIssuesForDisplay,
  publicationDiffChips,
  syncStatusTone,
  driftTypeTone,
  isLargePriceDelta,
  defaultPurchaseGroupOpen,
  sortRoomsForDisplay,
  countNoRoomItems,
  reportFiltersActive,
  issueLevelTone,
} from "../../../shared/reportsUi.js";
import "../../styles/reports.css";

function ReportKpi({ id, label, value, tone, keepZero, important }) {
  if (!shouldShowReportKpi({ id, value, keepZero, important })) return null;
  return (
    <div className={`report-kpi${tone ? ` report-kpi--${tone}` : ""}`}>
      <div className="report-kpi__label">{label}</div>
      <div className="report-kpi__value">{value}</div>
    </div>
  );
}

function OpenLink({ to, children = "Открыть", external = false, disabled = false, title }) {
  if (disabled) {
    return (
      <button type="button" className="reports-open reports-open--ghost" disabled title={title || "Недоступно"}>
        {children}
      </button>
    );
  }
  if (external) {
    return (
      <Link className="reports-open" to={to} target="_blank" rel="noreferrer" title={title}>
        {children}
      </Link>
    );
  }
  return (
    <Link className="reports-open" to={to} title={title}>
      {children}
    </Link>
  );
}

function FilterBar({ children, search, onSearch, found, onReset, active, excel, filtersOpen, onToggleFilters }) {
  return (
    <>
      <div className={`reports-filters${filtersOpen === false ? " is-collapsed" : ""}`}>
        <button type="button" className="btn btn-sm reports-filters__toggle" onClick={onToggleFilters}>
          {filtersOpen ? "Скрыть фильтры" : "Фильтры"}
        </button>
        <div className="reports-filters__selects">{children}</div>
        {search != null && (
          <input
            type="search"
            placeholder="Поиск…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Поиск"
          />
        )}
        <div className="reports-filters__actions">
          {found != null && <span className="reports-filters__meta">Найдено: {found}</span>}
          {active && (
            <button type="button" className="btn btn-sm" onClick={onReset}>
              Сбросить
            </button>
          )}
          {excel}
        </div>
      </div>
    </>
  );
}

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseReportTabAll(searchParams.get("report"));
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const tabsRef = useRef(null);

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
      ...buildReportsR3(projects, materials),
      _projects: projects,
      _materials: materials,
    };
  }, [payload]);

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set("report", parseReportTabAll(next));
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    const root = tabsRef.current;
    if (!root) return;
    const active = root.querySelector(".reports-tabs__btn.is-active");
    if (active?.scrollIntoView) {
      active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }, [tab]);

  const activeCount = report?.overview?.cards?.activeProjects ?? 0;

  return (
    <div className="reports">
      <header className="reports-header">
        <div>
          <div className="reports-header__crumb">
            <Link to="/">Проекты</Link>
            <span> / Отчёты</span>
          </div>
          <h1 className="reports-header__title">Отчёты</h1>
          <p className="reports-header__sub">
            Сводка по проектам, закупкам, публикациям и расхождениям с базой материалов
          </p>
        </div>
        {!loading && !error && report ? (
          <div className="reports-header__meta">{activeCount} активных проекта</div>
        ) : null}
      </header>

      <div className="reports-tabs" role="tablist" ref={tabsRef}>
        {REPORT_TABS_ALL.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`reports-tabs__btn${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="reports-tabs__full">{t.label}</span>
            <span className="reports-tabs__short">{REPORT_TAB_SHORT_LABELS[t.id] || t.label}</span>
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
      {!loading && !error && report && tab === "sections" && (
        <SectionsTab
          projects={report._projects}
          materials={report._materials}
          overviewProjects={report.overview.projects}
        />
      )}
      {!loading && !error && report && tab === "rooms" && (
        <RoomsTab rooms={report.rooms} projects={report.overview.projects} />
      )}
    </div>
  );
}

function OverviewTab({ overview }) {
  const c = overview.cards || {};
  const cards = [
    { id: "activeProjects", label: "Активные проекты", value: c.activeProjects, keepZero: true },
    { id: "needsAttention", label: "Требуют внимания", value: c.needsAttention, tone: c.needsAttention > 0 ? "warn" : "ok", keepZero: true },
    { id: "unpublished", label: "Не опубликованы", value: c.unpublished, tone: c.unpublished > 0 ? "amber" : undefined, keepZero: true },
    { id: "withChanges", label: "Изменения после публикации", value: c.withChanges, tone: c.withChanges > 0 ? "warn" : undefined, keepZero: true },
    { id: "activeTotal", label: "Общая сумма", value: money(c.activeTotal), important: true },
    { id: "unpurchasedTotal", label: "Ещё не закуплено", value: money(c.unpurchasedTotal), important: true },
  ];

  return (
    <div className="reports-panel">
      <div className="reports-kpis">
        {cards.map((card) => (
          <ReportKpi key={card.id} {...card} />
        ))}
      </div>

      <div className="reports-table-card">
        <div className="reports-scroll">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Проект</th>
                <th className="reports-col-secondary">Клиент</th>
                <th>Статус</th>
                <th className="right">Рабочая</th>
                <th className="right">Опубликовано</th>
                <th>Готовность</th>
                <th className="reports-col-secondary">Публикация</th>
                <th className="right">Проблемы</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(overview.projects || []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="reports-empty">Нет активных проектов</td>
                </tr>
              ) : (
                overview.projects.map((row) => {
                  const attention = row.hasUnpublishedChanges || (row.issueCount || 0) > 0 || row.publishedLabel === "Не опубликован";
                  const issueTone = (row.issueCount || 0) > 0 ? "warn" : "ok";
                  const sameTotals =
                    row.publishedTotal != null &&
                    Math.round((row.workingTotal || 0) * 100) === Math.round((row.publishedTotal || 0) * 100);
                  return (
                    <tr key={row.projectId} className={attention ? "is-attention" : undefined}>
                      <td>
                        <div className="reports-table__name" title={row.name}>{row.name}</div>
                        {row.hasUnpublishedChanges && (
                          <span className="reports-chip reports-chip--amber" style={{ marginTop: 4 }}>Есть изменения</span>
                        )}
                      </td>
                      <td className="reports-col-secondary">{row.client}</td>
                      <td><span className="reports-chip reports-chip--neutral">{row.statusLabel}</span></td>
                      <td className="right num">{money(row.workingTotal)}</td>
                      <td className={`right num${sameTotals ? "" : ""}`}>
                        {row.publishedLabel === "Не опубликован"
                          ? <span className="reports-chip reports-chip--amber">Не опубликован</span>
                          : money(row.publishedTotal || 0)}
                      </td>
                      <td><span className="reports-chip reports-chip--neutral">{row.readinessLabel}</span></td>
                      <td className="reports-col-secondary muted" style={{ fontSize: 12 }}>
                        {row.lastPublishedVersion
                          ? `v${row.lastPublishedVersion}${row.lastPublishedAt ? ` · ${formatDate(row.lastPublishedAt)}` : ""}`
                          : "—"}
                      </td>
                      <td className="right">
                        <span className={`reports-chip reports-chip--${issueTone}`}>{row.issueCount}</span>
                      </td>
                      <td>
                        <OpenLink to={row.openPath} />
                      </td>
                    </tr>
                  );
                })
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
  const [showInfo, setShowInfo] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const filtered = useMemo(
    () => filterReportIssues(issues, { projectId, typeId, level, q }),
    [issues, projectId, typeId, level, q]
  );
  const displayed = useMemo(
    () => filterIssuesForDisplay(filtered, { showInfo }),
    [filtered, showInfo]
  );
  const counts = useMemo(() => countIssuesByLevel(filtered), [filtered]);
  const active = reportFiltersActive([projectId, typeId, level, q]);

  return (
    <div className="reports-panel">
      <div className="reports-summary-row">
        <span className="reports-chip reports-chip--danger">Ошибки: {counts.error}</span>
        <span className="reports-chip reports-chip--warn">Предупреждения: {counts.warning}</span>
        <span className="reports-chip reports-chip--neutral">Информация: {counts.info}</span>
        <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13, marginLeft: "auto" }}>
          <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} />
          Показывать информационные
        </label>
      </div>

      <FilterBar
        search={q}
        onSearch={setQ}
        found={displayed.length}
        active={active}
        onReset={() => { setProjectId(""); setTypeId(""); setLevel(""); setQ(""); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
      >
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
      </FilterBar>

      <div className="reports-table-card">
        <div className="reports-scroll">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Проблема</th>
                <th>Уровень</th>
                <th>Проект</th>
                <th className="reports-col-secondary">Раздел</th>
                <th className="reports-col-secondary">Позиция</th>
                <th className="right reports-col-secondary">Цена</th>
                <th className="reports-col-secondary">Поставщик</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={8} className="reports-empty">Проблем не найдено</td></tr>
              ) : (
                displayed.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="reports-table__name" title={row.typeLabel}>{row.typeLabel}</div>
                      <div className="reports-table__secondary" title={row.itemName}>{row.itemName}</div>
                    </td>
                    <td>
                      <span className={`reports-chip reports-chip--${issueLevelTone(row.level)}`}>
                        {row.levelLabel}
                      </span>
                    </td>
                    <td>{row.projectName}</td>
                    <td className="reports-col-secondary">{row.section}</td>
                    <td className="reports-col-secondary">{row.itemName}</td>
                    <td className="right num reports-col-secondary">{money(row.price)}</td>
                    <td className="reports-col-secondary">{row.supplier || "—"}</td>
                    <td><OpenLink to={row.openPath} /></td>
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
  const [excelBusy, setExcelBusy] = useState(false);
  const [excelError, setExcelError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [openMap, setOpenMap] = useState({});

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
  const active = reportFiltersActive([projectId, supplier, status, q]);

  useEffect(() => {
    setOpenMap((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (next[g.supplier] === undefined) next[g.supplier] = defaultPurchaseGroupOpen(g);
      }
      return next;
    });
  }, [groups]);

  const onExcel = async () => {
    setExcelError("");
    setExcelBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 0));
      const projName =
        projectId && projects?.find((p) => p.projectId === projectId)?.name
          ? projects.find((p) => p.projectId === projectId).name
          : "";
      downloadReportsPurchaseExcel(filtered, { projectName: projName });
    } catch (e) {
      setExcelError(e?.message || "Не удалось выгрузить Excel");
    } finally {
      setExcelBusy(false);
    }
  };

  return (
    <div className="reports-panel">
      <div className="reports-kpis">
        <ReportKpi id="totalSum" label="Общая сумма" value={money(t.totalSum)} important />
        <ReportKpi id="notOrderedSum" label="Не заказано" value={money(t.notOrderedSum)} keepZero />
        <ReportKpi id="orderedSum" label="Заказано" value={money(t.orderedSum)} keepZero />
        <ReportKpi id="receivedSum" label="Получено" value={money(t.receivedSum)} keepZero />
        <ReportKpi id="supplierCount" label="Поставщиков" value={t.supplierCount} keepZero />
      </div>

      <FilterBar
        search={q}
        onSearch={setQ}
        found={filtered.length}
        active={active}
        onReset={() => { setProjectId(""); setSupplier(""); setStatus(""); setQ(""); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        excel={
          <button type="button" className="btn btn-sm btn-primary" onClick={onExcel} disabled={excelBusy || !filtered.length}>
            {excelBusy ? "Excel…" : "Скачать Excel"}
          </button>
        }
      >
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
      </FilterBar>
      {excelError ? <p className="muted" style={{ color: "var(--danger)" }}>{excelError}</p> : null}

      {groups.length === 0 ? (
        <p className="reports-empty">Нет позиций для закупки</p>
      ) : (
        groups.map((g) => {
          const isMissing = g.supplier === "Поставщик не указан" || g.supplier === "—";
          const open = openMap[g.supplier] !== false;
          return (
            <div key={g.supplier} className={`reports-purchase-group${isMissing ? " is-missing" : ""}`}>
              <button
                type="button"
                className="reports-purchase-group__head"
                onClick={() => setOpenMap((m) => ({ ...m, [g.supplier]: !open }))}
                aria-expanded={open}
              >
                <div>
                  <div className="reports-purchase-group__title">{g.supplier}</div>
                  <div className="reports-purchase-group__meta">
                    <span>{g.items.length} поз.</span>
                    <span className="num">{money(g.sum)}</span>
                  </div>
                </div>
                <span className="reports-purchase-group__chev">{open ? "▾" : "▸"}</span>
              </button>
              {open ? (
                <div className="reports-scroll">
                  <table className="reports-table">
                    <thead>
                      <tr>
                        <th>Проект</th>
                        <th>Позиция</th>
                        <th className="reports-col-secondary">Ед.</th>
                        <th className="right">Кол-во</th>
                        <th className="right reports-col-secondary">Цена</th>
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
                          <td>
                            <div className="reports-table__name" title={row.itemName}>{row.itemName}</div>
                          </td>
                          <td className="reports-col-secondary">{row.unit}</td>
                          <td className="right num">{row.qty}</td>
                          <td className="right num reports-col-secondary">{money(row.price)}</td>
                          <td className="right num" style={{ fontWeight: 700 }}>{money(row.sum)}</td>
                          <td><span className="reports-chip reports-chip--neutral">{row.statusLabel}</span></td>
                          <td>
                            {row.link ? (
                              <a className="reports-link-btn" href={row.link} target="_blank" rel="noreferrer" title={row.link}>↗</a>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td><OpenLink to={row.openPath} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })
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
  const [filtersOpen, setFiltersOpen] = useState(true);

  const filtered = useMemo(
    () => filterReportPublications(publications.rows, { projectId, published, sync, q }),
    [publications.rows, projectId, published, sync, q]
  );
  const active = reportFiltersActive([projectId, published, sync, q]);

  const emptyMsg =
    publications.emptyAllCurrent && !projectId && !published && !sync && !q
      ? "Все проекты опубликованы и актуальны"
      : "Нет проектов по фильтру";

  return (
    <div className="reports-panel">
      <FilterBar
        search={q}
        onSearch={setQ}
        found={filtered.length}
        active={active}
        onReset={() => { setProjectId(""); setPublished(""); setSync(""); setQ(""); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
      >
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
      </FilterBar>

      <div className="reports-table-card">
        <div className="reports-scroll">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Синхронизация</th>
                <th className="reports-col-secondary">Клиент</th>
                <th className="right">Рабочая</th>
                <th className="right">Опубликовано</th>
                <th className="right">Разница</th>
                <th>Изменения</th>
                <th className="reports-col-secondary">Версия</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="reports-empty">{emptyMsg}</td></tr>
              ) : (
                filtered.map((row) => {
                  const chips = publicationDiffChips(row);
                  const deltaClass =
                    !row.hasPublished || row.delta == null || row.delta === 0
                      ? "reports-delta--zero"
                      : row.delta > 0
                        ? "reports-delta--up"
                        : "reports-delta--down";
                  return (
                    <tr key={row.projectId} className={row.syncStatus === "changes" || row.syncStatus === "unpublished" ? "is-attention" : undefined}>
                      <td>
                        <div className="reports-table__name" title={row.name}>{row.name}</div>
                        <div className="reports-table__secondary">{row.statusLabel}</div>
                      </td>
                      <td>
                        <span className={`reports-chip reports-chip--${syncStatusTone(row.syncStatus)}`}>
                          {row.syncBadge}
                        </span>
                      </td>
                      <td className="reports-col-secondary">{row.client}</td>
                      <td className="right num">{money(row.workingTotal)}</td>
                      <td className="right num">
                        {row.hasPublished ? money(row.publishedTotal || 0) : "—"}
                      </td>
                      <td className={`right num ${deltaClass}`}>
                        {row.hasPublished ? formatDelta(row.delta) : "—"}
                      </td>
                      <td>
                        <div className="reports-summary-row" style={{ margin: 0 }}>
                          {chips.length
                            ? chips.map((c) => (
                                <span key={c.id} className={`reports-chip reports-chip--${c.tone}`}>{c.label}</span>
                              ))
                            : <span className="muted">—</span>}
                        </div>
                      </td>
                      <td className="reports-col-secondary muted" style={{ fontSize: 12 }}>
                        {row.publishedVersion != null ? `v${row.publishedVersion}` : "—"}
                        {row.publishedAt ? ` · ${formatDate(row.publishedAt)}` : ""}
                      </td>
                      <td>
                        <div className="reports-actions">
                          <OpenLink to={row.openPath}>Проект</OpenLink>
                          {row.hasClientLink ? (
                            <OpenLink to={row.clientPath} external>Версия клиента</OpenLink>
                          ) : (
                            <OpenLink to="#" disabled title="Нет публикации">Версия клиента</OpenLink>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
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
  const [filtersOpen, setFiltersOpen] = useState(true);

  const filtered = useMemo(
    () => filterReportMaterialDrift(drift.rows, { projectId, typeId, supplier, q, onlyDiffs }),
    [drift.rows, projectId, typeId, supplier, q, onlyDiffs]
  );
  const suppliers = useMemo(() => {
    const set = new Set((drift.rows || []).map((r) => r.supplier).filter((s) => s && s !== "—"));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [drift.rows]);
  const active = reportFiltersActive([projectId, typeId, supplier, q]);

  return (
    <div className="reports-panel">
      <FilterBar
        search={q}
        onSearch={setQ}
        found={filtered.length}
        active={active}
        onReset={() => { setProjectId(""); setTypeId(""); setSupplier(""); setQ(""); setOnlyDiffs(true); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
      >
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
          <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} />
          Только отличия
        </label>
      </FilterBar>
      {onlyDiffs ? (
        <div className="reports-filters__meta" style={{ marginBottom: 10 }}>Отличий: {filtered.length}</div>
      ) : null}

      <div className="reports-table-card">
        <div className="reports-scroll">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Позиция / база</th>
                <th>Цены</th>
                <th className="reports-col-secondary">Поставщик</th>
                <th>Тип</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="reports-empty">Отличий от базы не найдено</td></tr>
              ) : (
                filtered.map((row) => {
                  const tone = driftTypeTone(row.typeId);
                  const big = isLargePriceDelta(row.projectPrice, row.basePrice);
                  return (
                    <tr key={row.id} className={big ? "is-price-gap" : undefined}>
                      <td>{row.projectName}</td>
                      <td>
                        <div className="reports-table__name" title={row.itemName}>{row.itemName}</div>
                        <div className="reports-table__secondary" title={row.materialName}>{row.materialName}</div>
                      </td>
                      <td className="reports-price-pair">
                        <span className={row.projectPrice !== row.basePrice ? "reports-price-pair__diff" : ""}>
                          {money(row.projectPrice)}
                        </span>
                        <span className="reports-price-pair__arrow">→</span>
                        <span>{row.basePrice == null ? "—" : money(row.basePrice)}</span>
                      </td>
                      <td className="reports-col-secondary">{row.supplier}</td>
                      <td>
                        <span className={`reports-chip reports-chip--${tone}`}>{row.typeLabel}</span>
                      </td>
                      <td><OpenLink to={row.openPath} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SectionsTab({ projects, materials, overviewProjects }) {
  const [projectId, setProjectId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);

  const scopedProjects = useMemo(() => {
    let list = projects || [];
    if (statusId) {
      list = list.filter((p) => {
        const filter = PROJECT_STATUS_LIST_FILTERS.find((f) => f.id === statusId);
        if (!filter?.statusIds) return true;
        return filter.statusIds.includes(p.status);
      });
    }
    return list;
  }, [projects, statusId]);

  const sections = useMemo(
    () => buildReportsSections(scopedProjects, materials, { projectId }),
    [scopedProjects, materials, projectId]
  );
  const filtered = useMemo(
    () => filterReportSections(sections.rows, { q }),
    [sections.rows, q]
  );
  const cards = sections.cards || {};
  const cardDefs = [
    { id: "totalSum", label: "Общая сумма", always: true },
    ...SECTION_CARD_KEYS.map((c) => ({ id: c.id, label: c.label, always: false })),
  ];
  const active = reportFiltersActive([projectId, statusId, q]);

  return (
    <div className="reports-panel">
      <div className="reports-kpis">
        {cardDefs.map((c) => {
          const val = cards[c.id] ?? 0;
          if (!c.always && !(val > 0)) return null;
          return <ReportKpi key={c.id} id={c.id} label={c.label} value={money(val)} important={c.always} />;
        })}
      </div>

      <FilterBar
        search={q}
        onSearch={setQ}
        found={filtered.length}
        active={active}
        onReset={() => { setProjectId(""); setStatusId(""); setQ(""); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
      >
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Проект">
          <option value="">Все проекты</option>
          {(overviewProjects || []).map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.name}</option>
          ))}
        </select>
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)} aria-label="Статус проекта">
          <option value="">Все статусы</option>
          {PROJECT_STATUS_LIST_FILTERS.filter((f) => f.id !== "all" && f.statusIds).map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </FilterBar>

      <div className="reports-table-card">
        <div className="reports-scroll">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Раздел</th>
                <th className="right">Позиций</th>
                <th className="right">Сумма</th>
                <th className="right">Доля</th>
                <th className="right">Проблемы</th>
                <th className="right">Не закуплено</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="reports-empty">Нет данных по разделам</td></tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.sectionLabel}>
                    <td>
                      <div className="reports-table__name" title={row.sectionLabel}>{row.sectionLabel}</div>
                    </td>
                    <td className="right num">{row.itemCount}</td>
                    <td className="right num" style={{ fontWeight: 700 }}>{money(row.sum)}</td>
                    <td className="right">
                      <div className="reports-share">
                        <div className="reports-share__bar" aria-hidden>
                          <i style={{ width: `${Math.min(100, Math.max(0, Number(row.sharePct) || 0))}%` }} />
                        </div>
                        <span className="reports-share__pct">{row.sharePct}%</span>
                      </div>
                    </td>
                    <td className="right">
                      <span className={`reports-chip reports-chip--${row.problemCount ? "warn" : "ok"}`}>
                        {row.problemCount}
                      </span>
                    </td>
                    <td className="right">
                      <span className={`reports-chip reports-chip--${row.unpurchasedCount ? "amber" : "neutral"}`}>
                        {row.unpurchasedCount}
                      </span>
                    </td>
                    <td>
                      {row.openPath && row.openPath !== "/" ? (
                        <OpenLink to={row.openPath} />
                      ) : (
                        <span className="muted">—</span>
                      )}
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

function RoomsTab({ rooms, projects }) {
  const [projectId, setProjectId] = useState("");
  const [room, setRoom] = useState("");
  const [section, setSection] = useState("");
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const filtered = useMemo(
    () => filterReportRooms(rooms.rows, { projectId, room, section, q }),
    [rooms.rows, projectId, room, section, q]
  );
  const displayRows = useMemo(
    () => sortRoomsForDisplay(filtered, NO_ROOM_GROUP),
    [filtered]
  );
  const noRoomCount = useMemo(
    () => countNoRoomItems(filtered, NO_ROOM_GROUP),
    [filtered]
  );
  const roomOptions = useMemo(() => {
    const set = new Set((rooms.rows || []).map((r) => r.roomLabel).filter(Boolean));
    return [...set].sort((a, b) => {
      if (a === NO_ROOM_GROUP) return 1;
      if (b === NO_ROOM_GROUP) return -1;
      return a.localeCompare(b, "ru");
    });
  }, [rooms.rows]);
  const active = reportFiltersActive([projectId, room, section, q]);

  return (
    <div className="reports-panel">
      {noRoomCount > 0 ? (
        <div className="reports-warning-banner">Без помещения: {noRoomCount} позиций</div>
      ) : null}

      <FilterBar
        search={q}
        onSearch={setQ}
        found={displayRows.length}
        active={active}
        onReset={() => { setProjectId(""); setRoom(""); setSection(""); setQ(""); }}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        excel={
          <button type="button" className="btn btn-sm reports-mobile-details" onClick={() => setShowBreakdown((v) => !v)}>
            {showBreakdown ? "Скрыть разбивку" : "Показать разбивку"}
          </button>
        }
      >
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Проект">
          <option value="">Все проекты</option>
          {(projects || []).map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.name}</option>
          ))}
        </select>
        <select value={room} onChange={(e) => setRoom(e.target.value)} aria-label="Помещение">
          <option value="">Все помещения</option>
          {roomOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Раздел">
          <option value="">Все разделы</option>
          {SECTION_CARD_KEYS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </FilterBar>

      <div className="reports-table-card">
        <div className="reports-scroll">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Помещение</th>
                <th className="right">Позиций</th>
                <th className={`right${showBreakdown ? "" : " reports-col-secondary"}`}>Оборуд.</th>
                <th className={`right${showBreakdown ? "" : " reports-col-secondary"}`}>Матер.</th>
                <th className={`right${showBreakdown ? "" : " reports-col-secondary"}`}>Работы</th>
                <th className={`right${showBreakdown ? "" : " reports-col-secondary"}`}>Электр.</th>
                <th className={`right${showBreakdown ? "" : " reports-col-secondary"}`}>Сантехн.</th>
                <th className={`right${showBreakdown ? "" : " reports-col-secondary"}`}>Климат</th>
                <th className="right">Сумма</th>
                <th className="right">Проблемы</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr><td colSpan={12} className="reports-empty">Помещения не указаны</td></tr>
              ) : (
                displayRows.map((row) => {
                  const isNoRoom = row.roomLabel === NO_ROOM_GROUP;
                  return (
                    <tr key={`${row.projectId}:${row.roomLabel}`} className={isNoRoom ? "is-warn-row" : undefined}>
                      <td>{row.projectName}</td>
                      <td>
                        <div className="reports-table__name" title={row.roomLabel}>
                          {isNoRoom ? "⚠ " : ""}{row.roomLabel}
                        </div>
                      </td>
                      <td className="right num">{row.itemCount}</td>
                      <td className={`right num${showBreakdown ? "" : " reports-col-secondary"}`}>{money(row.equipment)}</td>
                      <td className={`right num${showBreakdown ? "" : " reports-col-secondary"}`}>{money(row.materials)}</td>
                      <td className={`right num${showBreakdown ? "" : " reports-col-secondary"}`}>{money(row.works)}</td>
                      <td className={`right num${showBreakdown ? "" : " reports-col-secondary"}`}>{money(row.electrics)}</td>
                      <td className={`right num${showBreakdown ? "" : " reports-col-secondary"}`}>{money(row.plumbing)}</td>
                      <td className={`right num${showBreakdown ? "" : " reports-col-secondary"}`}>{money(row.climate)}</td>
                      <td className="right num" style={{ fontWeight: 700 }}>{money(row.sum)}</td>
                      <td className="right">
                        <span className={`reports-chip reports-chip--${row.problemCount ? "warn" : "ok"}`}>
                          {row.problemCount}
                        </span>
                      </td>
                      <td><OpenLink to={row.openPath} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
