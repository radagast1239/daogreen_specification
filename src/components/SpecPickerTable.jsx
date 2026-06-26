import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { groupLabel, STELLAGE_GROUPS } from "../../shared/stellageComposition.js";
import { FARM_LINE_GROUPS, farmLineGroupLabel, resolveFarmLineGroup } from "../../shared/farmLineGroups.js";
import {
  matchSpecLineFilter,
  patchLine,
  patchLinesByIds,
} from "../../shared/specLineFilters.js";
import { uid } from "../store/helpers.js";
import SpecSectionToolbar from "./SpecSectionToolbar.jsx";
import { syncFastenersFromCrabs } from "../../shared/fastenerRules.js";
import { formatMaterialModulesLabel, materialInModule } from "../../shared/materialModules.js";
import { CATEGORIES } from "../data/modules.js";
import {
  blankLine,
  lineFromMaterial,
  lineToMaterialPayload,
  syncLineFromMaterial,
} from "../lib/projectBuilder.js";
import { hydrateCatalogEditorLine } from "../lib/specLineCore.js";
import { attachLineSpecOverrides } from "../../shared/lineSpecOverrides.js";
import { Modal } from "./ui.jsx";
import SpecPickerLineRow from "./SpecPickerLineRow.jsx";
import CatalogPickerMaterialRow from "./CatalogPickerMaterialRow.jsx";

function materialUpdatedTs(m) {
  if (!m?.updatedAt) return 0;
  const t = new Date(m.updatedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

function groupMaterialsByCategory(items, categoryOrder = CATEGORIES) {
  const map = new Map();
  for (const m of items) {
    const cat = m.category || "Прочее";
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(m);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => materialUpdatedTs(b) - materialUpdatedTs(a));
  }
  return [...map.entries()].sort((a, b) => {
    const maxA = Math.max(0, ...a[1].map(materialUpdatedTs));
    const maxB = Math.max(0, ...b[1].map(materialUpdatedTs));
    if (maxB !== maxA) return maxB - maxA;
    const ia = categoryOrder.indexOf(a[0]);
    const ib = categoryOrder.indexOf(b[0]);
    const oa = ia >= 0 ? ia : 999;
    const ob = ib >= 0 ? ib : 999;
    if (oa !== ob) return oa - ob;
    return a[0].localeCompare(b[0], "ru");
  });
}

function resolveLineDisplayName(line, materials) {
  if (line.materialId) {
    const mat = materials.find((m) => m.id === line.materialId);
    if (mat?.name) return mat.name;
  }
  return line.name || "";
}

/** Состояние строки каталога — только ссылка на материал или черновик до сохранения в базу */
function catalogStateLine(ln, materials) {
  const h = hydrateCatalogEditorLine(ln, materials);
  const sub = h.subcategory || h.farmGroup || "";
  if (h.materialId) {
    const out = {
      id: h.id,
      materialId: h.materialId,
      included: h.included,
      qty: h.qty,
      defaultQty: h.defaultQty ?? h.qty,
    };
    if (sub) {
      out.subcategory = sub;
      out.farmGroup = sub;
    }
    return attachLineSpecOverrides(out, h);
  }
  const out = {
    id: h.id,
    name: h.name,
    unit: h.unit,
    category: h.category,
    included: h.included,
    qty: h.qty,
    defaultQty: h.defaultQty ?? h.qty,
  };
  if (sub) {
    out.subcategory = sub;
    out.farmGroup = sub;
  }
  return attachLineSpecOverrides(out, h);
}

export function countIncluded(lines) {
  return lines.filter((ln) => ln.included && (ln.materialId || ln.name?.trim())).length;
}

/** Строки без id ломают галочки и select группы — patchLine не находит строку */
function ensureLineIds(lines) {
  let changed = false;
  const next = (lines || []).map((ln) => {
    if (ln?.id) return ln;
    changed = true;
    return { ...ln, id: uid("ln") };
  });
  return changed ? next : lines;
}

const emptyNew = () => ({
  name: "",
  unit: "шт.",
  price: 0,
  link: "",
  category: "Прочее",
  supplier: "",
});

export default function SpecPickerTable({
  lines,
  onChange,
  materials = [],
  catalogModule = "",
  farmSectionId = "",
  catalogLabel = "из базы",
  emptyHint = "Выберите тип стеллажа — позиции появятся в таблице.",
  onSaveMaterial,
  categories: categoriesProp,
  suppliers = [],
  showQty = false,
  qtyLabel = "Кол-во",
  showCompositionGroups = false,
  showFarmLineGroups = false,
  farmLineGroups = FARM_LINE_GROUPS,
  stellageGroups = STELLAGE_GROUPS,
  responsibleOptions,
  sectionFilterMode = "builder",
  units: unitsProp,
  rooms = [],
  showRoom = false,
  /** Наименования из базы — текст, без редактирования (сборка фермы) */
  staticNames = false,
  /** Каталог шаблона: в state только materialId + qty + группа (данные из базы материалов) */
  catalogRefsOnly = false,
}) {
  const categories = categoriesProp?.length ? categoriesProp : CATEGORIES;
  const unitOptions = unitsProp?.length ? unitsProp : ["шт.", "м", "м²", "м³", "кг", "л"];
  const groupTitle = (id) => {
    if (showFarmLineGroups) return farmLineGroupLabel(id, farmLineGroups);
    return stellageGroups.find((g) => g.id === id)?.label || groupLabel(id);
  };
  const [picker, setPicker] = useState(false);
  const [pickedIds, setPickedIds] = useState(() => new Set());
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState(emptyNew);
  const [q, setQ] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [savingId, setSavingId] = useState(null);
  const [savingNew, setSavingNew] = useState(false);
  const pickerScrollRef = useRef(null);
  const catalogScrollRef = useRef(null);

  const normalizedLines = useMemo(
    () => ensureLineIds(lines).map((ln) => hydrateCatalogEditorLine(ln, materials)),
    [lines, materials]
  );

  useEffect(() => {
    if ((lines || []).some((ln) => !ln?.id)) {
      let fixed = ensureLineIds(lines).map((ln) => hydrateCatalogEditorLine(ln, materials));
      fixed = syncFastenersFromCrabs(fixed, materials);
      if (catalogRefsOnly) {
        fixed = fixed.map((ln) => catalogStateLine(ln, materials));
      }
      onChange(fixed);
    }
    // Однократно при открытии секции — не на каждое обновление lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitLines = useCallback(
    (next) => {
      const withIds = ensureLineIds(next);
      let out = withIds.map((ln) => hydrateCatalogEditorLine(ln, materials));
      out = syncFastenersFromCrabs(out, materials);
      if (catalogRefsOnly) {
        out = out.map((ln) => catalogStateLine(ln, materials));
      }
      onChange(out);
    },
    [onChange, materials, catalogRefsOnly]
  );

  /** Активные материалы базы; при catalogModule — только с этим модулем */
  const catalog = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return materials.filter((m) => {
      if (m.status !== "active") return false;
      if (catalogModule && !materialInModule(m, catalogModule)) return false;
      if (!ql) return true;
      const hay = `${m.name} ${formatMaterialModulesLabel(m)} ${m.category || ""} ${m.supplier || ""}`.toLowerCase();
      return hay.includes(ql);
    });
  }, [materials, q, catalogModule]);

  const existingMaterialIds = useMemo(
    () => new Set(normalizedLines.map((ln) => ln.materialId).filter(Boolean)),
    [normalizedLines]
  );

  const catalogGrouped = useMemo(
    () => groupMaterialsByCategory(catalog, categories),
    [catalog, categories]
  );

  const pickableCatalog = useMemo(
    () => catalog.filter((m) => !existingMaterialIds.has(m.id)),
    [catalog, existingMaterialIds]
  );

  const visibleLines = useMemo(() => {
    const sq = search.trim().toLowerCase();
    return normalizedLines.filter((ln) => {
      if (onlyOn && !ln.included) return false;
      if (sq && !resolveLineDisplayName(ln, materials).toLowerCase().includes(sq)) return false;
      if (!matchSpecLineFilter(ln, lineFilter, sectionFilterMode)) return false;
      return true;
    });
  }, [normalizedLines, onlyOn, search, lineFilter, sectionFilterMode]);

  const toggleSelected = (id, on) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const applyBulk = (patch) => {
    if (!selectedIds.size) return;
    const ids = [...selectedIds];
    if (patch.__copyToSection) {
      const target = patch.__copyToSection;
      const copies = normalizedLines
        .filter((ln) => selectedIds.has(ln.id))
        .map((ln) => ({
          ...ln,
          id: uid("ln"),
          module: target,
          section: target,
        }));
      emitLines([...normalizedLines, ...copies]);
      setSelectedIds(new Set());
      return;
    }
    emitLines(patchLinesByIds(normalizedLines, ids, patch));
    setSelectedIds(new Set());
  };

  const grouped = useMemo(() => {
    const map = new Map();
    for (const ln of visibleLines) {
      const g = showFarmLineGroups
        ? resolveFarmLineGroup(ln)
        : ln.subcategory || "other";
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(ln);
    }
    if (!showCompositionGroups && !showFarmLineGroups) return map;
    const ordered = new Map();
    const defs = showFarmLineGroups ? farmLineGroups : stellageGroups;
    for (const sg of defs) {
      if (map.has(sg.id)) ordered.set(sg.id, map.get(sg.id));
    }
    if (map.has("other")) ordered.set("other", map.get("other"));
    for (const [g, arr] of map) {
      if (!ordered.has(g)) ordered.set(g, arr);
    }
    return ordered;
  }, [visibleLines, showCompositionGroups, showFarmLineGroups, stellageGroups, farmLineGroups]);

  const flatPickerRows = useMemo(() => {
    const rows = [];
    for (const [g, grpLines] of grouped.entries()) {
      if (g !== "other") rows.push({ kind: "group", g });
      for (const ln of grpLines) rows.push({ kind: "line", ln });
    }
    return rows;
  }, [grouped]);

  const catalogFlatRows = useMemo(() => {
    const rows = [];
    for (const [catName, mats] of catalogGrouped) {
      rows.push({ kind: "cat", catName, count: mats.length });
      for (const m of mats) rows.push({ kind: "mat", m });
    }
    return rows;
  }, [catalogGrouped]);

  const lineRowProps = {
    materials,
    selectedIds,
    toggleSelected,
    toggleLine,
    staticNames,
    resolveLineDisplayName,
    normalizedLines,
    emitLines,
    categories,
    suppliers,
    unitOptions,
    showCompositionGroups,
    stellageGroups,
    showFarmLineGroups,
    farmLineGroups,
    showRoom,
    rooms,
    showQty,
    onSaveMaterial,
    savingId,
    saveLineToBase,
  };

  const setAll = (included) => emitLines(normalizedLines.map((ln) => ({ ...ln, included })));

  const toggleLine = (ln, included) => {
    const patch = { included };
    if (showQty && included && !ln.qty) {
      patch.qty = 1;
      patch.defaultQty = 1;
    }
    emitLines(patchLine(normalizedLines, ln.id, patch));
  };

  const openPicker = () => {
    setQ("");
    setPickedIds(new Set());
    setPicker(true);
  };

  const togglePick = (id) => {
    if (existingMaterialIds.has(id)) return;
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPickable = () => {
    setPickedIds(new Set(pickableCatalog.map((m) => m.id)));
  };

  const clearPicked = () => setPickedIds(new Set());

  const addSelectedFromCatalog = () => {
    if (!pickedIds.size) return;
    const toAdd = materials.filter((m) => pickedIds.has(m.id) && !existingMaterialIds.has(m.id));
    if (!toAdd.length) return;
    emitLines([
      ...normalizedLines,
      ...toAdd.map((m) =>
        lineFromMaterial(m, {
          included: true,
          ...(showQty ? { qty: Number(m.defaultQty) || 1, defaultQty: Number(m.defaultQty) || 1 } : {}),
        })
      ),
    ]);
    setPicker(false);
    setPickedIds(new Set());
    setQ("");
  };

  const addFromCatalog = (mat) => {
    if (normalizedLines.some((ln) => ln.materialId === mat.id)) return;
    emitLines([...normalizedLines, lineFromMaterial(mat, { included: true })]);
    setPicker(false);
    setQ("");
    setPickedIds(new Set());
  };

  const saveLineToBase = async (ln) => {
    if (!onSaveMaterial || !ln.name?.trim()) return;
    const mod = catalogModule || ln.module || "";
    setSavingId(ln.id);
    try {
      const mat = await onSaveMaterial(lineToMaterialPayload(ln, mod, farmSectionId));
      emitLines(patchLine(normalizedLines, ln.id, syncLineFromMaterial(ln, mat)));
    } catch (e) {
      alert(e.message || "Не удалось сохранить в базу");
    } finally {
      setSavingId(null);
    }
  };

  const createNewInBase = async () => {
    if (catalogRefsOnly && !onSaveMaterial) {
      alert("Новые позиции добавляются только через базу материалов.");
      return;
    }
    if (!onSaveMaterial) {
      emitLines([...normalizedLines, blankLine({ ...newForm, included: true })]);
      setNewOpen(false);
      setNewForm(emptyNew());
      return;
    }
    if (!newForm.name.trim()) {
      alert("Укажите название позиции.");
      return;
    }
    const mod = catalogModule || newForm.module || "";
    setSavingNew(true);
    try {
      const mat = await onSaveMaterial(
        lineToMaterialPayload(
          { ...newForm, category: newForm.category },
          mod,
          farmSectionId
        )
      );
      emitLines([
        ...normalizedLines,
        lineFromMaterial(mat, {
          included: true,
          ...(showQty ? { qty: 1, defaultQty: 1 } : {}),
        }),
      ]);
      setNewOpen(false);
      setNewForm(emptyNew());
    } catch (e) {
      alert(e.message || "Не удалось сохранить в базу");
    } finally {
      setSavingNew(false);
    }
  };

  const colSpan =
    (showQty ? 10 : 9) +
    (showRoom ? 1 : 0) +
    (showCompositionGroups || showFarmLineGroups ? 1 : 0) +
    1;
  const virtualizePicker = flatPickerRows.length >= 24;

  return (
    <>
      <SpecSectionToolbar
        mode={sectionFilterMode}
        filterId={lineFilter}
        onFilterChange={setLineFilter}
        selectedCount={selectedIds.size}
        visibleCount={visibleLines.length}
        onSelectAll={() => setSelectedIds(new Set(visibleLines.map((ln) => ln.id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        onBulkPatch={applyBulk}
        suppliers={suppliers}
        responsibleOptions={responsibleOptions}
      />
      <div className="toolbar" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <input
          placeholder="Поиск по позициям…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 180, flex: "1 1 160px" }}
        />
        <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>
          Все ✓
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAll(false)}>
          Снять все
        </button>
        <label className="row" style={{ fontSize: 13, gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} />
          Только отмеченные
        </label>
        <button type="button" className="btn btn-sm" onClick={openPicker}>
          ＋ материал
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
          ＋ новая позиция в базу
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {countIncluded(normalizedLines)} / {normalizedLines.length} {showQty ? "в спецификации" : "отмечено"}
        </span>
      </div>

      {normalizedLines.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, padding: "12px 0" }}>
          {emptyHint}
        </p>
      ) : (
        <div
          ref={pickerScrollRef}
          className="card spec-picker-wrap"
          style={{
            overflowX: "auto",
            padding: 0,
            ...(virtualizePicker
              ? { maxHeight: "min(68vh, 760px)", overflowY: "auto", WebkitOverflowScrolling: "touch" }
              : {}),
          }}
        >
          <table className="spec spec-picker">
            <thead className="virtual-table-head">
              <tr>
                <th style={{ width: 36 }} aria-label="Выбор" />
                <th style={{ width: 112 }}>Фото</th>
                <th style={{ width: 40 }} title="Включить в спецификацию">✓</th>
                <th style={{ minWidth: staticNames ? 220 : 200, maxWidth: staticNames ? 340 : undefined }}>Наименование</th>
                <th style={{ width: 120 }}>Категория</th>
                <th style={{ width: 110 }}>Поставщик</th>
                <th style={{ width: 72 }}>Ед.</th>
                {showCompositionGroups && <th style={{ width: 130 }}>Группа стеллажа</th>}
                {showFarmLineGroups && <th style={{ width: 130 }}>Группа раздела</th>}
                {showRoom && <th style={{ width: 130 }}>Комната</th>}
                {showQty && <th className="right" style={{ width: 96 }}>{qtyLabel}</th>}
                <th className="right" style={{ width: 110 }}>Цена, ₽</th>
                <th style={{ minWidth: 120 }}>Ссылка</th>
                <th style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {flatPickerRows.map((row) => {
                if (row.kind === "group") {
                  return (
                    <tr key={`g-${row.g}`}>
                      <td colSpan={colSpan} className="spec-group-head">
                        {groupTitle(row.g)}
                      </td>
                    </tr>
                  );
                }
                return <SpecPickerLineRow key={row.ln.id} ln={row.ln} {...lineRowProps} />;
              })}
            </tbody>
          </table>
        </div>
      )}

      {newOpen && (
        <Modal
          title="Новая позиция — сохранится в базу"
          onClose={() => !savingNew && setNewOpen(false)}
          footer={
            <>
              <button type="button" className="btn" disabled={savingNew} onClick={() => setNewOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" disabled={savingNew} onClick={createNewInBase}>
                {savingNew ? "Сохранение…" : "Сохранить и добавить"}
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Позиция попадёт в базу материалов ({catalogModule || "модуль"}) и сразу в эту спецификацию.
          </p>
          <div className="form-grid">
            <label className="full">
              Наименование *
              <input
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </label>
            <label>
              Ед.
              <input value={newForm.unit} onChange={(e) => setNewForm((f) => ({ ...f, unit: e.target.value }))} />
            </label>
            <label>
              Цена, ₽
              <input
                type="number"
                min={0}
                value={newForm.price}
                onChange={(e) => setNewForm((f) => ({ ...f, price: Number(e.target.value) || 0 }))}
              />
            </label>
            <label>
              Категория
              <select value={newForm.category} onChange={(e) => setNewForm((f) => ({ ...f, category: e.target.value }))}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Поставщик
              <select value={newForm.supplier || ""} onChange={(e) => setNewForm((f) => ({ ...f, supplier: e.target.value }))}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Ссылка
              <input value={newForm.link} onChange={(e) => setNewForm((f) => ({ ...f, link: e.target.value }))} />
            </label>
          </div>
        </Modal>
      )}

      {picker && (
        <Modal
          title="Добавить материалы из базы"
          onClose={() => setPicker(false)}
          footer={
            <>
              <span className="muted" style={{ fontSize: 12, marginRight: "auto" }}>
                Выбрано: <span className="num">{pickedIds.size}</span>
                {pickableCatalog.length > 0 && (
                  <> · доступно {pickableCatalog.length}</>
                )}
              </span>
              <button type="button" className="btn" onClick={() => setPicker(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pickedIds.size}
                onClick={addSelectedFromCatalog}
              >
                Добавить выбранные{pickedIds.size ? ` (${pickedIds.size})` : ""}
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
            Вся база ({materials.filter((m) => m.status === "active").length} поз.) — группы по категории
            (сантехника, крепёж, электрика…), внутри группы свежие изменения сверху.
          </p>
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <input
              placeholder="Поиск: название, модуль, категория, поставщик…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: "1 1 200px", minWidth: 180 }}
              autoFocus
            />
            <button type="button" className="btn btn-sm" onClick={selectAllPickable} disabled={!pickableCatalog.length}>
              Все видимые
            </button>
            <button type="button" className="btn btn-sm" onClick={clearPicked} disabled={!pickedIds.size}>
              Снять выбор
            </button>
          </div>
          <div ref={catalogScrollRef} className="material-picker-list">
            {catalogFlatRows.length === 0 ? (
              <p className="muted" style={{ padding: 12 }}>
                Ничего не найдено
              </p>
            ) : (
              <table className="spec material-picker-table" style={{ width: "100%" }}>
                <tbody>
                  {catalogFlatRows.map((row) => {
                    if (row.kind === "cat") {
                      return (
                        <tr key={`cat-${row.catName}`} className="material-picker-cat-row">
                          <td colSpan={5} className="material-picker-group__title">
                            {row.catName}
                            <span className="muted num" style={{ fontWeight: 400, marginLeft: 8 }}>
                              {row.count}
                            </span>
                          </td>
                        </tr>
                      );
                    }
                    const m = row.m;
                    const added = existingMaterialIds.has(m.id);
                    return (
                      <CatalogPickerMaterialRow
                        key={m.id}
                        m={m}
                        added={added}
                        picked={pickedIds.has(m.id)}
                        onTogglePick={togglePick}
                        onAddOne={addFromCatalog}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
