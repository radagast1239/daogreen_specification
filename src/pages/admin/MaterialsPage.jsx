import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { CATEGORIES } from "../../data/modules.js";
import { resolveCategories } from "../../lib/categories.js";
import { isFlowSpecName } from "../../lib/materialSpecs.js";
import { api, photoSrc } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Modal, Empty } from "../../components/ui.jsx";
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
import { MaterialsQualityPanel } from "./MaterialsQualityPage.jsx";
import MaterialsSubnav from "../../components/MaterialsSubnav.jsx";
import { resolveFarmSections } from "../../lib/farmSectionsConfig.js";
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

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return state.materials
      .filter(
        (m) =>
          (!ql || m.name.toLowerCase().includes(ql)) && (!catF || m.category === catF)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [state.materials, q, catF]);

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
      patchMaterialModules({ ...editing, defaultQty: 0 }, mods),
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
        sub="Справочник позиций, цен и импорт из Excel"
        back={{ to: "/", label: "Проекты" }}
        actions={
          tab === "base" ? (
            <>
              <CompactTableToggle />
              <button className="btn" onClick={exportAll}>
                Excel ↓
              </button>
              <button className="btn btn-primary" onClick={() => setEditing({ ...blank })}>
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
              onEditMaterial={openMaterialEdit}
              onPatchMaterial={patchMaterialFromQuality}
            />
          </div>
        ) : (
          <>
        <div className="toolbar" style={{ marginTop: 16 }}>
          <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          <select value={catF} onChange={(e) => setCatF(e.target.value)} style={{ width: "auto" }}>
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="muted" style={{ marginLeft: "auto" }}>
            {filtered.length} найдено
          </span>
        </div>

        {filtered.length === 0 ? (
          <Empty title="Ничего не найдено" />
        ) : (
          <div className="card table-scroll-wrap materials-table-wrap">
            <table className="spec materials-table">
              <thead className="materials-table-head">
                <tr>
                  <th>Фото</th>
                  <th>Наименование</th>
                  <th>Категория</th>
                  <th>Ед</th>
                  <th className="right">Цена, ₽</th>
                  <th>Ссылка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <MaterialRow
                    key={m.id}
                    m={m}
                    priceDraft={priceDraft}
                    setPriceDraft={setPriceDraft}
                    patchPrice={patchPrice}
                    onEdit={() => openMaterialEdit(m.id)}
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

const MaterialRow = function MaterialRow({ m, priceDraft, setPriceDraft, patchPrice, onEdit, onDelete }) {
  return (
    <tr className="material-row">
      <td className="spec-photo">
        {m.imageUrl || m.photoUrl ? (
          <img src={photoSrc(m.imageUrl || m.photoUrl)} alt="" className="thumb-img" />
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>
            нет фото
          </span>
        )}
      </td>
      <td style={{ minWidth: 220 }} className="material-name">
        {m.name}
        {materialSpecSubtitle(m) && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4, fontWeight: 400 }}>
            {materialSpecSubtitle(m)}
          </div>
        )}
      </td>
      <td className="muted" style={{ fontSize: 12 }}>
        {m.category || "Прочее"}
      </td>
      <td>{m.unit}</td>
      <td className="right">
        <input
          className="spec-cell-input spec-cell-input--num"
          style={{ maxWidth: 110, marginLeft: "auto" }}
          type="number"
          min={0}
          value={priceDraft[m.id] ?? m.basePrice}
          onChange={(e) => setPriceDraft((d) => ({ ...d, [m.id]: e.target.value }))}
          onBlur={() => {
            if (priceDraft[m.id] == null) return;
            patchPrice(m.id, priceDraft[m.id]);
          }}
        />
      </td>
      <td>
        {m.link ? (
          <a href={m.link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
            ↗
          </a>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="row" style={{ gap: 2 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          ✎
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete}>
          ✕
        </button>
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
