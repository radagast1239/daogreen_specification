import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { CATEGORIES } from "../../data/modules.js";
import { resolveCategories } from "../../lib/categories.js";
import { isFlowSpecName } from "../../lib/materialSpecs.js";
import { api, photoSrc } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Modal, Empty } from "../../components/ui.jsx";
import { RowActionsMenu } from "../../components/modulesUi.jsx";
import { useToast } from "../../components/Toast.jsx";
import ImportPanel from "../../components/ImportPanel.jsx";
import CompactTableToggle from "../../components/CompactTableToggle.jsx";
import { downloadCSV } from "../../lib/exportDownload.js";
import { materialSpecSubtitle, hasStructuredSpecEditor } from "../../lib/materialDisplay.js";
import StructuredSpecEditor from "../../components/StructuredSpecEditor.jsx";
import MaterialModulesEditor from "../../components/MaterialModulesEditor.jsx";
import MaterialFarmSectionsEditor from "../../components/MaterialFarmSectionsEditor.jsx";
import PhotoUploadField from "../../components/PhotoUploadField.jsx";
import {
  normalizeMaterialModules,
  patchMaterialModules,
  resolveMaterialModules,
} from "../../../shared/materialModules.js";
import {
  patchMaterialFarmSections,
  resolveMaterialFarmSections,
} from "../../../shared/materialFarmSections.js";
import {
  clientSectionLabel,
  suggestClientSectionFromCategory,
  suggestClientSubsectionFromCategory,
  isMiscCategory,
  getClientSections,
  subsectionsForSection,
  isSubsectionValid,
  getClientSectionLabel,
} from "../../../shared/clientSections.js";
import { buildBulkPatchPayload, formatBulkActionConfirmation } from "../../../shared/materialBulkActions.js";
import { materialShownToClientByDefault } from "../../../shared/materialQualityCheck.js";
import { MaterialsQualityPanel } from "./MaterialsQualityPage.jsx";
import MaterialsSubnav from "../../components/MaterialsSubnav.jsx";
import { resolveFarmSections } from "../../lib/farmSectionsConfig.js";
import { DEFAULT_RESPONSIBLE_ROLES } from "../../lib/responsibleRoles.js";
import {
  CATALOG_COLUMN_PRESETS,
  CATALOG_QUICK_FILTERS,
  CATALOG_SORT_OPTIONS,
  buildQualityEntryMap,
  catalogColumnVisibility,
  catalogHasActiveFilters,
  filterMaterialsCatalog,
  materialCatalogStatusChips,
  materialHasPhoto,
  materialPriceMissing,
  materialsEmptyMessage,
  sortMaterialsCatalog,
} from "../../lib/materialsCatalogView.js";
const blank = {
  name: "",
  unit: "шт.",
  basePrice: 0,
  defaultQty: 0,
  module: "",
  modules: [],
  category: "Прочее",
  subcategory: "",
  clientSection: "",
  clientSubsection: "",
  farmSectionId: "",
  farmSections: [],
  itemType: "material",
  supplier: "",
  responsible: "general",
  link: "",
  linkAlt: "",
  imageUrl: "",
  photoUrl: "",
  vatRate: 0,
  vatIncluded: false,
  clientNote: "",
  pipeCuts: [],
  breakerSpecs: [],
  flowSpecs: [],
  splitSpecs: [],
  techNote: "",
  status: "active",
  needsApproval: false,
  clientVisibleDefault: true,
  coolingKw: 0,
  coolingBtu: 0,
  exhaustM3: 0,
  tags: [],
  alternativeMaterialId: "",
  minOrderQty: 0,
  orderStep: 1,
};

export default function MaterialsPage() {
  const { state, actions } = useStore();
  const ref = state.reference;
  const { confirm, success } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = ["import", "duplicates", "quality"].includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : "base";
  const setTab = (t) => setSearchParams(t === "base" ? {} : { tab: t });
  const [q, setQ] = useState("");
  const [catF, setCatF] = useState("");
  const [quickF, setQuickF] = useState("all");
  const [sortF, setSortF] = useState("name");
  const [colPreset, setColPreset] = useState("main");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkSubValue, setBulkSubValue] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [editing, setEditing] = useState(null);
  const [priceDraft, setPriceDraft] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([...CATEGORIES]);
  const [farmSections, setFarmSections] = useState([]);
  useEffect(() => {
    Promise.all([api.getSuppliers(), api.getSettings()]).then(([sup, settings]) => {
      setSuppliers(sup);
      setCategories(resolveCategories(settings));
      setFarmSections(resolveFarmSections(settings));
    });
  }, []);

  const activeModules = useMemo(
    () =>
      state.modules
        .filter((mod) => mod.active !== false)
        .map((mod) => mod.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ru")),
    [state.modules]
  );

  const { entriesById } = useMemo(
    () => buildQualityEntryMap(state.materials, state.modules),
    [state.materials, state.modules]
  );

  const colVis = useMemo(() => catalogColumnVisibility(colPreset), [colPreset]);

  const filtersActive = catalogHasActiveFilters({ q, category: catF, quick: quickF });

  const filtered = useMemo(() => {
    const list = filterMaterialsCatalog(state.materials, {
      q,
      category: catF,
      quick: quickF,
      entriesById,
    });
    return sortMaterialsCatalog(list, sortF);
  }, [state.materials, q, catF, quickF, sortF, entriesById]);

  const emptyMsg = materialsEmptyMessage({
    sourceCount: state.materials.length,
    visibleCount: filtered.length,
    hasFilters: filtersActive,
  });

  const resetFilters = () => {
    setQ("");
    setCatF("");
    setQuickF("all");
    setSortF("name");
  };

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelectedIds(new Set(filtered.map((m) => m.id)));
  };

  const applyCatalogBulk = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    const msg = formatBulkActionConfirmation(bulkAction, bulkValue, bulkSubValue, selectedIds.size);
    if (!(await confirm({ title: "Применить массовое действие?", message: msg }))) return;
    setBulkApplying(true);
    const payload = buildBulkPatchPayload(bulkAction, bulkValue, bulkSubValue);
    let ok = 0;
    for (const id of selectedIds) {
      try {
        await actions.materialUpdate(id, payload);
        ok += 1;
      } catch {
        /* continue */
      }
    }
    setBulkApplying(false);
    if (ok > 0) {
      success(`Успешно обновлено: ${ok}`);
      setSelectedIds(new Set());
      setBulkAction("");
      setBulkValue("");
      setBulkSubValue("");
    }
  };

  const patchMaterialFlags = async (id, patch) => {
    await actions.materialUpdate(id, patch);
    success("Сохранено");
  };
  const clientSectionOptions = useMemo(() => {
    const fromRef = state.reference?.clientSections?.filter((s) => !s.hidden);
    if (fromRef?.length) return fromRef;
    return getClientSections();
  }, [state.reference?.clientSections]);

  const subsectionOptions = useMemo(() => {
    const sectionId = editing?.clientSection;
    if (!sectionId) return [];
    const fromRef = state.reference?.clientSections?.find((s) => s.id === sectionId);
    if (fromRef?.subsections?.length) return fromRef.subsections;
    return subsectionsForSection(sectionId);
  }, [editing?.clientSection, state.reference?.clientSections]);

  const subsectionMismatch = useMemo(() => {
    const sectionId = editing?.clientSection;
    const sub = editing?.clientSubsection;
    if (!sectionId || !sub) return false;
    return !isSubsectionValid(sectionId, sub);
  }, [editing?.clientSection, editing?.clientSubsection]);

  const purchaseListPreview = useMemo(() => {
    if (!editing) return "";
    const sectionLabel = getClientSectionLabel(editing.clientSection) || clientSectionLabel(editing);
    if (editing.clientSubsection) return `${sectionLabel} → ${editing.clientSubsection}`;
    return sectionLabel;
  }, [editing]);

  const openMaterialEdit = (id) => {
    const m = state.materials.find((x) => x.id === id);
    if (!m) return;
    setEditing(
      patchMaterialFarmSections(
        patchMaterialModules({ ...m }, resolveMaterialModules(m)),
        resolveMaterialFarmSections(m)
      )
    );
  };

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId || !state.materials.length) return;
    openMaterialEdit(editId);
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  }, [searchParams, state.materials]);

  const patchMaterialFromQuality = async (id, patch) => {
    await actions.materialUpdate(id, patch);
    success("Изменения сохранены");
  };

  const save = async () => {
    if (!editing.name?.trim()) return;
    const mods = normalizeMaterialModules(editing.modules ?? editing.module).filter((m) =>
      activeModules.includes(m)
    );
    const payload = patchMaterialFarmSections(
      patchMaterialModules({ ...editing, defaultQty: 0, responsible: editing.responsible || "general" }, mods),
      editing.farmSections ?? resolveMaterialFarmSections(editing)
    );
    if (payload.id) await actions.materialUpdate(payload.id, payload);
    else await actions.materialAdd(payload);
    setEditing(null);
  };

  const patchPrice = async (id, basePrice) => {
    await actions.materialUpdate(id, { basePrice: Number(basePrice) || 0 });
    setPriceDraft((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  };

  const exportAll = () =>
    downloadCSV(
      "База_материалов_Daogreen",
      state.materials.map((m) => ({
        Наименование: m.name,
        Ед: m.unit,
        Цена: m.basePrice,
        Категория: m.category,
        Поставщик: m.supplier,
        Ссылка: m.link,
      }))
    );

  return (
    <div className="materials-page">
      <PageHeader
        title="Материалы"
        sub={`База материалов, цены, поставщики и готовность к проектам · ${state.materials.length} поз.`}
        back={{ to: "/", label: "Проекты" }}
        actions={
          tab === "base" ? (
            <>
              <CompactTableToggle />
              <Link className="btn btn-sm" to="/materials?tab=quality">
                Проверка качества
              </Link>
              <button type="button" className="btn" onClick={exportAll}>
                Excel ↓
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...blank })}>
                ＋ Позиция
              </button>
            </>
          ) : null
        }
      />
      <div className="content">
        <MaterialsSubnav />

        {tab === "import" ? (
          <div style={{ marginTop: 16 }}>
            <ImportPanel />
          </div>
        ) : tab === "duplicates" ? (
          <DuplicatesTab materials={state.materials} onMerged={() => actions.refreshMaterials()} />
        ) : tab === "quality" ? (
          <div style={{ marginTop: 16 }}>
            <MaterialsQualityPanel
              materials={state.materials}
              modules={state.modules}
              suppliers={suppliers}
              onEditMaterial={openMaterialEdit}
              onPatchMaterial={patchMaterialFromQuality}
            />
          </div>
        ) : (
          <>
        <div className="materials-catalog-filters no-print">
          <input
            placeholder="Поиск…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="materials-catalog-filters__search"
          />
          <select value={catF} onChange={(e) => setCatF(e.target.value)}>
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={sortF} onChange={(e) => setSortF(e.target.value)}>
            {CATALOG_SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={colPreset} onChange={(e) => setColPreset(e.target.value)}>
            {CATALOG_COLUMN_PRESETS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="materials-catalog-filters__quick">
            {CATALOG_QUICK_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={"btn btn-sm" + (quickF === f.id ? " btn-primary" : " btn-ghost")}
                onClick={() => setQuickF(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="muted materials-catalog-filters__count">
            {filtersActive
              ? `Найдено: ${filtered.length} из ${state.materials.length}`
              : `${filtered.length} из ${state.materials.length}`}
          </span>
          {filtersActive && (
            <button type="button" className="btn btn-sm" onClick={resetFilters}>
              Сбросить фильтры
            </button>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="materials-bulk-bar no-print">
            <strong>Выбрано: {selectedIds.size}</strong>
            <button type="button" className="btn btn-sm btn-ghost" onClick={selectVisible}>
              Выбрать видимые
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Снять выбор
            </button>
            <select
              value={bulkAction}
              onChange={(e) => {
                setBulkAction(e.target.value);
                setBulkValue("");
                setBulkSubValue("");
              }}
              disabled={bulkApplying}
            >
              <option value="">— Действие —</option>
              <option value="responsible">Ответственный</option>
              <option value="supplier">Поставщик</option>
              <option value="clientSection">Раздел клиента</option>
              <option value="showClient">Показать клиенту</option>
              <option value="hideClient">Скрыть от клиента</option>
              <option value="setReview">На проверку</option>
              <option value="clearReview">Снять проверку</option>
            </select>
            {bulkAction === "responsible" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} disabled={bulkApplying}>
                <option value="">Общий</option>
                {DEFAULT_RESPONSIBLE_ROLES.filter((r) => r.id !== "general").map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
            {bulkAction === "supplier" && (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} disabled={bulkApplying}>
                <option value="">Без поставщика</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {bulkAction === "clientSection" && (
              <>
                <select
                  value={bulkValue}
                  onChange={(e) => {
                    setBulkValue(e.target.value);
                    setBulkSubValue("");
                  }}
                  disabled={bulkApplying}
                >
                  <option value="">— Раздел —</option>
                  {clientSectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {bulkValue && subsectionsForSection(bulkValue).length > 0 && (
                  <select
                    value={bulkSubValue}
                    onChange={(e) => setBulkSubValue(e.target.value)}
                    disabled={bulkApplying}
                  >
                    <option value="">— Подраздел —</option>
                    {subsectionsForSection(bulkValue).map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!bulkAction || bulkApplying}
              onClick={applyCatalogBulk}
            >
              {bulkApplying ? "…" : "Применить"}
            </button>
          </div>
        )}

        {emptyMsg ? (
          <Empty title={emptyMsg.title} hint={emptyMsg.hint}>
            {emptyMsg.cta === "reset" ? (
              <button type="button" className="btn" onClick={resetFilters}>
                Сбросить фильтры
              </button>
            ) : emptyMsg.cta === "create" ? (
              <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...blank })}>
                Добавить первый материал
              </button>
            ) : null}
          </Empty>
        ) : (
          <div className="card table-scroll-wrap materials-table-wrap">
            <table className="spec materials-table">
              <thead className="materials-table-head">
                <tr>
                  <th className="materials-col-check">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((m) => selectedIds.has(m.id))}
                      onChange={(e) => {
                        if (e.target.checked) selectVisible();
                        else setSelectedIds(new Set());
                      }}
                      aria-label="Выбрать все видимые"
                    />
                  </th>
                  <th>Фото</th>
                  <th>Наименование</th>
                  <th>Категория</th>
                  <th>Ед</th>
                  <th className="right">Цена</th>
                  {colVis.supplier && <th>Поставщик</th>}
                  {colVis.state && <th>Состояние</th>}
                  {colVis.link && <th>Ссылка</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <MaterialRow
                    key={m.id}
                    m={m}
                    entry={entriesById.get(m.id)}
                    colVis={colVis}
                    selected={selectedIds.has(m.id)}
                    onToggleSelect={() => toggleSelected(m.id)}
                    priceDraft={priceDraft}
                    setPriceDraft={setPriceDraft}
                    patchPrice={patchPrice}
                    onEdit={() => openMaterialEdit(m.id)}
                    onPatch={patchMaterialFlags}
                    onDelete={async () => {
                      if (
                        await confirm({
                          title: "Удалить позицию?",
                          message: m.name,
                          confirmLabel: "Удалить",
                        })
                      )
                        actions.materialDelete(m.id);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
          </>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? "Редактировать позицию" : "Новая позиция"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={save}>
                Сохранить
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Это справочник. Количество для сметы выбирается при сборке проекта.
          </p>
          <div className="field">
            <label>Наименование *</label>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Цена, ₽</label>
              <input
                type="number"
                value={editing.basePrice}
                onChange={(e) => setEditing({ ...editing, basePrice: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>Единица</label>
              <select value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}>
                {ref.units.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Категория (внутренняя)</label>
              <select
                value={editing.category}
                onChange={(e) => {
                  const category = e.target.value;
                  const patch = { category };
                  if (!editing.clientSection) {
                    patch.clientSection = suggestClientSectionFromCategory(category);
                    patch.clientSubsection = suggestClientSubsectionFromCategory(category);
                  }
                  setEditing({ ...editing, ...patch });
                }}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Раздел для клиента</label>
              <select
                value={editing.clientSection || ""}
                onChange={(e) => {
                  const clientSection = e.target.value;
                  const subs = subsectionsForSection(clientSection);
                  const patch = { clientSection };
                  if (editing.clientSubsection && !subs.includes(editing.clientSubsection)) {
                    patch.clientSubsection = "";
                  }
                  setEditing({ ...editing, ...patch });
                }}
              >
                <option value="">— авто (из категории / названия) —</option>
                {clientSectionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
                Список разделов — в <a href="/settings">Настройках</a>
              </p>
            </div>
            <div className="field">
              <label>Подраздел для клиента</label>
              <select
                value={editing.clientSubsection || ""}
                disabled={!editing.clientSection}
                onChange={(e) => setEditing({ ...editing, clientSubsection: e.target.value })}
              >
                <option value="">— не выбран —</option>
                {subsectionOptions.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
              {subsectionMismatch && (
                <p style={{ color: "var(--danger)", fontSize: 12, margin: "4px 0 0" }}>
                  Подраздел не относится к выбранному разделу — выберите из списка.
                </p>
              )}
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
            В закупочном листе: <strong>{purchaseListPreview || "—"}</strong>
            {editing.category === "Прочее" && isMiscCategory(editing) && (
              <span style={{ color: "var(--danger)", display: "block", marginTop: 4 }}>
                Категория «Прочее» — укажите раздел для клиента, иначе публикация заблокирована.
              </span>
            )}
          </p>
          <MaterialFarmSectionsEditor
            value={editing}
            farmSections={farmSections}
            onChange={(farmSections) => setEditing(patchMaterialFarmSections(editing, farmSections))}
          />
          <details className="legacy-field-block" style={{ marginTop: 8 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
              Служебное: старые модули (не для сборки)
            </summary>
            <div style={{ marginTop: 10 }}>
              <MaterialModulesEditor
                legacy
                value={editing.modules ?? editing.module}
                activeModules={activeModules}
                archivedModules={resolveMaterialModules(editing).filter((m) => !activeModules.includes(m))}
                onChange={(modules) => setEditing(patchMaterialModules(editing, modules))}
              />
            </div>
          </details>
          <div className="field">
            <label>Поставщик</label>
            <select value={editing.supplier || ""} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })}>
              <option value="">— не выбран —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              <a href="/suppliers">Создать поставщика</a>
            </p>
          </div>
          <div className="field">
            <label>Ответственный по умолчанию</label>
            <select
              value={editing.responsible || "general"}
              onChange={(e) => setEditing({ ...editing, responsible: e.target.value })}
            >
              <option value="general">Не назначено / Общее</option>
              {DEFAULT_RESPONSIBLE_ROLES.filter((r) => r.id !== "general").map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              Копируется в позицию при добавлении материала в проект. Старые проекты не меняются.
            </p>
          </div>
          {!isFlowSpecName(editing.name) && (
            <div className="field">
              <label>Ссылка на товар</label>
              <input value={editing.link} onChange={(e) => setEditing({ ...editing, link: e.target.value })} />
            </div>
          )}
          <PhotoUploadField
            label="Фото"
            value={editing.imageUrl || editing.photoUrl || ""}
            pasteAnywhere
            onChange={(url) => setEditing({ ...editing, imageUrl: url, photoUrl: url })}
          />
          <div className="field">
            <label>НДС, %</label>
            <select value={editing.vatRate || 0} onChange={(e) => setEditing({ ...editing, vatRate: Number(e.target.value) })}>
              <option value={0}>0%</option>
              <option value={5}>5%</option>
              <option value={20}>20%</option>
            </select>
          </div>
          {hasStructuredSpecEditor(editing.name) ? (
            <StructuredSpecEditor
              name={editing.name}
              values={editing}
              onChange={(patch) => setEditing({ ...editing, ...patch })}
            />
          ) : (
            <div className="field">
              <label>Пояснение клиенту</label>
              <textarea rows={2} value={editing.clientNote} onChange={(e) => setEditing({ ...editing, clientNote: e.target.value })} />
            </div>
          )}
          <div className="form-grid">
            <div className="field">
              <label>Мин. заказ</label>
              <input
                type="number"
                min={0}
                value={editing.minOrderQty || ""}
                onChange={(e) => setEditing({ ...editing, minOrderQty: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>Кратность</label>
              <input
                type="number"
                min={1}
                step={1}
                value={editing.orderStep || 1}
                onChange={(e) => setEditing({ ...editing, orderStep: Number(e.target.value) || 1 })}
              />
            </div>
          </div>
          <div className="field">
            <label>Альтернатива (если нет в наличии)</label>
            <select
              value={editing.alternativeMaterialId || ""}
              onChange={(e) => setEditing({ ...editing, alternativeMaterialId: e.target.value })}
            >
              <option value="">— не задана —</option>
              {state.materials
                .filter((m) => m.id !== editing.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
            </select>
          </div>
          {editing.id && <PriceHistoryBlock materialId={editing.id} />}
        </Modal>
      )}
    </div>
  );
}

const MaterialRow = function MaterialRow({
  m,
  entry,
  colVis,
  selected,
  onToggleSelect,
  priceDraft,
  setPriceDraft,
  patchPrice,
  onEdit,
  onPatch,
  onDelete,
}) {
  const nav = useNavigate();
  const hasPhoto = materialHasPhoto(m);
  const priceWarn = materialPriceMissing(m);
  const statusChips = materialCatalogStatusChips(entry, m);
  const shown = materialShownToClientByDefault(m);
  const menuItems = [
    {
      id: "client-vis",
      label: shown ? "Скрыть от клиента" : "Показать клиенту",
      onClick: () => onPatch(m.id, buildBulkPatchPayload(shown ? "hideClient" : "showClient")),
    },
    {
      id: "review",
      label: "Пометить на проверку",
      onClick: () => onPatch(m.id, buildBulkPatchPayload("setReview")),
    },
    m.supplier
      ? {
          id: "supplier",
          label: "Открыть поставщиков",
          onClick: () => nav("/suppliers"),
        }
      : null,
    { id: "sep", separator: true },
    {
      id: "delete",
      label: "Удалить",
      danger: true,
      onClick: onDelete,
    },
  ];

  return (
    <tr className={"material-row" + (selected ? " material-row--selected" : "")}>
      <td className="materials-col-check">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Выбрать ${m.name}`} />
      </td>
      <td className="spec-photo">
        {hasPhoto ? (
          <img src={photoSrc(m.imageUrl || m.photoUrl)} alt="" className="thumb-img materials-thumb" />
        ) : (
          <span className="materials-photo-placeholder muted">Нет фото</span>
        )}
      </td>
      <td className="material-name">
        <div className="materials-name-title">{m.name}</div>
        {materialSpecSubtitle(m) && (
          <div className="muted materials-name-sub">{materialSpecSubtitle(m)}</div>
        )}
        <div className="materials-name-badges">
          {statusChips
            .filter((c) => c.id !== "ready")
            .slice(0, 3)
            .map((c) => (
              <span key={c.id} className={`chip chip--${c.kind}`}>
                {c.label}
              </span>
            ))}
        </div>
      </td>
      <td className="muted materials-cell-cat">{m.category || "Прочее"}</td>
      <td>{m.unit}</td>
      <td className="right">
        <div className={"materials-price" + (priceWarn ? " materials-price--warn" : "")}>
          <input
            className="spec-cell-input spec-cell-input--num"
            type="number"
            min={0}
            value={priceDraft[m.id] ?? m.basePrice}
            onChange={(e) => setPriceDraft((d) => ({ ...d, [m.id]: e.target.value }))}
            onBlur={() => {
              if (priceDraft[m.id] == null) return;
              patchPrice(m.id, priceDraft[m.id]);
            }}
          />
          <span className="muted materials-price-unit">₽ / {m.unit || "ед."}</span>
          {priceWarn && <span className="materials-price-hint">Нет цены</span>}
        </div>
      </td>
      {colVis.supplier && (
        <td className="materials-cell-supplier">
          {m.supplier ? m.supplier : <span className="muted">Не указан</span>}
        </td>
      )}
      {colVis.state && (
        <td className="materials-cell-state">
          <div className="materials-state-chips">
            {statusChips.map((c) => (
              <span key={c.id} className={`chip chip--${c.kind}`}>
                {c.label}
              </span>
            ))}
          </div>
        </td>
      )}
      {colVis.link && (
        <td>
          {m.link ? (
            <a href={m.link} target="_blank" rel="noreferrer" className="materials-link">
              ↗
            </a>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      )}
      <td className="materials-row-actions">
        <button type="button" className="btn btn-sm" onClick={onEdit}>
          Редактировать
        </button>
        <RowActionsMenu items={menuItems} label="Действия материала" />
      </td>
    </tr>
  );
};

function PriceHistoryBlock({ materialId }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.getPriceHistory(materialId).then(setRows).catch(() => setRows([]));
  }, [materialId]);

  if (!rows?.length) return null;

  return (
    <div className="field">
      <label>История цен</label>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }} className="muted">
        {rows.slice(0, 8).map((r, i) => (
          <li key={`${r.createdAt}-${i}`}>
            {r.oldPrice} → {r.newPrice} ₽ · {new Date(r.createdAt).toLocaleDateString("ru-RU")}
            {r.changedBy ? ` · ${r.changedBy}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DuplicatesTab({ materials, onMerged }) {
  const { confirm, success, error } = useToast();
  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .getDuplicates()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const nameById = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m.name])), [materials]);

  const merge = async (keepId, group) => {
    const others = group.items.filter((x) => x.id !== keepId);
    const keepName = nameById[keepId] || keepId;
    if (
      !(await confirm({
        title: "Слить дубликаты?",
        message: `Оставить «${keepName}», удалить ${others.length} дублик.`,
        confirmLabel: "Слить",
      }))
    )
      return;
    try {
      for (const dup of others) {
        await api.mergeMaterials(keepId, dup.id);
      }
      success("Дубликаты объединены");
      load();
      onMerged?.();
    } catch (e) {
      error(e.message);
    }
  };

  if (loading) return <p className="muted" style={{ marginTop: 16 }}>Поиск дубликатов…</p>;
  if (!groups?.length) return <Empty title="Дубликаты не найдены" hint="Одинаковые названия появятся здесь." />;

  return (
    <div style={{ marginTop: 16 }}>
      <p className="muted" style={{ fontSize: 13 }}>Группы с одинаковым названием. Выберите, какую позицию оставить.</p>
      {groups.map((g) => (
        <div key={g.key} className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>{g.items[0]?.name}</div>
          {g.items.map((it) => (
            <div key={it.id} className="row between" style={{ fontSize: 13, marginBottom: 6 }}>
              <span>
                {it.module} · {it.supplier || "—"} · {it.base_price} ₽
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={() => merge(it.id, g)}>
                  Оставить эту
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
