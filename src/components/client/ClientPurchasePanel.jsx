import React, { useMemo } from "react";
import { groupBy, mergedPurchaseRows, money, num } from "../../store/helpers.js";
import {
  lineGross,
  itemsByResponsible,
  splitPurchaseItems,
  splitMergedPurchaseRows,
  applyMergedPurchaseFilter,
  mergeSourcesLabel,
} from "../../lib/itemHelpers.js";
import { groupByClientSection, clientSectionLabel, CLIENT_SECTIONS, resolveClientSection } from "../../../shared/clientSections.js";
import {
  compositionGroupLabel,
  groupItemsByComposition,
  isStellageModuleTitle,
  STELLAGE_GROUPS,
} from "../../../shared/stellageComposition.js";
import { Empty } from "../ui.jsx";
import ClientItemCard, { ClientMergedItemCard, isBoughtStatus } from "./ClientItemCard.jsx";
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

function groupMergedBySection(rows) {
  const map = new Map();
  for (const row of rows) {
    const rep = row.sourceItems?.[0];
    const { section, label } = resolveClientSection(rep || {});
    const key = section || "__misc__";
    const title = section ? label : "Уточнить категорию";
    if (!map.has(key)) map.set(key, { title, rows: [] });
    map.get(key).rows.push(row);
  }
  const order = [...CLIENT_SECTIONS.map((s) => s.id), "__misc__"];
  return [...map.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([, v]) => [v.title, v.rows]);
}

function ItemsByMergedGroup({ groups, currency, patch, bought, purchaseStatuses }) {
  return groups.map(([title, rows]) => {
    const sum = rows.reduce((s, r) => s + r.sumVat, 0);
    return (
      <section key={title}>
        <div className="section-head">
          <div className="spine" />
          <h3>{title}</h3>
          <span className="count num" style={{ marginLeft: "auto" }}>
            {money(sum, currency)}
          </span>
        </div>
        {rows.map((row) => (
          <ClientMergedItemCard
            key={row.mergeKey}
            row={row}
            currency={currency}
            patch={patch}
            bought={bought}
            purchaseStatuses={purchaseStatuses}
            sourcesLabel={
              row.sources?.length > 1
                ? mergeSourcesLabel(row.sources)
                : row.sources?.length === 1
                  ? `${row.sources[0].module} (${num(row.sources[0].qty)})`
                  : ""
            }
          />
        ))}
      </section>
    );
  });
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

export function ClientMergedList({ project, items, patch, purchaseStatuses }) {
  const rows = mergedPurchaseRows(items);
  return (
    <div style={{ marginTop: 8 }}>
      <p className="muted" style={{ fontSize: 13 }}>{rows.length} уникальных позиций</p>
      {rows.map((row) => (
        <ClientMergedItemCard
          key={row.mergeKey}
          row={row}
          currency={project.currency}
          patch={patch}
          purchaseStatuses={purchaseStatuses}
          sourcesLabel={mergeSourcesLabel(row.sources)}
        />
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

  const mergedRows = useMemo(() => {
    if (mode !== "categories") return null;
    let pool = scoped;
    if (supplierFilter) pool = pool.filter((i) => i.supplier === supplierFilter);
    const q = (purchaseQuery || "").trim().toLowerCase();
    if (q) {
      pool = pool.filter(
        (i) => (i.name || "").toLowerCase().includes(q) || (i.supplier || "").toLowerCase().includes(q)
      );
    }
    let rows = mergedPurchaseRows(pool);
    rows = applyMergedPurchaseFilter(rows, filter);
    rows.sort((a, b) => {
      if (purchaseSort === "sum") return b.sumVat - a.sumVat;
      if (purchaseSort === "status") {
        const la = purchaseStatuses.find((s) => s.id === a.sourceItems?.[0]?.status)?.label || "";
        const lb = purchaseStatuses.find((s) => s.id === b.sourceItems?.[0]?.status)?.label || "";
        return la.localeCompare(lb, "ru");
      }
      if (purchaseSort === "category") {
        const c = clientSectionLabel(a.sourceItems?.[0]).localeCompare(clientSectionLabel(b.sourceItems?.[0]), "ru");
        if (c !== 0) return c;
      }
      return (a.name || "").localeCompare(b.name || "", "ru");
    });
    return rows;
  }, [mode, scoped, supplierFilter, purchaseQuery, filter, purchaseSort, purchaseStatuses]);

  const filtered = useMemo(() => {
    if (mode === "categories") return [];
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
  }, [mode, scoped, supplierFilter, purchaseQuery, filter, purchaseSort, purchaseStatuses]);

  const { todo, bought } =
    mode === "categories" && mergedRows
      ? splitMergedPurchaseRows(mergedRows)
      : splitPurchaseItems(filtered);
  const boughtCount = scoped.filter((i) => isBoughtStatus(i.status)).length;

  const renderList = (list, isBought) => {
    if (mode === "categories" && Array.isArray(list) && list[0]?.mergeKey) {
      return (
        <ItemsByMergedGroup
          groups={groupMergedBySection(list)}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
        />
      );
    }
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
