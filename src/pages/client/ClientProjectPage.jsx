import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, money } from "../../store/helpers.js";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { clientVisibleItems, clientPurchaseItems } from "../../lib/itemHelpers.js";
import { Progress, Empty } from "../../components/ui.jsx";
import PageSkeleton from "../../components/PageSkeleton.jsx";
import { setClientScope } from "../../components/ClientGuard.jsx";
import { clientTabDefs, heroEyebrow, legacyTabToPurchaseMode } from "../../lib/clientBrandConfig.js";
import { printPDF } from "../../lib/exportDownload.js";
import { ClientSchemesViewer } from "../../components/ClientSchemesEditor.jsx";
import ClientOverviewPanel from "../../components/client/ClientOverviewPanel.jsx";
import ClientPurchasePanel from "../../components/client/ClientPurchasePanel.jsx";
import { isClosedPurchaseStatus } from "../../lib/itemHelpers.js";
import { applyClientSectionsFromSettings } from "../../lib/clientSectionsConfig.js";
import ClientPurchaseGuide from "../../components/client/ClientPurchaseGuide.jsx";
import ClientPurchaseViewToggles from "../../components/client/ClientPurchaseViewToggles.jsx";
import ClientReplacementModal from "../../components/client/ClientReplacementModal.jsx";
import {
  getClientCompactMode,
  getClientPurchaseLayout,
  setClientCompactMode,
  setClientPurchaseLayout,
} from "../../lib/clientPurchaseView.js";
import { mergedPurchaseRows } from "../../store/helpers.js";
import { STELLAGE_GROUPS } from "../../../shared/stellageComposition.js";
import { clientPurchaseDashboard } from "../../../shared/clientPurchaseStats.js";
import { api } from "../../lib/api.js";

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
  const [tab, setTab] = useState("purchase");
  const [purchaseMode, setPurchaseMode] = useState("categories");
  const [purchaseFilter, setPurchaseFilter] = useState("todo");
  const [showBought, setShowBought] = useState(false);
  const purchaseStatuses = data?.purchaseStatuses || PURCHASE_STATUSES;
  const [supplierFilter, setSupplierFilter] = useState("");
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [qrUrl, setQrUrl] = useState("");
  const [replacementItem, setReplacementItem] = useState(null);
  const [purchaseLayout, setPurchaseLayoutState] = useState(() => getClientPurchaseLayout());
  const [clientCompact, setClientCompactState] = useState(() => getClientCompactMode());

  useEffect(() => {
    if (token) setClientScope(decodeURIComponent(token));
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    import("qrcode").then(({ default: QRCode }) => {
      QRCode.toDataURL(window.location.href, { width: 200, margin: 1 }).then(setQrUrl).catch(() => {});
    });
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


  const purchaseItems = clientPurchaseItems({ items: visibleItems });
  const purchaseDash = clientPurchaseDashboard(purchaseItems);
  const hasPurchase = visibleItems.length > 0;
  const clientTabs = clientTabDefs(branding);
  const activeTab = clientTabs.some(([k]) => k === tab) ? tab : clientTabs[0]?.[0] || "overview";
  const stellageGroups = data.catalog?.stellageGroups?.length
    ? data.catalog.stellageGroups
    : state.reference?.stellageGroups?.length
      ? state.reference.stellageGroups
      : STELLAGE_GROUPS;
  const delta = versionInfo?.summary?.delta;

  const openPurchase = (mode = "categories") => {
    setPurchaseMode(mode === "all" ? "categories" : mode);
    setTab("purchase");
  };

  const mapLegacyTab = (nextTab) => {
    if (nextTab === "merged") {
      setPurchaseMode("categories");
      setTab("purchase");
      return;
    }
    const legacy = ["categories", "modules", "plumber", "electric", "installer", "consumables", "install", "cooling"];
    if (legacy.includes(nextTab)) {
      setPurchaseMode(legacyTabToPurchaseMode(nextTab));
      setTab("purchase");
      return;
    }
    setTab(nextTab);
  };

  const patch = async (itemId, p) => {
    setData((prev) => {
      if (!prev?.project?.items) return prev;
      const items = prev.project.items.map((it) => (it.id === itemId ? { ...it, ...p } : it));
      return { ...prev, project: { ...prev.project, items } };
    });
    try {
      const updated = await actions.clientPatchItem(token, itemId, p);
      if (updated?.id) {
        setData((prev) => {
          if (!prev?.project?.items) return prev;
          const items = prev.project.items.map((it) => (it.id === itemId ? { ...it, ...updated } : it));
          return { ...prev, project: { ...prev.project, items } };
        });
      }
    } catch {
      const fresh = await actions.loadClientProject(decodeURIComponent(token || ""));
      applyClientSectionsFromSettings({ clientSectionsJson: fresh.branding?.clientSectionsJson });
      setData(fresh);
    }
  };

  const patchBulk = async (itemIds, p) => {
    const idSet = new Set(itemIds);
    setData((prev) => {
      if (!prev?.project?.items) return prev;
      const items = prev.project.items.map((it) => (idSet.has(it.id) ? { ...it, ...p } : it));
      return { ...prev, project: { ...prev.project, items } };
    });
    try {
      const result = await api.bulkPatchClientItems(decodeURIComponent(token || ""), { itemIds, patch: p });
      const byId = new Map((result?.updated || []).map((it) => [it.id, it]));
      if (byId.size) {
        setData((prev) => {
          if (!prev?.project?.items) return prev;
          const items = prev.project.items.map((it) => (byId.has(it.id) ? { ...it, ...byId.get(it.id) } : it));
          return { ...prev, project: { ...prev.project, items } };
        });
      }
    } catch {
      const fresh = await actions.loadClientProject(decodeURIComponent(token || ""));
      applyClientSectionsFromSettings({ clientSectionsJson: fresh.branding?.clientSectionsJson });
      setData(fresh);
    }
  };

  const proposeReplacement = async (body) => {
    await api.proposeClientReplacement(decodeURIComponent(token || ""), replacementItem.id, body);
    const fresh = await actions.loadClientProject(decodeURIComponent(token || ""));
    applyClientSectionsFromSettings({ clientSectionsJson: fresh.branding?.clientSectionsJson });
    setData(fresh);
  };

  const exportPdf = async (mode = "client_full") => {
    const { generateClientPurchasePdf } = await import("../../lib/clientPdfExport.js");
    generateClientPurchasePdf({
      project,
      items: visibleItems,
      branding,
      purchaseStatuses,
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      mode,
    });
  };

  const exportExcel = async () => {
    const { downloadClientWorkbook } = await import("../../lib/clientExcelExport.js");
    downloadClientWorkbook(project, visibleItems, {
      purchaseStatuses,
      branding,
      versionInfo,
    });
  };

  return (
    <div
      className={`client-page${clientCompact ? " client-compact-tables" : ""}`}
      style={brandStyle}
    >
      <div className="print-header">
        <h1>{project.name}</h1>
        <p>
          {branding.companyName || "Daogreen"} · {project.client}
          {project.city ? ` · ${project.city}` : ""} · спецификация закупки
        </p>
      </div>

      <div className="client-wrap">
      <header className="client-topbar no-print" style={{ "--topbar-brand": branding.brandColor || "#116355" }}>
        <div className="client-topbar__row">
          <div className="client-topbar__brand">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="client-topbar__logo" />
            ) : (
              <div className="client-topbar__mark">{(branding.companyName || "D").charAt(0)}</div>
            )}
            <div className="client-topbar__titles">
              <div className="client-topbar__eyebrow">{branding.companyName || heroEyebrow(branding)}</div>
              <h1 className="client-topbar__title">{project.name}</h1>
              <p className="client-topbar__sub">
                {project.client}
                {project.city ? ` · ${project.city}` : ""}
                {project.version > 1 ? ` · v${project.version}` : ""}
              </p>
            </div>
          </div>
          <div className="client-topbar__actions">
            <button type="button" className="btn btn-sm" onClick={exportExcel}>
              Excel
            </button>
            <button type="button" className="btn btn-sm" onClick={() => exportPdf("client_full")}>
              PDF
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openPurchase("categories")}>
              К списку
            </button>
          </div>
        </div>
        <div className="client-topbar__foot">
          <div className="client-topbar__progress-mini">
            <Progress value={totals.progress} />
          </div>
          <div className="client-topbar__meta">
            <span className="num">{totals.progress}%</span>
            <span className="muted">
              · куплено {purchaseDash.boughtCount} из {purchaseDash.totalCount}
            </span>
            <span className="muted">· {money(totals.remaining, project.currency)} осталось</span>
            {versionInfo && delta != null && delta !== 0 && (
              <span className="client-topbar__delta">
                v{versionInfo.versionNumber}: {delta > 0 ? "+" : ""}
                {money(delta, project.currency)}
              </span>
            )}
          </div>
        </div>
      </header>

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

      {(activeTab === "purchase") && hasPurchase && (
        <>
          <ClientPurchaseGuide
            projectId={project.id}
            itemCount={purchaseItems.length}
            uniqueCount={mergedPurchaseRows(purchaseItems).length}
          />
          <div className="client-purchase-toolbar no-print">
            <input
              className="client-purchase-toolbar__search"
              placeholder="Поиск: название или поставщик…"
              value={purchaseQuery}
              onChange={(e) => setPurchaseQuery(e.target.value)}
            />
            <ClientPurchaseViewToggles
              layout={purchaseLayout}
              compact={clientCompact}
              onLayoutChange={(next) => {
                setClientPurchaseLayout(next);
                setPurchaseLayoutState(next);
              }}
              onCompactChange={(next) => {
                setClientCompactMode(next);
                setClientCompactState(next);
              }}
            />
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
              Куплено / заказано {purchaseItems.filter((i) => isClosedPurchaseStatus(i.status)).length} из {purchaseItems.length}
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
              patch={patch}
              patchBulk={patchBulk}
              purchaseStatuses={purchaseStatuses}
              materials={data.catalog?.materials || []}
              modules={data.catalog?.modules || []}
              stellageGroups={stellageGroups}
              onProposeReplacement={setReplacementItem}
              simple
              layout={purchaseLayout}
              compact={clientCompact}
            />
          )}
        </>
      ) : null}
      </div>

      <ClientBrandFooter branding={branding} />
      <ClientReplacementModal
        open={!!replacementItem}
        itemName={replacementItem?.name}
        onClose={() => setReplacementItem(null)}
        onSubmit={proposeReplacement}
      />
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
