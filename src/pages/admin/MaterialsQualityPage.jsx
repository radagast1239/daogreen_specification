import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import { useToast } from "../../components/Toast.jsx";
import { downloadCSV } from "../../lib/exportDownload.js";
import {
  analyzeMaterialsQuality,
  QUALITY_CHECK_SECTIONS,
  qualityReportRows,
  qualitySummaryRows,
} from "../../../shared/materialQualityCheck.js";

export function MaterialsQualityPanel({ materials, modules, onEditMaterial, onPatchMaterial }) {
  const [openSection, setOpenSection] = useState(null);

  const activeModuleNames = useMemo(
    () => (modules || []).filter((m) => m.active !== false).map((m) => m.name),
    [modules]
  );

  const report = useMemo(
    () => analyzeMaterialsQuality(materials, { activeModuleNames }),
    [materials, activeModuleNames]
  );

  const issueTotal = report.summary.reduce((s, x) => s + x.count, 0);

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
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <span className="muted">
          {report.totalMaterials} активных позиций · {issueTotal} замечаний
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

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {report.summary.map((s) => (
          <button
            key={s.id}
            type="button"
            className="card stat"
            style={{
              textAlign: "left",
              cursor: "pointer",
              border: openSection === s.id ? "2px solid var(--brand)" : undefined,
            }}
            onClick={() => setOpenSection(openSection === s.id ? null : s.id)}
          >
            <div className="k">{s.label}</div>
            <div
              className="v num"
              style={{
                color: s.count
                  ? QUALITY_CHECK_SECTIONS.find((x) => x.id === s.id)?.warning
                    ? "var(--warn)"
                    : "var(--danger)"
                  : "var(--ok)",
              }}
            >
              {s.count}
            </div>
          </button>
        ))}
      </div>

      {issueTotal === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 18 }}>Замечаний нет — база выглядит аккуратно.</p>
        </div>
      ) : (
        QUALITY_CHECK_SECTIONS.map(({ id, label }) => {
          const items = report.sections[id];
          if (!items.length) return null;
          if (openSection && openSection !== id) return null;
          return (
            <section key={id} className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
              <header
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15 }}>{label}</h3>
                <span className="chip chip-danger">{items.length}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: "auto" }}
                  onClick={() => setOpenSection(openSection === id ? null : id)}
                >
                  {openSection === id ? "Свернуть" : "Развернуть"}
                </button>
              </header>
              {(openSection === null || openSection === id) && (
                <div style={{ overflowX: "auto" }}>
                  <table className="spec" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Наименование</th>
                        <th>Ед.</th>
                        <th>Категория</th>
                        <th>Раздел клиента</th>
                        <th>Подраздел</th>
                        <th>Модули</th>
                        {id === "duplicateCandidates" && <th>Дублей</th>}
                        {id === "archivedModules" && <th>Архивные</th>}
                        <th style={{ width: 200 }}>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((m) => (
                        <tr key={`${id}-${m.id}`}>
                          <td>{m.name}</td>
                          <td>{m.unit}</td>
                          <td>{m.category}</td>
                          <td>{m.clientSectionLabel || m.clientSection || "—"}</td>
                          <td>{m.clientSubsection || "—"}</td>
                          <td className="muted" style={{ fontSize: 12, maxWidth: 200 }}>
                            {m.modules}
                          </td>
                          {id === "duplicateCandidates" && <td>{m.duplicateCount}</td>}
                          {id === "archivedModules" && (
                            <td className="muted" style={{ fontSize: 12 }}>
                              {m.archivedModules}
                            </td>
                          )}
                          <td>
                            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEditMaterial?.(m.id)}>
                                Исправить
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => onPatchMaterial?.(m.id, { active: false, status: "archived" })}
                              >
                                Скрыть
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() =>
                                  onPatchMaterial?.(m.id, {
                                    category: "Требует разбора",
                                    clientSection: "requires_review",
                                  })
                                }
                              >
                                На проверку
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Проверка не изменяет базу. Дубли с разными поставщиками или ссылками могут быть отдельными закупочными
        позициями — объединяйте вручную через «Дубликаты», только если это одна и та же позиция.
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
