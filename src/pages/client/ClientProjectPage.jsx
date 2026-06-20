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
import { downloadCSV, printPDF } from "../../lib/export.js";

const TABS = [
  ["overview", "Обзор"],
  ["categories", "По категориям"],
  ["modules", "По стеллажам"],
  ["merged", "Общий список"],
  ["plumber", "Сантехник"],
  ["electric", "Электрик"],
  ["installer", "Монтажник"],
  ["consumables", "Расходники"],
  ["docs", "Документы"],
];

export default function ClientProjectPage() {
  const { token } = useParams();
  const { actions } = useStore();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("categories");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    actions.loadClientProject(token).then(setData).catch((e) => setErr(e.message));
  }, [token, actions]);

  if (err)
    return (
      <div className="client-wrap" style={{ paddingTop: 60 }}>
        <Empty title="Проект не найден" hint="Проверь ссылку." />
      </div>
    );

  if (!data)
    return (
      <div className="client-wrap" style={{ paddingTop: 60 }}>
        <div className="muted">Загрузка…</div>
      </div>
    );

  const project = data.project;
  const versionInfo = data.versionInfo;
  const visibleItems = clientVisibleItems(project);
  const totals = projectTotals(project);
  const suppliers = [...new Set(visibleItems.map((i) => i.supplier).filter(Boolean))].sort();

  const filterSupplier = (list) =>
    supplierFilter ? list.filter((i) => i.supplier === supplierFilter) : list;

  const patch = async (itemId, p) => {
    const updated = await actions.clientPatchItem(token, itemId, p);
    setData((d) => ({
      ...d,
      project: {
        ...d.project,
        items: d.project.items.map((it) => (it.id === itemId ? { ...it, ...updated } : it)),
      },
    }));
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
    <div className="client-wrap">
      <BudgetBar project={project} totals={totals} versionInfo={versionInfo} delta={delta} onExport={() => exportRows(visibleItems, "закупка")} />

      <div className="client-tabs no-print">
        {TABS.map(([k, label]) => (
          <button key={k} className={"btn btn-sm" + (tab === k ? " btn-primary" : "")} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab !== "docs" && tab !== "overview" && (
        <div className="toolbar no-print">
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} style={{ width: "auto" }}>
            <option value="">Все поставщики</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {visibleItems.length === 0 ? (
        <Empty title="Спецификация готовится" hint="Позиции появятся после утверждения." />
      ) : (
        <>
          {tab === "overview" && <OverviewTab project={project} totals={totals} items={visibleItems} />}
          {tab === "categories" && (
            <PurchaseSplitView
              items={filterSupplier(visibleItems)}
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
              items={filterSupplier(visibleItems)}
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
              items={filterSupplier(visibleItems)}
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
          {tab === "docs" && (
            <DocsTab
              project={project}
              visibleItems={visibleItems}
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
            />
          )}
        </>
      )}
    </div>
  );
}

function BudgetBar({ project, totals, versionInfo, delta, onExport }) {
  return (
    <div className="budget-bar">
      <div className="eyebrow" style={{ color: "#9ecdb8" }}>
        Daogreen · список закупки
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
        <button className="btn btn-sm" onClick={printPDF}>
          PDF
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

function OverviewTab({ project, totals, items }) {
  const byCat = groupBy(items, "category");
  return (
    <div style={{ marginTop: 16 }}>
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
      </div>
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

function DocsTab({ onExportAll, onExportMerged }) {
  return (
    <div className="card" style={{ padding: 22, marginTop: 16 }}>
      <h3>Документы</h3>
      <p className="muted" style={{ fontSize: 13 }}>Скачай списки для закупки и передачи подрядчикам.</p>
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onExportAll}>
          Excel — полный список
        </button>
        <button className="btn" onClick={onExportMerged}>
          Excel — объединённый
        </button>
        <button className="btn" onClick={printPDF}>
          PDF / печать
        </button>
      </div>
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
        <img src={img} alt={it.name} className="thumb-img" />
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
        {it.clientNote && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{it.clientNote}</div>}
        {it.techNote && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2, fontStyle: "italic" }}>
            {it.techNote}
          </div>
        )}
        {it.link && (
          <a href={it.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, display: "inline-block", marginTop: 4 }}>
            Ссылка на товар ↗
          </a>
        )}

        {!bought ? (
          <div className="row no-print wrap" style={{ marginTop: 12, gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={markBought}>
              ✓ Куплено
            </button>
            {it.status !== "need_help" && (
              <button type="button" className="btn btn-sm" onClick={() => patch(it.id, { status: "need_help" })}>
                Нужна помощь
              </button>
            )}
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
            <input value={it.clientComment} onChange={(e) => patch(it.id, { clientComment: e.target.value })} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
