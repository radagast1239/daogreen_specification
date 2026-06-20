import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { projectTotals, groupBy, mergedPurchaseList, money, num } from "../../store/helpers.js";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import {
  clientVisibleItems,
  itemImageUrl,
  itemsByResponsible,
  lineGross,
  lineVat,
  splitPurchaseItems,
} from "../../lib/itemHelpers.js";
import { absolutePhotoUrl } from "../../lib/photoHelpers.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { Progress, StatusChip, Empty } from "../../components/ui.jsx";
import PageSkeleton from "../../components/PageSkeleton.jsx";
import PhotoGallery from "../../components/PhotoGallery.jsx";
import ActivityFeed from "../../components/ActivityFeed.jsx";
import CoolingFarmTab from "../../components/CoolingFarmTab.jsx";
import { setClientScope } from "../../components/ClientGuard.jsx";
import { generateProjectPdf } from "../../lib/pdfExport.js";
import QRCode from "qrcode";
import { downloadCSV, printPDF } from "../../lib/export.js";

const TABS = [
  ["overview", "Обзор"],
  ["cooling", "Охлаждение"],
  ["categories", "По категориям"],
  ["modules", "По стеллажам"],
  ["merged", "Общий список"],
  ["install", "Монтаж"],
  ["plumber", "Сантехник"],
  ["electric", "Электрик"],
  ["installer", "Монтажник"],
  ["consumables", "Расходники"],
  ["docs", "Документы"],
];

const QUICK_STATUSES = PURCHASE_STATUSES.filter((s) =>
  ["not_bought", "searching", "ordered", "bought", "delivered", "have", "need_help", "not_fit", "replacement_check"].includes(
    s.id
  )
);

export default function ClientProjectPage() {
  const { token } = useParams();
  const { actions } = useStore();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [supplierFilter, setSupplierFilter] = useState("");
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

  const brandStyle = {
    "--client-brand": branding.brandColor || "#116355",
  };

  const filterSupplier = (list) =>
    supplierFilter ? list.filter((i) => i.supplier === supplierFilter) : list;

  const installItems = visibleItems.filter((i) => i.itemRole === "installation" || i.category === "Работы и доставка");
  const purchaseItems = visibleItems.filter((i) => i.itemRole !== "installation");
  const hasCooling = !!(project.manualParams?.coolingFarm && typeof project.manualParams.coolingFarm === "object");
  const hasPurchase = visibleItems.length > 0;
  const clientTabs = TABS.filter(([k]) => k !== "cooling" || hasCooling);

  const patchCoolingFactor = async (safetyFactor) => {
    const res = await actions.clientPatchCooling(token, safetyFactor);
    const fresh = await actions.loadClientProject(decodeURIComponent(token || ""));
    setData(fresh);
  };

  const patch = async (itemId, p) => {
    await actions.clientPatchItem(token, itemId, p);
    const fresh = await actions.loadClientProject(decodeURIComponent(token || ""));
    setData(fresh);
  };

  const exportRows = (items, name) =>
    downloadCSV(
      `${project.name}_${name}`,
      items.map((i) => ({
        Фото: absolutePhotoUrl(i.imageUrl || i.photoUrl),
        Категория: i.category,
        Модуль: i.module,
        Наименование: i.name,
        Поставщик: i.supplier,
        Ед: i.unit,
        Кол: i.qty,
        Цена: i.price,
        НДС: i.vatRate || 0,
        Сумма: Math.round(lineGross(i)),
        Ссылка: i.link,
        Статус: PURCHASE_STATUSES.find((s) => s.id === i.status)?.label,
      }))
    );

  const delta = versionInfo?.summary?.delta;

  return (
    <div className="client-page" style={brandStyle}>
      <div className="print-header">
        <h1>{project.name}</h1>
        <p>
          {branding.companyName || "Daogreen"} · {project.client}
          {project.city ? ` · ${project.city}` : ""} · спецификация закупки
        </p>
      </div>

      <header className="client-hero no-print">
        <div className="client-hero__eyebrow">{branding.companyName || "Daogreen"} · вертикальные фермы</div>
        <h1 className="client-hero__title">{project.name}</h1>
        <p className="client-hero__sub">
          {project.client}
          {project.city ? ` · ${project.city}` : ""}
          {project.version > 1 ? ` · версия ${project.version}` : ""}
        </p>
        <div className="client-trust">
          <span>Фото, цены и статусы закупки</span>
          <span>Отметки «куплено» сохраняются автоматически</span>
        </div>
      </header>

      <BudgetBar
        project={project}
        branding={branding}
        totals={totals}
        versionInfo={versionInfo}
        delta={delta}
        onExport={() => exportRows(visibleItems, "закупка")}
        onPdf={() => generateProjectPdf({ project, items: visibleItems, branding })}
      />

      <div className="client-wrap">
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
          <button key={k} className={"btn btn-sm" + (tab === k ? " btn-primary" : "")} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab !== "docs" && tab !== "cooling" && hasPurchase && (
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
        </div>
      )}

      {tab === "cooling" && hasCooling && (
        <CoolingFarmTab
          key={`cool-${project.manualParams?.coolingFarm?.safetyFactor ?? "d"}`}
          variant="client"
          project={project}
          onSafetyFactorChange={patchCoolingFactor}
        />
      )}

      {tab === "docs" && (
        <DocsTab
          project={project}
          documents={documents}
          qrUrl={qrUrl}
          visibleItems={visibleItems}
          branding={branding}
          onExportAll={() => exportRows(visibleItems, "закупка")}
          onExportMerged={() => {
            const rows = mergedPurchaseList(project);
            downloadCSV(
              `${project.name}_объединённый`,
              rows.map((r) => ({
                Наименование: r.name,
                Поставщик: r.supplier,
                Кол: r.qty,
                Сумма: Math.round(r.sumVat),
              }))
            );
          }}
          onPdf={() => generateProjectPdf({ project, items: visibleItems, branding })}
        />
      )}

      {!hasPurchase && tab !== "cooling" && tab !== "docs" ? (
        <Empty title="Спецификация готовится" hint="Позиции появятся после утверждения. Расчёт охлаждения — во вкладке «Охлаждение»." />
      ) : tab !== "cooling" && tab !== "docs" ? (
        <>
          {tab === "overview" && (
            <OverviewTab
              project={project}
              totals={totals}
              items={filterSupplier(purchaseItems)}
              supplierFilter={supplierFilter}
              qrUrl={qrUrl}
              branding={branding}
              activity={activity}
            />
          )}
          {tab === "install" && (
            <PurchaseSplitView
              items={filterSupplier(installItems)}
              currency={project.currency}
              patch={patch}
              render={(todo) => <ItemsFlat items={todo} currency={project.currency} patch={patch} />}
              renderBought={(bought) => <ItemsFlat items={bought} currency={project.currency} patch={patch} bought />}
            />
          )}
          {tab === "categories" && (
            <PurchaseSplitView
              items={filterSupplier(purchaseItems)}
              currency={project.currency}
              patch={patch}
              render={(todo) => (
                <ItemsByGroup groups={groupBy(todo, "category")} currency={project.currency} patch={patch} />
              )}
              renderBought={(bought) => (
                <ItemsByGroup groups={groupBy(bought, "category")} currency={project.currency} patch={patch} bought />
              )}
            />
          )}
          {tab === "modules" && (
            <PurchaseSplitView
              items={filterSupplier(purchaseItems)}
              currency={project.currency}
              patch={patch}
              render={(todo) => (
                <ItemsByGroup groups={groupBy(todo, "module")} currency={project.currency} patch={patch} />
              )}
              renderBought={(bought) => (
                <ItemsByGroup groups={groupBy(bought, "module")} currency={project.currency} patch={patch} bought />
              )}
            />
          )}
          {tab === "merged" && (
            <PurchaseSplitView
              items={filterSupplier(purchaseItems)}
              currency={project.currency}
              patch={patch}
              render={(todo) => (
                <MergedClientTab project={project} items={todo} onExport={() => exportRows(visibleItems, "общий")} />
              )}
              renderBought={(bought) => (
                <ItemsFlat items={bought} currency={project.currency} patch={patch} bought />
              )}
            />
          )}
          {tab === "plumber" && (
            <PurchaseSplitView
              items={filterSupplier(itemsByResponsible(visibleItems, "plumber"))}
              currency={project.currency}
              patch={patch}
              render={(todo) => <ItemsFlat items={todo} currency={project.currency} patch={patch} />}
              renderBought={(bought) => <ItemsFlat items={bought} currency={project.currency} patch={patch} bought />}
            />
          )}
          {tab === "electric" && (
            <PurchaseSplitView
              items={filterSupplier(itemsByResponsible(visibleItems, "electrician"))}
              currency={project.currency}
              patch={patch}
              render={(todo) => <ItemsFlat items={todo} currency={project.currency} patch={patch} />}
              renderBought={(bought) => <ItemsFlat items={bought} currency={project.currency} patch={patch} bought />}
            />
          )}
          {tab === "installer" && (
            <PurchaseSplitView
              items={filterSupplier(itemsByResponsible(visibleItems, "installer"))}
              currency={project.currency}
              patch={patch}
              render={(todo) => <ItemsFlat items={todo} currency={project.currency} patch={patch} />}
              renderBought={(bought) => <ItemsFlat items={bought} currency={project.currency} patch={patch} bought />}
            />
          )}
          {tab === "consumables" && (
            <PurchaseSplitView
              items={filterSupplier(itemsByResponsible(visibleItems, "consumables"))}
              currency={project.currency}
              patch={patch}
              render={(todo) => <ItemsFlat items={todo} currency={project.currency} patch={patch} />}
              renderBought={(bought) => <ItemsFlat items={bought} currency={project.currency} patch={patch} bought />}
            />
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

function BudgetBar({ project, branding, totals, versionInfo, delta, onExport, onPdf }) {
  const company = branding?.companyName || "Daogreen";
  return (
    <div className="budget-bar" style={{ background: `linear-gradient(135deg, ${branding?.brandColor || "#062920"}, #083028)` }}>
      <div className="eyebrow" style={{ color: "#9ecdb8" }}>
        {company} · список закупки
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
      <div style={{ marginTop: 12 }}>
        <Progress value={totals.progress} />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        Закуплено {totals.progress}% · потрачено {money(totals.spent, project.currency)} из {money(totals.budget, project.currency)} · осталось {money(totals.remaining, project.currency)}
      </p>
      <div className="nums" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div>
          <div className="k">Итого</div>
          <div className="v num">{money(totals.budget, project.currency)}</div>
        </div>
        <div>
          <div className="k">Потрачено</div>
          <div className="v num">{money(totals.spent, project.currency)}</div>
        </div>
        <div>
          <div className="k">Осталось</div>
          <div className="v num">{money(totals.remaining, project.currency)}</div>
        </div>
      </div>
      {(totals.overrun > 0 || totals.economy > 0) && (
        <div className="row" style={{ marginTop: 10, gap: 12, fontSize: 12.5 }}>
          {totals.overrun > 0 && <span style={{ color: "#f5a623" }}>Перерасход: {money(totals.overrun, project.currency)}</span>}
          {totals.economy > 0 && <span style={{ color: "#9ecdb8" }}>Экономия: {money(totals.economy, project.currency)}</span>}
        </div>
      )}
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn btn-sm" onClick={onExport}>
          Excel ↓
        </button>
        {onPdf && (
          <button className="btn btn-sm" onClick={onPdf}>
            PDF ↓
          </button>
        )}
        <button className="btn btn-sm" onClick={printPDF}>
          Печать
        </button>
      </div>
    </div>
  );
}

function PurchaseSplitView({ items, render, renderBought }) {
  const { todo, bought } = splitPurchaseItems(items);
  if (!todo.length && !bought.length) {
    return <Empty title="Нет позиций в этом списке" />;
  }
  return (
    <div style={{ marginTop: 8 }}>
      {todo.length > 0 ? (
        <>
          <h3 className="purchase-section-title">К закупке · {todo.length}</h3>
          {render(todo)}
        </>
      ) : (
        <p className="muted" style={{ fontSize: 14, margin: "16px 0" }}>Всё из этого списка уже куплено.</p>
      )}
      {bought.length > 0 && (
        <div className="purchase-bought-block">
          <h3 className="purchase-section-title purchase-section-title--done">Куплено · {bought.length}</h3>
          {renderBought(bought)}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ project, totals, items, supplierFilter, qrUrl, branding, activity }) {
  const byCat = groupBy(items, "category");
  return (
    <div style={{ marginTop: 16 }}>
      {supplierFilter && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Фильтр: только поставщик «{supplierFilter}»
        </p>
      )}
      <div className="stat-grid">
        <div className="card stat">
          <div className="k">Позиций</div>
          <div className="v num">{totals.total}</div>
        </div>
        <div className="card stat">
          <div className="k">Закуплено</div>
          <div className="v num">{totals.progress}%</div>
        </div>
        <div className="card stat">
          <div className="k">Потрачено</div>
          <div className="v num">{money(totals.spent, project.currency)}</div>
        </div>
        <div className="card stat">
          <div className="k">Осталось</div>
          <div className="v num">{money(totals.remaining, project.currency)}</div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <ActivityFeed activity={activity} title="Что менялось (вы и Daogreen)" />
      </div>

      {qrUrl && (
        <div className="card" style={{ padding: 16, marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <img src={qrUrl} alt="QR ссылка проекта" width={120} height={120} />
          <div>
            <strong>QR-код проекта</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              Отсканируйте, чтобы открыть список закупки на телефоне.
            </p>
          </div>
        </div>
      )}
      <h3 style={{ marginTop: 20 }}>По категориям</h3>
      {byCat.map(([cat, list]) => {
        const sum = list.reduce((s, i) => s + lineGross(i), 0);
        const done = list.filter((i) => ["bought", "delivered", "have"].includes(i.status)).length;
        return (
          <div key={cat} className="between panel" style={{ padding: 12, marginBottom: 8 }}>
            <span>{cat}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {done}/{list.length} · <span className="num">{money(sum, project.currency)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ItemsByGroup({ groups, currency, patch, bought = false }) {
  return (
    <>
      {groups.map(([title, items]) => {
        const sum = items.reduce((s, i) => s + lineGross(i), 0);
        return (
          <section key={title}>
            <div className="section-head">
              <div className="spine" />
              <h3>{title}</h3>
              <span className="count num" style={{ marginLeft: "auto" }}>
                {money(sum, currency)}
              </span>
            </div>
            {items.map((it) => (
              <ItemCard key={it.id} it={it} currency={currency} patch={patch} bought={bought} />
            ))}
          </section>
        );
      })}
    </>
  );
}

function ItemsFlat({ items, currency, patch, bought = false }) {
  if (!items.length) return null;
  return items.map((it) => <ItemCard key={it.id} it={it} currency={currency} patch={patch} bought={bought} />);
}

function MergedClientTab({ project, items, onExport }) {
  const rows = mergedPurchaseList({ ...project, items });
  return (
    <div style={{ marginTop: 16 }}>
      <div className="toolbar">
        <span className="muted">{rows.length} уникальных позиций</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={onExport}>
          Excel ↓
        </button>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="card card-item">
          {r.imageUrl ? (
            <img src={absolutePhotoUrl(r.imageUrl)} alt="" className="thumb-img" />
          ) : (
            <div className="thumb" style={{ fontSize: 28 }}>{(r.name || "?").charAt(0)}</div>
          )}
          <div style={{ minWidth: 0 }}>
          <strong>{r.name}</strong>
          <div className="muted" style={{ fontSize: 12.5 }}>
            <span className="num">{num(r.qty)}</span> {r.unit}
            {r.supplier ? ` · ${r.supplier}` : ""} ·{" "}
            <span className="num">{money(r.sumVat, project.currency)}</span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {r.sources.map((s) => `${s.module} (${num(s.qty)})`).join(" · ")}
          </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocsTab({ documents, qrUrl, onExportAll, onExportMerged, onPdf }) {
  return (
    <div className="card" style={{ padding: 22, marginTop: 16 }}>
      <h3>Документы</h3>
      <p className="muted" style={{ fontSize: 13 }}>Скачай списки и приложенные файлы.</p>
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onExportAll}>
          Excel — полный список
        </button>
        <button className="btn" onClick={onExportMerged}>
          Excel — объединённый
        </button>
        {onPdf && (
          <button className="btn" onClick={onPdf}>
            PDF — таблица закупки
          </button>
        )}
        <button className="btn" onClick={printPDF}>
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

function ItemCard({ it, currency, patch, bought = false }) {
  const img = itemImageUrl(it);
  const gross = lineGross(it);
  const vat = lineVat(it);
  const markBought = () => patch(it.id, { status: "bought" });
  const markTodo = () => patch(it.id, { status: "not_bought" });

  return (
    <div className={"card card-item" + (bought ? " card-item--bought" : "")}>
      {img ? (
        <PhotoGallery src={img} alt={it.name} />
      ) : (
        <div className="thumb">{(it.name || "?").trim().charAt(0).toUpperCase()}</div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="between">
          <strong style={{ fontSize: 14 }}>{it.name}</strong>
          {bought ? (
            <span className="chip chip--ok chip-dot" style={{ fontSize: 11 }}>Куплено</span>
          ) : it.status === "need_help" ? (
            <StatusChip status={it.status} />
          ) : null}
        </div>
        {materialSpecLabel(it) && (
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--brand)" }}>{materialSpecLabel(it)}</div>
        )}
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          <span className="num">{num(it.qty)}</span> {it.unit} ·{" "}
          <span className="num">{money(it.price, currency)}</span>/ед
          {(it.vatRate || 0) > 0 && <span> · НДС {it.vatRate}%</span>}
          {" · "}
          <b className="num">{money(gross, currency)}</b>
          {vat > 0 && <span className="muted"> (в т.ч. НДС {money(vat, currency)})</span>}
        </div>
        {it.supplier && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>Поставщик:</b> {it.supplier}
          </div>
        )}
        {it.clientNote && (
          <div className="client-admin-note" style={{ fontSize: 12.5, marginTop: 6 }}>
            <b>Daogreen:</b> {it.clientNote}
          </div>
        )}
        {it.link && (
          <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, display: "inline-block", marginTop: 4 }}>
            Ссылка на товар ↗
          </a>
        )}

        {!bought ? (
          <div className="row no-print wrap" style={{ marginTop: 12, gap: 6 }}>
            {QUICK_STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={"btn btn-sm" + (it.status === s.id ? " btn-primary" : "")}
                onClick={() => patch(it.id, { status: s.id })}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost no-print" style={{ marginTop: 10 }} onClick={markTodo}>
            Вернуть в список
          </button>
        )}

        {!bought && (
        <div className="row no-print" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "0 0 150px" }}>
            <label>Факт. цена</label>
            <input
              type="number"
              value={it.actualPrice ?? ""}
              placeholder={String(it.price)}
              onChange={(e) => patch(it.id, { actualPrice: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Комментарий</label>
            <input value={it.clientComment || ""} onChange={(e) => patch(it.id, { clientComment: e.target.value })} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
