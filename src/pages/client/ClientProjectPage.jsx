import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, mergedPurchaseList, money } from "../../store/helpers.js";
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
import { isBoughtStatus } from "../../components/client/ClientItemCard.jsx";
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

function heroGradient(branding) {
  const brand = branding.brandColor || "#116355";
  return `linear-gradient(135deg, ${brand} 0%, ${brand}cc 50%, ${brand}99 100%)`;
}

export default function ClientProjectPage() {
  const { token } = useParams();
  const { state, actions } = useStore();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [purchaseMode, setPurchaseMode] = useState("categories");
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
      .then(setData)
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

  const openPurchase = (mode = "categories") => {
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
    setData(fresh);
  };

  const exportPdf = () =>
    generateClientPurchasePdf({
      project,
      items: visibleItems,
      branding,
      purchaseStatuses,
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      mode: "client",
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

      <header className="client-hero no-print" style={{ background: heroGradient(branding) }}>
        <div className="client-hero__eyebrow">{heroEyebrow(branding)}</div>
        <h1 className="client-hero__title">{project.name}</h1>
        <p className="client-hero__sub">
          {project.client}
          {project.city ? ` · ${project.city}` : ""}
          {project.version > 1 ? ` · версия ${project.version}` : ""}
        </p>
        {trustLines.length > 0 && (
          <div className="client-trust">
            {trustLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        )}
      </header>

      <BudgetBar
        project={project}
        branding={branding}
        totals={totals}
        versionInfo={versionInfo}
        delta={delta}
        onExport={exportExcel}
        onPdf={exportPdf}
        onMerged={() => setTab("merged")}
      />

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
          onExportAll={exportExcel}
          onExportMerged={exportExcel}
          onPdf={exportPdf}
          onPdfPlumber={() =>
            generateClientPurchasePdf({
              project,
              items: visibleItems,
              branding,
              purchaseStatuses,
              pageUrl: typeof window !== "undefined" ? window.location.href : "",
              mode: "plumber",
            })
          }
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
              onOpenPurchase={() => openPurchase("categories")}
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
                <span className="muted">Объединённые позиции: имя + ед. + поставщик + ссылка</span>
                <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={exportExcel}>
                  Excel ↓
                </button>
              </div>
              <ClientMergedList project={project} items={filterAndSortPurchase(purchaseItems)} />
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

function BudgetBar({ project, branding, totals, versionInfo, delta, onExport, onPdf, onMerged }) {
  const company = branding?.companyName || "Daogreen";
  return (
    <div className="budget-bar" style={{ background: `linear-gradient(135deg, ${branding?.brandColor || "#062920"}, #083028)` }}>
      <div className="eyebrow" style={{ color: "#9ecdb8" }}>
        {company} · закупочный список
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{project.name}</div>
      <div style={{ fontSize: 12.5, color: "#9ecdb8" }}>
        {project.client}
        {project.city ? " · " + project.city : ""}
        {project.version > 1 ? ` · v${project.version}` : ""}
      </div>
      {versionInfo && delta != null && delta !== 0 && (
        <div className="version-banner">
          Обновлено v{versionInfo.versionNumber}: Δ {delta > 0 ? "+" : ""}
          {money(delta, project.currency)}
        </div>
      )}
      <div className="nums client-stat-grid--4" style={{ marginTop: 12 }}>
        <div>
          <div className="k">Всего</div>
          <div className="v num">{money(totals.budget, project.currency)}</div>
        </div>
        <div>
          <div className="k">Куплено</div>
          <div className="v num">{money(totals.spent, project.currency)}</div>
        </div>
        <div>
          <div className="k">Осталось</div>
          <div className="v num">{money(totals.remaining, project.currency)}</div>
        </div>
        <div>
          <div className="k">Готовность</div>
          <div className="v num">{totals.progress}%</div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <Progress value={totals.progress} />
      </div>
      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={onExport}>
          Скачать Excel
        </button>
        {onPdf && (
          <button type="button" className="btn btn-sm" onClick={onPdf}>
            Скачать PDF
          </button>
        )}
        {onMerged && (
          <button type="button" className="btn btn-sm" onClick={onMerged}>
            Общий список
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={printPDF}>
          Печать
        </button>
      </div>
    </div>
  );
}

function DocsTab({ documents, qrUrl, onExportAll, onExportMerged, onPdf, onPdfPlumber }) {
  return (
    <div className="card" style={{ padding: 22, marginTop: 16 }}>
      <h3>Документы</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        Книга закупки в Excel (несколько листов), PDF по разделам, списки для специалистов.
      </p>
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <button type="button" className="btn" onClick={onExportAll}>
          Excel — книга закупки
        </button>
        <button type="button" className="btn" onClick={onExportMerged}>
          Excel — повтор
        </button>
        {onPdf && (
          <button type="button" className="btn" onClick={onPdf}>
            PDF — полный
          </button>
        )}
        {onPdfPlumber && (
          <button type="button" className="btn" onClick={onPdfPlumber}>
            PDF — сантехник
          </button>
        )}
        <button type="button" className="btn" onClick={printPDF}>
          Печать
        </button>
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
