import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, money } from "../../store/helpers.js";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { clientVisibleItems, lineGross } from "../../lib/itemHelpers.js";
import { Progress, Empty } from "../../components/ui.jsx";
import PageSkeleton from "../../components/PageSkeleton.jsx";
import { setClientScope } from "../../components/ClientGuard.jsx";
import { generateClientPurchasePdf } from "../../lib/clientPdfExport.js";
import { clientTabDefs, heroEyebrow, legacyTabToPurchaseMode } from "../../lib/clientBrandConfig.js";
import QRCode from "qrcode";
import { printPDF } from "../../lib/export.js";
import { downloadClientWorkbook } from "../../lib/clientExcelExport.js";
import { ClientSchemesViewer } from "../../components/ClientSchemesEditor.jsx";
import ClientOverviewPanel from "../../components/client/ClientOverviewPanel.jsx";
import ClientPurchasePanel, { ClientMergedList } from "../../components/client/ClientPurchasePanel.jsx";
import { isBoughtStatus } from "../../lib/itemHelpers.js";
import { applyClientSectionsFromSettings } from "../../lib/clientSectionsConfig.js";
import { STELLAGE_GROUPS } from "../../../shared/stellageComposition.js";

function clientPageStyle(branding) {
  const brand = branding.brandColor || "#116355";
  const accent = branding.brandAccentColor || "#7fc9a8";
  const bg = branding.brandBgColor || "#f0f7f4";
  return {
    "--client-brand": brand,
    "--client-accent": accent,
    "--client-bg": bg,
    background: `radial-gradient(ellipse 100% 60% at 50% -10%, ${accent}2e, transparent 55%), linear-gradient(180deg, ${bg} 0%, ${bg}dd 100%)`,
  };
}

export default function ClientProjectPage() {
  const { token } = useParams();
  const { state, actions } = useStore();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [purchaseMode, setPurchaseMode] = useState("all");
  const [purchaseFilter, setPurchaseFilter] = useState("all");
  const [showBought, setShowBought] = useState(false);
  const purchaseStatuses = data?.purchaseStatuses || PURCHASE_STATUSES;
  const [supplierFilter, setSupplierFilter] = useState("");
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [purchaseSort, setPurchaseSort] = useState("category");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    if (token) setClientScope(decodeURIComponent(token));
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    QRCode.toDataURL(window.location.href, { width: 200, margin: 1 }).then(setQrUrl).catch(() => {});
  }, [token]);

  useEffect(() => {
    setLoading(true);
    setErr("");
    actions
      .loadClientProject(decodeURIComponent(token || ""))
      .then((fresh) => {
        applyClientSectionsFromSettings({ clientSectionsJson: fresh.branding?.clientSectionsJson });
        setData(fresh);
      })
      .catch((e) => {
        if (e.status === 410) setErr("expired");
        else setErr(e.message || "notfound");
      })
      .finally(() => setLoading(false));
  }, [token, actions]);

  if (loading && !data) {
    return (
      <div className="client-wrap" style={{ paddingTop: 40 }}>
        <PageSkeleton lines={2} />
      </div>
    );
  }

  if (err === "expired")
    return (
      <div className="client-wrap" style={{ paddingTop: 60 }}>
        <Empty title="Ссылка устарела" hint="Попросите Daogreen прислать новую ссылку на проект." />
      </div>
    );

  if (err)
    return (
      <div className="client-wrap" style={{ paddingTop: 60 }}>
        <Empty title="Проект не найден" hint="Проверьте ссылку — она должна начинаться с /spec/client/p/… (например http://62.233.35.206/spec/client/p/…)." />
      </div>
    );

  if (!data)
    return (
      <div className="client-wrap" style={{ paddingTop: 60 }}>
        <div className="muted">Загрузка…</div>
      </div>
    );

  const project = data.project;
  const branding = data.branding || {};
  const documents = data.documents || [];
  const activity = data.activity || [];
  const versionInfo = data.versionInfo;
  const visibleItems = clientVisibleItems(project);
  const totals = projectTotals(project);
  const suppliers = [...new Set(visibleItems.map((i) => i.supplier).filter(Boolean))].sort();
  const filteredCount = supplierFilter
    ? visibleItems.filter((i) => i.supplier === supplierFilter).length
    : visibleItems.length;

  const brandStyle = clientPageStyle(branding);

  const filterSupplier = (list) =>
    supplierFilter ? list.filter((i) => i.supplier === supplierFilter) : list;

  const filterAndSortPurchase = (list) => {
    let out = filterSupplier(list);
    const q = purchaseQuery.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (i) =>
          (i.name || "").toLowerCase().includes(q) ||
          (i.supplier || "").toLowerCase().includes(q)
      );
    }
    const sorted = [...out];
    sorted.sort((a, b) => {
      if (purchaseSort === "sum") return lineGross(b) - lineGross(a);
      if (purchaseSort === "status") {
        const la = purchaseStatuses.find((s) => s.id === a.status)?.label || "";
        const lb = purchaseStatuses.find((s) => s.id === b.status)?.label || "";
        return la.localeCompare(lb, "ru");
      }
      if (purchaseSort === "category") {
        const c = (a.category || "").localeCompare(b.category || "", "ru");
        if (c !== 0) return c;
      }
      return (a.name || "").localeCompare(b.name || "", "ru");
    });
    return sorted;
  };

  const purchaseItems = visibleItems.filter((i) => i.itemRole !== "installation");
  const hasPurchase = visibleItems.length > 0;
  const clientTabs = clientTabDefs(branding);
  const trustLines = (branding.clientTrustLines || []).filter(Boolean);
  const activeTab = clientTabs.some(([k]) => k === tab) ? tab : clientTabs[0]?.[0] || "overview";
  const stellageGroups = state.reference?.stellageGroups?.length ? state.reference.stellageGroups : STELLAGE_GROUPS;
  const delta = versionInfo?.summary?.delta;

  const openPurchase = (mode = "all") => {
    setPurchaseMode(mode);
    setTab("purchase");
  };

  const mapLegacyTab = (nextTab) => {
    const legacy = ["categories", "modules", "plumber", "electric", "installer", "consumables", "install", "cooling"];
    if (legacy.includes(nextTab)) {
      setPurchaseMode(legacyTabToPurchaseMode(nextTab));
      setTab("purchase");
      return;
    }
    setTab(nextTab);
  };

  const patch = async (itemId, p) => {
    await actions.clientPatchItem(token, itemId, p);
    const fresh = await actions.loadClientProject(decodeURIComponent(token || ""));
    applyClientSectionsFromSettings({ clientSectionsJson: fresh.branding?.clientSectionsJson });
    setData(fresh);
  };

  const exportPdf = (mode = "client_full") =>
    generateClientPurchasePdf({
      project,
      items: visibleItems,
      branding,
      purchaseStatuses,
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      mode,
    });

  const exportExcel = () =>
    downloadClientWorkbook(project, visibleItems, {
      purchaseStatuses,
      branding,
      versionInfo,
    });

  return (
    <div className="client-page" style={brandStyle}>
      <div className="print-header">
        <h1>{project.name}</h1>
        <p>
          {branding.companyName || "Daogreen"} · {project.client}
          {project.city ? ` · ${project.city}` : ""} · спецификация закупки
        </p>
      </div>

      <header className="client-topbar no-print" style={{ "--topbar-brand": branding.brandColor || "#116355" }}>
        <div className="client-topbar__row">
          <div className="client-topbar__brand">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="client-topbar__logo" />
            ) : (
              <div className="client-topbar__mark">{(branding.companyName || "D").charAt(0)}</div>
            )}
            <div className="client-topbar__titles">
              <div className="client-topbar__eyebrow">{heroEyebrow(branding)}</div>
              <h1 className="client-topbar__title">{project.name}</h1>
              <p className="client-topbar__sub">
                {project.client}
                {project.city ? ` · ${project.city}` : ""}
                {project.version > 1 ? ` · v${project.version}` : ""}
              </p>
            </div>
          </div>
          <div className="client-topbar__actions">
            <button type="button" className="btn btn-sm btn-ghost-light" onClick={exportExcel}>
              Excel
            </button>
            <button type="button" className="btn btn-sm btn-ghost-light" onClick={() => exportPdf("client_full")}>
              PDF
            </button>
            <button type="button" className="btn btn-sm btn-ghost-light" onClick={() => setTab("merged")}>
              Всё к покупке
            </button>
          </div>
        </div>
        {versionInfo && delta != null && delta !== 0 && (
          <div className="client-topbar__version">
            Обновлено v{versionInfo.versionNumber}: Δ {delta > 0 ? "+" : ""}
            {money(delta, project.currency)}
          </div>
        )}
        <div className="client-topbar__stats">
          <div className="client-topbar__stat">
            <span className="k">Всего</span>
            <span className="v num">{money(totals.budget, project.currency)}</span>
          </div>
          <div className="client-topbar__stat">
            <span className="k">Куплено</span>
            <span className="v num">{money(totals.spent, project.currency)}</span>
          </div>
          <div className="client-topbar__stat">
            <span className="k">Осталось</span>
            <span className="v num">{money(totals.remaining, project.currency)}</span>
          </div>
          <div className="client-topbar__stat">
            <span className="k">Готовность</span>
            <span className="v num">{totals.progress}%</span>
          </div>
        </div>
        <div className="client-topbar__progress">
          <Progress value={totals.progress} />
        </div>
        {trustLines.length > 0 && (
          <div className="client-topbar__trust">
            {trustLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        )}
      </header>

      <div className="client-wrap">
      <ClientSchemesViewer manualParams={project.manualParams} />
      {!hasPurchase && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: "var(--accent)" }}>
          <strong>Список закупки пока пуст</strong>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            Ссылка работает — администратор ещё не опубликовал позиции (нужны галочка, количество и утверждение в спецификации).
          </p>
        </div>
      )}
      <div className="client-tabs no-print">
        {clientTabs.map(([k, label]) => (
          <button key={k} className={"btn btn-sm" + (activeTab === k ? " btn-primary" : "")} onClick={() => mapLegacyTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {(activeTab === "purchase" || activeTab === "merged") && hasPurchase && (
        <>
          <div className="client-purchase-toolbar no-print">
            <input
              placeholder="Поиск: название или поставщик…"
              value={purchaseQuery}
              onChange={(e) => setPurchaseQuery(e.target.value)}
              style={{ flex: "1 1 180px", maxWidth: 280 }}
            />
            <select value={purchaseSort} onChange={(e) => setPurchaseSort(e.target.value)} style={{ width: "auto" }}>
              <option value="category">По разделу</option>
              <option value="sum">По сумме</option>
              <option value="status">По статусу</option>
              <option value="name">По названию</option>
            </select>
          </div>
          <div className="client-supplier-bar no-print">
            <strong style={{ fontSize: 13 }}>Поставщик:</strong>
            <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} style={{ width: "auto" }}>
              <option value="">Все поставщики ({visibleItems.length})</option>
              {suppliers.map((s) => {
                const cnt = visibleItems.filter((i) => i.supplier === s).length;
                return (
                  <option key={s} value={s}>
                    {s} ({cnt})
                  </option>
                );
              })}
            </select>
            {supplierFilter && (
              <span className="muted" style={{ fontSize: 13 }}>
                Показано {filteredCount} позиций от «{supplierFilter}»
              </span>
            )}
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              Куплено {purchaseItems.filter((i) => isBoughtStatus(i.status)).length} из {purchaseItems.length}
            </span>
          </div>
        </>
      )}

      {activeTab === "docs" && (
        <DocsTab
          project={project}
          documents={documents}
          qrUrl={qrUrl}
          onExportExcel={exportExcel}
          onPdfFull={() => exportPdf("client_full")}
          onPdfMerged={() => exportPdf("merged")}
          onPdfPlumber={() => exportPdf("plumber")}
          onPdfElectric={() => exportPdf("electric")}
          onPdfInstaller={() => exportPdf("installer")}
        />
      )}

      {!hasPurchase && activeTab !== "docs" ? (
        <Empty title="Спецификация готовится" hint="Позиции появятся после утверждения администратором." />
      ) : activeTab !== "docs" ? (
        <>
          {activeTab === "overview" && (
            <ClientOverviewPanel
              project={project}
              totals={totals}
              items={purchaseItems}
              branding={branding}
              activity={activity}
              qrUrl={qrUrl}
              onOpenPurchase={() => openPurchase("all")}
            />
          )}
          {activeTab === "purchase" && (
            <ClientPurchasePanel
              project={project}
              items={purchaseItems}
              mode={purchaseMode}
              onModeChange={setPurchaseMode}
              filter={purchaseFilter}
              onFilterChange={setPurchaseFilter}
              showBought={showBought}
              onShowBoughtChange={setShowBought}
              supplierFilter={supplierFilter}
              purchaseQuery={purchaseQuery}
              purchaseSort={purchaseSort}
              patch={patch}
              purchaseStatuses={purchaseStatuses}
              materials={state.materials}
              modules={state.modules}
              stellageGroups={stellageGroups}
            />
          )}
          {activeTab === "merged" && (
            <div style={{ marginTop: 8 }}>
              <div className="toolbar no-print" style={{ marginBottom: 10 }}>
                <span className="muted">Сводный список — одинаковые позиции объединены</span>
                <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={exportExcel}>
                  Excel ↓
                </button>
              </div>
              <ClientMergedList
                project={project}
                items={filterAndSortPurchase(purchaseItems)}
                patch={patch}
                purchaseStatuses={purchaseStatuses}
                groupBySection
              />
            </div>
          )}
        </>
      ) : null}
      </div>

      <ClientBrandFooter branding={branding} />
    </div>
  );
}

function ClientBrandFooter({ branding }) {
  const parts = [
    branding.contactPhone,
    branding.contactEmail,
    branding.contactTelegram,
  ].filter(Boolean);
  if (!parts.length && !branding.companyName) return null;
  return (
    <footer className="client-brand-footer no-print">
      <div style={{ fontWeight: 700, color: "var(--client-brand, var(--brand))" }}>
        {branding.companyName || "Daogreen"}
      </div>
      {parts.length > 0 && <div style={{ marginTop: 6 }}>{parts.join(" · ")}</div>}
    </footer>
  );
}

function DocsTab({ documents, qrUrl, onExportExcel, onPdfFull, onPdfMerged, onPdfPlumber, onPdfElectric, onPdfInstaller }) {
  return (
    <div className="card" style={{ padding: 22, marginTop: 16 }}>
      <h3>Документы</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Книга закупки в Excel (11 листов со склеенными строками) и PDF по разделам / для специалистов.
      </p>
      <div style={{ marginTop: 14 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6, fontWeight: 600 }}>Excel</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={onExportExcel}>
            Скачать книгу закупки
          </button>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6, fontWeight: 600 }}>PDF</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {onPdfFull && (
            <button type="button" className="btn" onClick={onPdfFull}>
              PDF — полный
            </button>
          )}
          {onPdfMerged && (
            <button type="button" className="btn" onClick={onPdfMerged}>
              PDF — всё к покупке
            </button>
          )}
          {onPdfPlumber && (
            <button type="button" className="btn" onClick={onPdfPlumber}>
              PDF — сантехник
            </button>
          )}
          {onPdfElectric && (
            <button type="button" className="btn" onClick={onPdfElectric}>
              PDF — электрик
            </button>
          )}
          {onPdfInstaller && (
            <button type="button" className="btn" onClick={onPdfInstaller}>
              PDF — монтажник
            </button>
          )}
          <button type="button" className="btn" onClick={printPDF}>
            Печать
          </button>
        </div>
      </div>
      {documents?.length > 0 && (
        <ul style={{ marginTop: 16, paddingLeft: 18 }}>
          {documents.map((d) => (
            <li key={d.id} style={{ marginBottom: 8 }}>
              <a href={d.url} target="_blank" rel="noreferrer">
                {d.filename}
              </a>
              <span className="muted" style={{ fontSize: 12 }}> · {d.type}</span>
            </li>
          ))}
        </ul>
      )}
      {qrUrl && (
        <div style={{ marginTop: 20 }}>
          <img src={qrUrl} alt="QR" width={140} />
        </div>
      )}
    </div>
  );
}
