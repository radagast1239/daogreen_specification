import React, { useMemo } from "react";
import { groupBy, mergedPurchaseRows, money } from "../../store/helpers.js";
import {
  lineGross,
  itemsByResponsible,
  splitPurchaseItems,
  splitMergedPurchaseRows,
  applyMergedPurchaseFilter,
  isMergedPurchaseMode,
  isClosedPurchaseStatus,
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
  flattenMergedBySectionOrder,
  groupMergedByListCategories,
} from "../../lib/clientPurchaseGroups.js";
import Collapsible from "../Collapsible.jsx";
import { Empty } from "../ui.jsx";
import ClientItemCard from "./ClientItemCard.jsx";
import ClientMergedItemCard from "./ClientMergedItemCard.jsx";
import {
  PRIMARY_PURCHASE_MODES,
  SPECIALIST_PURCHASE_MODES,
  CLIENT_SIMPLE_PURCHASE_MODES,
  isSpecialistPurchaseMode,
  isSimplePurchaseMode,
} from "../../lib/clientBrandConfig.js";
import { isTodayPriority } from "../../../shared/purchasePriority.js";
import ClientPurchaseDashboard from "./ClientPurchaseDashboard.jsx";
import ClientPurchaseTable from "./ClientPurchaseTable.jsx";

const STATUS_PURCHASE_MODES = [
  { id: "today", label: "Список на сегодня" },
  { id: "bought", label: "Уже куплено" },
  { id: "need_help", label: "Нужна помощь" },
  { id: "replacement_check", label: "Замены на проверке" },
];

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

function hasProductLink(it) {
  return !!(it.link || "").trim();
}

function itemsForMode(items, mode) {
  if (mode === "today") return items.filter((i) => isTodayPriority(i.purchasePriority));
  if (mode === "bought") return items.filter((i) => isBoughtStatus(i.status));
  if (mode === "need_help") return items.filter((i) => i.status === "need_help");
  if (mode === "replacement_check") return items.filter((i) => i.status === "replacement_check");
  if (mode === "with_link") return items.filter(hasProductLink);
  if (mode === "without_link") return items.filter((i) => !hasProductLink(i));
  if (mode === "ordered") return items.filter((i) => i.status === "ordered");
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

function sortMergedRows(rows, currency) {
  return flattenMergedBySectionOrder(rows, currency);
}

function MergedRowsList({ rows, layout, currency, patch, patchBulk, bought, purchaseStatuses, onProposeReplacement, compact }) {
  if (layout === "table") {
    return (
      <ClientPurchaseTable
        rows={rows}
        currency={currency}
        patch={patch}
        patchBulk={patchBulk}
        bought={bought}
        purchaseStatuses={purchaseStatuses}
        onProposeReplacement={onProposeReplacement}
        compact={compact}
      />
    );
  }
  return rows.map((row) => (
    <ClientMergedItemCard
      key={`${row.mergeKey}-${(row.sourceIds || []).join(",")}`}
      row={row}
      currency={currency}
      patch={patch}
      patchBulk={patchBulk}
      bought={bought}
      purchaseStatuses={purchaseStatuses}
      onProposeReplacement={onProposeReplacement}
      compact={compact}
    />
  ));
}

function MergedSectionGroups({
  groups,
  currency,
  patch,
  patchBulk,
  bought,
  purchaseStatuses,
  withSubsections = false,
  onProposeReplacement,
  defaultOpenFirst = false,
  layout = "cards",
  compact = false,
}) {
  return groups.map((section, sectionIndex) => (
    <Collapsible
      key={section.sectionId || section.title}
      className="client-purchase-section"
      title={section.title}
      subtitle={`${section.count} поз. · ${section.sumLabel}${section.hint ? ` · ${section.hint}` : ""}`}
      defaultOpen={defaultOpenFirst && sectionIndex === 0}
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
                <MergedRowsList rows={sub.rows} layout={layout} currency={currency} patch={patch} patchBulk={patchBulk} bought={bought} purchaseStatuses={purchaseStatuses} onProposeReplacement={onProposeReplacement} compact={compact} />
              </Collapsible>
            ) : (
              <MergedRowsList key={`${section.title}-default`} rows={sub.rows} layout={layout} currency={currency} patch={patch} patchBulk={patchBulk} bought={bought} purchaseStatuses={purchaseStatuses} onProposeReplacement={onProposeReplacement} compact={compact} />
            )
          )
        : section.rows && (
            <MergedRowsList rows={section.rows} layout={layout} currency={currency} patch={patch} patchBulk={patchBulk} bought={bought} purchaseStatuses={purchaseStatuses} onProposeReplacement={onProposeReplacement} compact={compact} />
          )}
    </Collapsible>
  ));
}

function ItemsByGroup({ groups, currency, patch, bought, purchaseStatuses, materials, modules, stellageGroups, onProposeReplacement, compact = false }) {
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
                  <ClientItemCard key={it.id} it={it} currency={currency} patch={patch} bought={bought} purchaseStatuses={purchaseStatuses} onProposeReplacement={onProposeReplacement} compact={compact} />
                ))}
              </React.Fragment>
            ))
          : list.map((it) => (
              <ClientItemCard key={it.id} it={it} currency={currency} patch={patch} bought={bought} purchaseStatuses={purchaseStatuses} onProposeReplacement={onProposeReplacement} />
            ))}
      </Collapsible>
    );
  });
}

export function ClientMergedList({ project, items, patch, purchaseStatuses, groupBySection = false, layout = "cards" }) {
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
          layout={layout}
        />
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <p className="muted" style={{ fontSize: 13 }}>{rows.length} уникальных позиций</p>
      <MergedRowsList rows={rows} layout={layout} currency={project.currency} patch={patch} bought={false} purchaseStatuses={purchaseStatuses} />
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
  patch,
  patchBulk,
  purchaseStatuses,
  materials,
  modules,
  stellageGroups = STELLAGE_GROUPS,
  onProposeReplacement,
  simple = true,
  layout = "cards",
  compact = false,
}) {
  const normalizedMode = useMemo(() => {
    if (!simple) return mode === "all" ? "all" : mode;
    if (isSimplePurchaseMode(mode)) return mode;
    return "categories";
  }, [simple, mode]);

  const effectiveFilter = simple ? "all" : filter;

  const effectiveMode = normalizedMode;
  const isStatusMode = STATUS_PURCHASE_MODES.some((m) => m.id === effectiveMode);
  const isOrderedMode = effectiveMode === "ordered";

  const scoped = useMemo(() => itemsForMode(items, normalizedMode === "all" ? "all" : normalizedMode), [items, normalizedMode]);

  const mergeFilter = isOrderedMode || isStatusMode ? "all" : effectiveFilter;

  const mergedRows = useMemo(() => {
    if (isStatusMode || !isMergedPurchaseMode(effectiveMode)) return null;
    const pool = filterItemPool(scoped, { supplierFilter, purchaseQuery });
    let rows = mergedPurchaseRows(pool);
    if (!isOrderedMode) rows = applyMergedPurchaseFilter(rows, mergeFilter);
    return sortMergedRows(rows, project.currency);
  }, [effectiveMode, scoped, supplierFilter, purchaseQuery, mergeFilter, project.currency, isStatusMode, isOrderedMode]);

  const filtered = useMemo(() => {
    if (!isStatusMode && isMergedPurchaseMode(effectiveMode)) return [];
    let out = filterItemPool(scoped, { supplierFilter, purchaseQuery });
    out = applyPurchaseFilter(out, effectiveFilter);
    return [...out].sort((a, b) => {
      const ao = a.sortOrder ?? 99999;
      const bo = b.sortOrder ?? 99999;
      if (ao !== bo) return ao - bo;
      return (a.name || "").localeCompare(b.name || "", "ru");
    });
  }, [effectiveMode, scoped, supplierFilter, purchaseQuery, effectiveFilter, isStatusMode]);

  const statusFlatList = useMemo(() => {
    if (!isStatusMode) return [];
    let out = filterItemPool(scoped, { supplierFilter, purchaseQuery });
    return [...out].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
  }, [isStatusMode, scoped, supplierFilter, purchaseQuery]);

  const { todo, bought } = isOrderedMode || (isStatusMode && effectiveMode !== "bought")
    ? { todo: mergedRows ?? filtered, bought: [] }
    : isStatusMode
      ? effectiveMode === "bought"
        ? { todo: [], bought: statusFlatList }
        : { todo: statusFlatList, bought: [] }
      : mergedRows != null
        ? splitMergedPurchaseRows(mergedRows)
        : splitPurchaseItems(filtered);
  const boughtCount = scoped.filter((i) => isClosedPurchaseStatus(i.status)).length;

  const renderMergedList = (list, isBought) => {
    const pass = { onProposeReplacement, layout, compact, patchBulk };
    const openFirst = simple && !isBought && effectiveMode === "categories";
    if (effectiveMode === "categories" || effectiveMode === "plumber" || effectiveMode === "with_link" || effectiveMode === "without_link") {
      return (
        <MergedSectionGroups
          key={`sections-${effectiveMode}-${isBought}`}
          groups={groupMergedBySectionHierarchy(list, project.currency)}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
          withSubsections
          defaultOpenFirst={openFirst}
          {...pass}
        />
      );
    }
    if (effectiveMode === "list") {
      return (
        <MergedSectionGroups
          key={`list-categories-${isBought}`}
          groups={groupMergedByListCategories(list, project.currency)}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
          defaultOpenFirst={false}
          {...pass}
        />
      );
    }
    if (effectiveMode === "all") {
      return (
        <MergedRowsList
          rows={list}
          currency={project.currency}
          patch={patch}
          patchBulk={patchBulk}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
          onProposeReplacement={onProposeReplacement}
          compact={compact}
          layout={layout}
        />
      );
    }
    if (effectiveMode === "suppliers") {
      return (
        <MergedSectionGroups
          key={`suppliers-${isBought}`}
          groups={groupMergedBySupplier(list, project.currency)}
          currency={project.currency}
          patch={patch}
          bought={isBought}
          purchaseStatuses={purchaseStatuses}
          defaultOpenFirst={false}
          {...pass}
        />
      );
    }
    return (
      <MergedSectionGroups
        key={`flat-${isBought}`}
        groups={groupMergedFlat(list, project.currency)}
        currency={project.currency}
        patch={patch}
        bought={isBought}
        purchaseStatuses={purchaseStatuses}
        {...pass}
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
          onProposeReplacement={onProposeReplacement}
          compact={compact}
        />
      );
    }
    if (isStatusMode) {
      if (layout === "table") {
        return (
          <ClientPurchaseTable
            items={list}
            currency={project.currency}
            patch={patch}
            bought={effectiveMode === "bought"}
            purchaseStatuses={purchaseStatuses}
            onProposeReplacement={onProposeReplacement}
            compact={compact}
          />
        );
      }
      return list.map((it) => (
        <ClientItemCard
          key={it.id}
          it={it}
          currency={project.currency}
          patch={patch}
          bought={effectiveMode === "bought"}
          purchaseStatuses={purchaseStatuses}
          onProposeReplacement={onProposeReplacement}
          compact={compact}
        />
      ));
    }
    return null;
  };

  const renderList = (list, isBought) => {
    if (isStatusMode) return renderDetailList(list, isBought);
    if (list[0]?.mergeKey) return renderMergedList(list, isBought);
    return renderDetailList(list, isBought);
  };

  const specialistActive = isSpecialistPurchaseMode(effectiveMode);

  const modeButtons = simple ? CLIENT_SIMPLE_PURCHASE_MODES : PRIMARY_PURCHASE_MODES;

  if (!todo.length && !bought.length) {
    return <Empty title="Нет позиций по фильтру" />;
  }

  return (
    <div className="client-purchase-panel">
      {!simple && (
        <ClientPurchaseDashboard
          items={items}
          currency={project.currency}
          onModeSelect={(key) => {
            const map = {
              ordered: () => onFilterChange("ordered"),
              need_help: () => onModeChange("need_help"),
              replacement_check: () => onModeChange("replacement_check"),
              bought: () => onModeChange("bought"),
            };
            if (map[key]) map[key]();
          }}
        />
      )}
      <div className="client-purchase-modes no-print">
        {modeButtons.map((m) => (
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
      {!simple && (
        <>
          <div className="client-purchase-modes client-purchase-modes--sub no-print">
            {STATUS_PURCHASE_MODES.map((m) => (
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
        </>
      )}
      <div className="client-purchase-filters no-print">
        {!simple &&
          PURCHASE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={"btn btn-sm" + (filter === f.id ? " btn-primary" : "")}
              onClick={() => onFilterChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        {simple && !isOrderedMode && (
          <span className="muted" style={{ fontSize: 13 }}>
            {todo.length} к покупке
            {boughtCount > 0 ? ` · ${boughtCount} уже куплено` : ""}
          </span>
        )}
        {simple && isOrderedMode && (
          <span className="muted" style={{ fontSize: 13 }}>
            {todo.length} заказано
          </span>
        )}
        <label className="row" style={{ marginLeft: "auto", fontSize: 13, gap: 6 }}>
          {!isOrderedMode && (
            <>
              <input type="checkbox" checked={showBought} onChange={(e) => onShowBoughtChange(e.target.checked)} />
              Показать заказанные и купленные{boughtCount > 0 ? ` (${boughtCount})` : ""}
            </>
          )}
        </label>
      </div>
      {effectiveMode === "ordered" && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Позиции со статусом «Заказано» — ожидают доставки. После получения отметьте «Куплено» или «Доставлено».
        </p>
      )}
      {effectiveMode === "list" && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Крупные категории без дублирования. Позиции стеллажей смотрите в режиме «По разделам».
        </p>
      )}
      {effectiveMode === "suppliers" && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Все поставщики свёрнуты — нажмите на название, чтобы развернуть список позиций.
        </p>
      )}
      {effectiveMode === "plumber" && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Список для сантехника по разделам — можно передать ссылку или PDF из вкладки «Документы».
        </p>
      )}
      {specialistActive && effectiveMode !== "plumber" && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Склеенный список для передачи специалисту — с расшифровкой, из каких модулей взялось количество.
        </p>
      )}
      {todo.length > 0 ? (
        <>
          <h3 className="purchase-section-title">
            {isOrderedMode ? `Заказано · ${todo.length}` : `К закупке · ${todo.length}`}
          </h3>
          {renderList(todo, isOrderedMode)}
        </>
      ) : (
        <p className="muted" style={{ fontSize: 14, margin: "16px 0" }}>
          {isOrderedMode ? "Пока нет позиций со статусом «Заказано»." : "Всё из фильтра уже куплено."}
        </p>
      )}
      {showBought && bought.length > 0 && (
        <div className="purchase-bought-block">
          <h3 className="purchase-section-title purchase-section-title--done">Заказано / куплено · {bought.length}</h3>
          {renderList(bought, true)}
        </div>
      )}
    </div>
  );
}
