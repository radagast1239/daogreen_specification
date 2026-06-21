import React, { useMemo } from "react";
import { groupBy, mergedPurchaseList, money, num } from "../../store/helpers.js";
import { lineGross, itemsByResponsible, splitPurchaseItems } from "../../lib/itemHelpers.js";
import { groupByClientSection, clientSectionLabel } from "../../../shared/clientSections.js";
import {
  compositionGroupLabel,
  groupItemsByComposition,
  isStellageModuleTitle,
  STELLAGE_GROUPS,
} from "../../../shared/stellageComposition.js";
import { absolutePhotoUrl } from "../../lib/photoHelpers.js";
import { Empty } from "../ui.jsx";
import ClientItemCard, { isBoughtStatus } from "./ClientItemCard.jsx";
import { PURCHASE_MODES } from "../../lib/clientBrandConfig.js";

const PURCHASE_FILTERS = [
  { id: "all", label: "Все" },
  { id: "todo", label: "Купить сейчас" },
  { id: "ordered", label: "Заказано" },
  { id: "need_help", label: "Нужна помощь" },
  { id: "not_bought", label: "Не куплено" },
  { id: "bought", label: "Куплено" },
];

function applyPurchaseFilter(items, filterId) {
  if (filterId === "all") return items;
  if (filterId === "todo") return items.filter((i) => !isBoughtStatus(i.status) && i.status !== "ordered");
  if (filterId === "bought") return items.filter((i) => isBoughtStatus(i.status));
  return items.filter((i) => i.status === filterId);
}

function itemsForMode(items, mode) {
  if (mode === "plumber") return itemsByResponsible(items, "plumber");
  if (mode === "electric") return itemsByResponsible(items, "electrician");
  if (mode === "installer") return itemsByResponsible(items, "installer");
  if (mode === "consumables") return itemsByResponsible(items, "consumables");
  if (mode === "install") return items.filter((i) => i.itemRole === "installation" || i.category === "Работы и доставка");
  return items.filter((i) => i.itemRole !== "installation");
}

function ItemsByGroup({ groups, currency, patch, bought, purchaseStatuses, materials, modules, stellageGroups }) {
  return groups.map(([title, list]) => {
    const sum = list.reduce((s, i) => s + lineGross(i), 0);
    const stellageModule = isStellageModuleTitle(title, modules);
    const compositionGroups = stellageModule ? groupItemsByComposition(list, materials, stellageGroups) : null;
    return (
      <section key={title}>
        <div className="section-head">
          <div className="spine" />
          <h3>{title}</h3>
          <span className="count num" style={{ marginLeft: "auto" }}>
            {money(sum, currency)}
          </span>
        </div>
        {compositionGroups
          ? compositionGroups.map(([gId, gItems]) => (
              <React.Fragment key={gId}>
                {gId !== "other" && (
                  <div className="stellage-group-head stellage-group-head--block">
                    {compositionGroupLabel(gId, stellageGroups)}
                  </div>
                )}
                {gItems.map((it) => (
                  <ClientItemCard key={it.id} it={it} currency={currency} patch={patch} bought={bought} purchaseStatuses={purchaseStatuses} />
                ))}
              </React.Fragment>
            ))
          : list.map((it) => (
              <ClientItemCard key={it.id} it={it} currency={currency} patch={patch} bought={bought} purchaseStatuses={purchaseStatuses} />
            ))}
      </section>
    );
  });
}

export function ClientMergedList({ project, items }) {
  const rows = mergedPurchaseList({ ...project, items });
  return (
    <div style={{ marginTop: 8 }}>
      <p className="muted" style={{ fontSize: 13 }}>{rows.length} уникальных позиций</p>
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
              {r.supplier ? ` · ${r.supplier}` : ""} · <span className="num">{money(r.sumVat, project.currency)}</span>
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

export default function ClientPurchasePanel({
  project,
  items,
  mode,
  onModeChange,
  filter,
  onFilterChange,
  showBought,
  onShowBoughtChange,
  supplierFilter,
  purchaseQuery,
  purchaseSort,
  patch,
  purchaseStatuses,
  materials,
  modules,
  stellageGroups = STELLAGE_GROUPS,
}) {
  const scoped = useMemo(() => itemsForMode(items, mode), [items, mode]);
  const filtered = useMemo(() => {
    let out = scoped;
    if (supplierFilter) out = out.filter((i) => i.supplier === supplierFilter);
    const q = (purchaseQuery || "").trim().toLowerCase();
    if (q) {
      out = out.filter(
        (i) => (i.name || "").toLowerCase().includes(q) || (i.supplier || "").toLowerCase().includes(q)
      );
    }
    out = applyPurchaseFilter(out, filter);
    const sorted = [...out];
    sorted.sort((a, b) => {
      if (purchaseSort === "sum") return lineGross(b) - lineGross(a);
      if (purchaseSort === "status") {
        const la = purchaseStatuses.find((s) => s.id === a.status)?.label || "";
        const lb = purchaseStatuses.find((s) => s.id === b.status)?.label || "";
        return la.localeCompare(lb, "ru");
      }
      if (purchaseSort === "category") {
        const c = clientSectionLabel(a).localeCompare(clientSectionLabel(b), "ru");
        if (c !== 0) return c;
      }
      return (a.name || "").localeCompare(b.name || "", "ru");
    });
    return sorted;
  }, [scoped, supplierFilter, purchaseQuery, filter, purchaseSort, purchaseStatuses]);

  const { todo, bought } = splitPurchaseItems(filtered);
  const boughtCount = scoped.filter((i) => isBoughtStatus(i.status)).length;

  const renderList = (list, isBought) => {
    if (mode === "modules") {
      return (
        <ItemsByGroup
          groups={groupBy(list, "module")}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
          materials={materials}
          modules={modules}
          stellageGroups={stellageGroups}
        />
      );
    }
    if (mode === "suppliers") {
      return (
        <ItemsByGroup
          groups={groupBy(list, "supplier")}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
          materials={materials}
          modules={modules}
          stellageGroups={stellageGroups}
        />
      );
    }
    return (
      <ItemsByGroup
        groups={groupByClientSection(list)}
        currency={project.currency}
        patch={patch}
        bought={isBought}
        purchaseStatuses={purchaseStatuses}
        materials={materials}
        modules={modules}
        stellageGroups={stellageGroups}
      />
    );
  };

  if (!todo.length && !bought.length) {
    return <Empty title="Нет позиций по фильтру" />;
  }

  return (
    <div className="client-purchase-panel">
      <div className="client-purchase-modes no-print">
        {PURCHASE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={"btn btn-sm" + (mode === m.id ? " btn-primary" : "")}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="client-purchase-filters no-print">
        {PURCHASE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={"btn btn-sm" + (filter === f.id ? " btn-primary" : "")}
            onClick={() => onFilterChange(f.id)}
          >
            {f.label}
          </button>
        ))}
        <label className="row" style={{ marginLeft: "auto", fontSize: 13, gap: 6 }}>
          <input type="checkbox" checked={showBought} onChange={(e) => onShowBoughtChange(e.target.checked)} />
          Показывать купленные ({boughtCount})
        </label>
      </div>
      {todo.length > 0 ? (
        <>
          <h3 className="purchase-section-title">К закупке · {todo.length}</h3>
          {renderList(todo, false)}
        </>
      ) : (
        <p className="muted" style={{ fontSize: 14, margin: "16px 0" }}>Всё из фильтра уже куплено.</p>
      )}
      {showBought && bought.length > 0 && (
        <div className="purchase-bought-block">
          <h3 className="purchase-section-title purchase-section-title--done">Куплено · {bought.length}</h3>
          {renderList(bought, true)}
        </div>
      )}
    </div>
  );
}
