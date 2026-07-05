import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import { useToast } from "../../components/Toast.jsx";
import { downloadCSV } from "../../lib/exportDownload.js";
import {
  analyzeMaterialsQuality,
  matchQualityFilter,
  QUALITY_QUICK_FILTERS,
  qualityReportRows,
  qualitySummaryRows,
} from "../../../shared/materialQualityCheck.js";

const SEV_STYLE = {
  critical: { color: "var(--danger)", chip: "chip chip--danger", label: "Критично" },
  warning: { color: "var(--warn)", chip: "chip chip--amber", label: "Предупреждение" },
  info: { color: "var(--muted)", chip: "chip chip--neutral", label: "Рекомендация" },
};

export function MaterialsQualityPanel({ materials, modules, onEditMaterial, onPatchMaterial }) {
  const [qualityFilter, setQualityFilter] = useState("all");

  const activeModuleNames = useMemo(
    () => (modules || []).filter((m) => m.active !== false).map((m) => m.name),
    [modules]
  );

  const report = useMemo(
    () => analyzeMaterialsQuality(materials, { activeModuleNames }),
    [materials, activeModuleNames]
  );

  const filteredEntries = useMemo(() => {
    const list = report.problematicEntries || [];
    if (qualityFilter === "all") return list;
    return list.filter((entry) => matchQualityFilter(entry, qualityFilter));
  }, [report, qualityFilter]);

  const issueTotal =
    report.criticalIssueCount + report.warningIssueCount + report.infoIssueCount;

  const exportCsv = () => {
    const rows = qualityReportRows(report);
    if (!rows.length) return;
    downloadCSV(`materials-quality-${new Date().toISOString().slice(0, 10)}`, rows);
  };

  const exportXlsx = async () => {
    const { downloadXlsx } = await import("../../lib/exportXlsx.js");
    const detail = qualityReportRows(report);
    const summary = qualitySummaryRows(report);
    const stamp = new Date().toISOString().slice(0, 10);
    if (summary.length) downloadXlsx(`materials-quality-${stamp}`, summary, "Сводка");
    if (detail.length) downloadXlsx(`materials-quality-${stamp}-detail`, detail, "Проблемы");
  };

  return (
    <>
      <section className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Проверка базы материалов</h3>
        <div className="stat-grid">
          <div className="stat">
            <div className="k">Всего материалов</div>
            <div className="v num">{report.totalMaterials}</div>
          </div>
          <div className="stat">
            <div className="k">Критичных проблем</div>
            <div className="v num" style={{ color: "var(--danger)" }}>
              {report.criticalIssueCount}
            </div>
          </div>
          <div className="stat">
            <div className="k">Предупреждений</div>
            <div className="v num" style={{ color: "var(--warn)" }}>
              {report.warningIssueCount}
            </div>
          </div>
          <div className="stat">
            <div className="k">Рекомендаций</div>
            <div className="v num">{report.infoIssueCount}</div>
          </div>
          <div className="stat">
            <div className="k">Готовы к клиентской выдаче</div>
            <div className="v num" style={{ color: "var(--ok)" }}>
              {report.readyCount}
            </div>
          </div>
        </div>
      </section>

      <div className="toolbar" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <span className="muted">
          {report.problematicEntries?.length || 0} материалов с замечаниями · {issueTotal} замечаний
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" className="btn" onClick={exportCsv} disabled={!issueTotal}>
            CSV ↓
          </button>
          <button type="button" className="btn btn-primary" onClick={exportXlsx} disabled={!issueTotal}>
            Excel ↓
          </button>
        </span>
      </div>

      <div className="toolbar" style={{ marginBottom: 16, flexWrap: "wrap", gap: 6 }}>
        {QUALITY_QUICK_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn-sm ${qualityFilter === f.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setQualityFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 18 }}>
            {issueTotal === 0
              ? "Замечаний нет — база выглядит аккуратно."
              : "По выбранному фильтру проблемных материалов нет."}
          </p>
        </div>
      ) : (
        filteredEntries.map((entry) => {
          const visibleIssues =
            qualityFilter === "all"
              ? entry.issues
              : entry.issues.filter((issue) => {
                  if (qualityFilter === "critical") return issue.severity === "critical";
                  if (qualityFilter === "duplicates") {
                    return issue.id === "duplicate_name_unit" || issue.id === "duplicate_purchase_key";
                  }
                  return issue.id === qualityFilter;
                });

          if (!visibleIssues.length) return null;

          return (
            <article key={entry.row.id} className="card" style={{ marginBottom: 12, padding: 16 }}>
              <header
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{entry.row.name || "—"}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {entry.row.unit || "—"} · {entry.row.clientSectionLabel || entry.row.clientSection || "—"} ·{" "}
                    {entry.row.supplier || "без поставщика"}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => onEditMaterial?.(entry.row.id)}
                >
                  Открыть материал
                </button>
              </header>

              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
                {visibleIssues.map((issue) => {
                  const sev = SEV_STYLE[issue.severity] || SEV_STYLE.warning;
                  return (
                    <li
                      key={`${entry.row.id}-${issue.id}`}
                      style={{
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className={sev.chip} style={{ fontSize: 11 }}>
                          {sev.label}
                        </span>
                        <strong style={{ fontSize: 13 }}>{issue.label}</strong>
                        {(issue.duplicateCount || 0) > 1 && (
                          <span className="muted" style={{ fontSize: 12 }}>
                            ({issue.duplicateCount} шт.)
                          </span>
                        )}
                      </div>
                      {issue.hint && (
                        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                          {issue.hint}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {onPatchMaterial && (
                <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onPatchMaterial(entry.row.id, { active: false, status: "archived" })}
                  >
                    Скрыть
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      onPatchMaterial(entry.row.id, {
                        category: "Требует разбора",
                        clientSection: "requires_review",
                      })
                    }
                  >
                    На проверку
                  </button>
                </div>
              )}
            </article>
          );
        })
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Проверка не изменяет базу автоматически. Дубли с разными поставщиками или ссылками могут быть
        отдельными закупочными позициями — объединяйте вручную через «Дубликаты», только если это одна и
        та же позиция.
      </p>
    </>
  );
}

export default function MaterialsQualityPage() {
  const { state, actions } = useStore();
  const navigate = useNavigate();
  const { success } = useToast();

  return (
    <>
      <PageHeader
        title="Проверка базы материалов"
        sub="Качество справочника перед публикацией клиенту"
        back={{ to: "/materials", label: "Материалы" }}
      />
      <div className="content">
        <MaterialsQualityPanel
          materials={state.materials}
          modules={state.modules}
          onEditMaterial={(id) => navigate(`/materials?edit=${encodeURIComponent(id)}`)}
          onPatchMaterial={async (id, patch) => {
            await actions.materialUpdate(id, patch);
            success("Изменения сохранены");
          }}
        />
      </div>
    </>
  );
}
