import React, { useMemo } from "react";
import { groupBy, mergedPurchaseRows, money } from "../../store/helpers.js";
import {
  lineGross,
  itemsByResponsible,
  splitPurchaseItems,
  splitMergedPurchaseRows,
  applyMergedPurchaseFilter,
  isMergedPurchaseMode,
  isBoughtStatus,
} from "../../lib/itemHelpers.js";
import { clientSectionLabel } from "../../../shared/clientSections.js";
import {
  compositionGroupLabel,
  groupItemsByComposition,
  isStellageModuleTitle,
  STELLAGE_GROUPS,
} from "../../../shared/stellageComposition.js";
import {
  groupMergedBySectionHierarchy,
  groupMergedBySupplier,
  groupMergedFlat,
} from "../../lib/clientPurchaseGroups.js";
import Collapsible from "../Collapsible.jsx";
import { Empty } from "../ui.jsx";
import ClientItemCard from "./ClientItemCard.jsx";
import ClientMergedItemCard from "./ClientMergedItemCard.jsx";
import {
  PRIMARY_PURCHASE_MODES,
  SPECIALIST_PURCHASE_MODES,
  isSpecialistPurchaseMode,
} from "../../lib/clientBrandConfig.js";

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

function filterItemPool(pool, { supplierFilter, purchaseQuery }) {
  let out = pool;
  if (supplierFilter) out = out.filter((i) => i.supplier === supplierFilter);
  const q = (purchaseQuery || "").trim().toLowerCase();
  if (q) {
    out = out.filter(
      (i) => (i.name || "").toLowerCase().includes(q) || (i.supplier || "").toLowerCase().includes(q)
    );
  }
  return out;
}

function sortMergedRows(rows, purchaseSort, purchaseStatuses) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (purchaseSort === "sum") return b.sumVat - a.sumVat;
    if (purchaseSort === "status") {
      const la = purchaseStatuses.find((s) => s.id === a.status)?.label || "";
      const lb = purchaseStatuses.find((s) => s.id === b.status)?.label || "";
      return la.localeCompare(lb, "ru");
    }
    if (purchaseSort === "category") {
      const c = (a.clientSectionLabel || "").localeCompare(b.clientSectionLabel || "", "ru");
      if (c !== 0) return c;
    }
    return (a.name || "").localeCompare(b.name || "", "ru");
  });
  return sorted;
}

function MergedRowsList({ rows, currency, patch, bought, purchaseStatuses }) {
  return rows.map((row) => (
    <ClientMergedItemCard
      key={row.mergeKey}
      row={row}
      currency={currency}
      patch={patch}
      bought={bought}
      purchaseStatuses={purchaseStatuses}
    />
  ));
}

function MergedSectionGroups({ groups, currency, patch, bought, purchaseStatuses, withSubsections = false }) {
  return groups.map((section) => (
    <Collapsible
      key={section.sectionId || section.title}
      className="client-purchase-section"
      title={section.title}
      subtitle={`${section.count} поз. · ${section.sumLabel}`}
      defaultOpen={false}
    >
      {withSubsections
        ? section.subsections.map((sub) =>
            sub.title ? (
              <Collapsible
                key={`${section.title}-${sub.title}`}
                className="client-purchase-subsection"
                title={sub.title}
                subtitle={`${sub.count} поз. · ${sub.sumLabel}`}
                defaultOpen={false}
              >
                <MergedRowsList rows={sub.rows} currency={currency} patch={patch} bought={bought} purchaseStatuses={purchaseStatuses} />
              </Collapsible>
            ) : (
              <MergedRowsList key={`${section.title}-default`} rows={sub.rows} currency={currency} patch={patch} bought={bought} purchaseStatuses={purchaseStatuses} />
            )
          )
        : section.rows && (
            <MergedRowsList rows={section.rows} currency={currency} patch={patch} bought={bought} purchaseStatuses={purchaseStatuses} />
          )}
    </Collapsible>
  ));
}

function ItemsByGroup({ groups, currency, patch, bought, purchaseStatuses, materials, modules, stellageGroups }) {
  return groups.map(([title, list]) => {
    const sum = list.reduce((s, i) => s + lineGross(i), 0);
    const stellageModule = isStellageModuleTitle(title, modules);
    const compositionGroups = stellageModule ? groupItemsByComposition(list, materials, stellageGroups) : null;
    return (
      <Collapsible
        key={title}
        className="client-purchase-section"
        title={title}
        subtitle={`${list.length} поз. · ${money(sum, currency)}`}
        defaultOpen={false}
      >
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
      </Collapsible>
    );
  });
}

export function ClientMergedList({ project, items, patch, purchaseStatuses, groupBySection = false }) {
  const rows = mergedPurchaseRows(items);
  if (groupBySection) {
    const groups = groupMergedBySectionHierarchy(rows, project.currency);
    return (
      <div style={{ marginTop: 8 }}>
        <p className="muted" style={{ fontSize: 13 }}>{rows.length} уникальных позиций</p>
        <MergedSectionGroups
          groups={groups}
          currency={project.currency}
          patch={patch}
          bought={false}
          purchaseStatuses={purchaseStatuses}
          withSubsections
        />
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <p className="muted" style={{ fontSize: 13 }}>{rows.length} уникальных позиций</p>
      <MergedRowsList rows={rows} currency={project.currency} patch={patch} bought={false} purchaseStatuses={purchaseStatuses} />
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
  const scoped = useMemo(() => itemsForMode(items, mode === "all" ? "all" : mode), [items, mode]);
  const effectiveMode = mode === "all" ? "all" : mode;

  const mergedRows = useMemo(() => {
    if (!isMergedPurchaseMode(effectiveMode)) return null;
    const pool = filterItemPool(scoped, { supplierFilter, purchaseQuery });
    let rows = mergedPurchaseRows(pool);
    rows = applyMergedPurchaseFilter(rows, filter);
    return sortMergedRows(rows, purchaseSort, purchaseStatuses);
  }, [effectiveMode, scoped, supplierFilter, purchaseQuery, filter, purchaseSort, purchaseStatuses]);

  const filtered = useMemo(() => {
    if (isMergedPurchaseMode(effectiveMode)) return [];
    let out = filterItemPool(scoped, { supplierFilter, purchaseQuery });
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
  }, [effectiveMode, scoped, supplierFilter, purchaseQuery, filter, purchaseSort, purchaseStatuses]);

  const { todo, bought } =
    mergedRows != null ? splitMergedPurchaseRows(mergedRows) : splitPurchaseItems(filtered);
  const boughtCount = scoped.filter((i) => isBoughtStatus(i.status)).length;

  const renderMergedList = (list, isBought) => {
    if (effectiveMode === "categories") {
      return (
        <MergedSectionGroups
          groups={groupMergedBySectionHierarchy(list, project.currency)}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
          withSubsections
        />
      );
    }
    if (effectiveMode === "suppliers") {
      return (
        <MergedSectionGroups
          groups={groupMergedBySupplier(list, project.currency)}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
        />
      );
    }
    return (
      <MergedSectionGroups
        groups={groupMergedFlat(list, project.currency)}
        currency={project.currency}
        patch={patch}
        bought={isBought}
        purchaseStatuses={purchaseStatuses}
      />
    );
  };

  const renderDetailList = (list, isBought) => {
    if (effectiveMode === "modules") {
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
    return null;
  };

  const renderList = (list, isBought) => {
    if (list[0]?.mergeKey) return renderMergedList(list, isBought);
    return renderDetailList(list, isBought);
  };

  const specialistActive = isSpecialistPurchaseMode(effectiveMode);

  if (!todo.length && !bought.length) {
    return <Empty title="Нет позиций по фильтру" />;
  }

  return (
    <div className="client-purchase-panel">
      <div className="client-purchase-modes no-print">
        {PRIMARY_PURCHASE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={"btn btn-sm" + (effectiveMode === m.id ? " btn-primary" : "")}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="client-purchase-modes client-purchase-modes--sub no-print">
        <span className="muted" style={{ fontSize: 12, alignSelf: "center", marginRight: 4 }}>
          Специалисты:
        </span>
        {SPECIALIST_PURCHASE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={"btn btn-sm" + (effectiveMode === m.id ? " btn-primary" : "")}
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
      {specialistActive && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Склеенный список для передачи специалисту — с расшифровкой, из каких модулей взялось количество.
        </p>
      )}
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
