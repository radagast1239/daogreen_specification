import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { CATEGORIES } from "../../data/modules.js";
import { resolveCategories } from "../../lib/categories.js";
import { isExhaustFanName, isSplitSystemName } from "../../lib/materialSpecs.js";
import { api, photoSrc } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Modal, Empty } from "../../components/ui.jsx";
import { useToast } from "../../components/Toast.jsx";
import ImportPanel from "../../components/ImportPanel.jsx";
import CompactTableToggle from "../../components/CompactTableToggle.jsx";
import { downloadCSV } from "../../lib/export.js";
import { profilePipeSubtitle } from "../../lib/materialDisplay.js";
import ProfilePipeCutsEditor from "../../components/ProfilePipeCutsEditor.jsx";
import { isProfilePipeName } from "../../../shared/profilePipeCuts.js";

const ITEM_TYPES = [
  ["material", "Материал"],
  ["equipment", "Оборудование"],
  ["consumable", "Расходник"],
  ["work", "Работа"],
  ["delivery", "Доставка"],
];

const TAG_PRESETS = []; // unused — see tagPresets prop

const blank = {
  name: "",
  unit: "шт.",
  basePrice: 0,
  defaultQty: 0,
  module: "Общая закупка на ферму",
  category: "Прочее",
  subcategory: "",
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
  const tagPresets = ref.tags;
  const { confirm } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = ["import", "duplicates"].includes(searchParams.get("tab")) ? searchParams.get("tab") : "base";
  const setTab = (t) => setSearchParams(t === "base" ? {} : { tab: t });
  const [q, setQ] = useState("");
  const [modF, setModF] = useState("");
  const [catF, setCatF] = useState("");
  const [editing, setEditing] = useState(null);
  const [priceDraft, setPriceDraft] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([...CATEGORIES]);

  useEffect(() => {
    Promise.all([api.getSuppliers(), api.getSettings()]).then(([sup, settings]) => {
      setSuppliers(sup);
      setCategories(resolveCategories(settings));
    });
  }, []);

  const modules = useMemo(() => {
    const names = new Set();
    for (const mod of state.modules) names.add(mod.name);
    for (const m of state.materials) if (m.module) names.add(m.module);
    return [...names].sort((a, b) => a.localeCompare(b, "ru"));
  }, [state.modules, state.materials]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return state.materials.filter(
      (m) =>
        (!ql || m.name.toLowerCase().includes(ql)) &&
        (!modF || m.module === modF) &&
        (!catF || m.category === catF)
    );
  }, [state.materials, q, modF, catF]);

  const save = async () => {
    if (!editing.name?.trim()) return;
    const payload = { ...editing, defaultQty: 0 };
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
        Модуль: m.module,
        Категория: m.category,
        Поставщик: m.supplier,
        Ссылка: m.link,
      }))
    );

  return (
    <>
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
        <div className="toolbar" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 0, gap: 0 }}>
          {[
            ["base", "База"],
            ["import", "Импорт"],
            ["duplicates", "Дубликаты"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="btn btn-ghost"
              style={{
                borderRadius: 0,
                borderBottom: tab === k ? "2px solid var(--brand)" : "2px solid transparent",
                color: tab === k ? "var(--brand)" : "var(--muted)",
              }}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "import" ? (
          <div style={{ marginTop: 16 }}>
            <ImportPanel />
          </div>
        ) : tab === "duplicates" ? (
          <DuplicatesTab materials={state.materials} onMerged={() => actions.refresh()} />
        ) : (
          <>
        <div className="toolbar" style={{ marginTop: 16 }}>
          <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          <select value={modF} onChange={(e) => setModF(e.target.value)} style={{ width: "auto" }}>
            <option value="">Все модули</option>
            {modules.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
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
          <div className="card" style={{ overflowX: "auto", padding: "4px 8px 12px" }}>
            <table className="spec materials-table">
              <thead>
                <tr>
                  <th>Фото</th>
                  <th>Наименование</th>
                  <th>Модуль</th>
                  <th>Ед</th>
                  <th className="right">Цена, ₽</th>
                  <th>Ссылка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="material-row">
                    <td className="spec-photo">
                      {(m.imageUrl || m.photoUrl) ? (
                        <img src={photoSrc(m.imageUrl || m.photoUrl)} alt="" className="thumb-img" />
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>нет фото</span>
                      )}
                    </td>
                    <td style={{ minWidth: 220 }} className="material-name">
                      {m.name}
                      {profilePipeSubtitle(m) && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 4, fontWeight: 400 }}>
                          {profilePipeSubtitle(m)}
                        </div>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.module}</td>
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
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...m })}>
                        ✎
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          if (await confirm({ title: "Удалить позицию?", message: m.name, confirmLabel: "Удалить" }))
                            actions.materialDelete(m.id);
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
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
              <label>Категория</label>
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Тип</label>
              <select value={editing.itemType} onChange={(e) => setEditing({ ...editing, itemType: e.target.value })}>
                {ITEM_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Модуль / раздел</label>
            <select value={editing.module} onChange={(e) => setEditing({ ...editing, module: e.target.value })}>
              {modules.map((modName) => (
                <option key={modName} value={modName}>{modName}</option>
              ))}
            </select>
          </div>
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
          {(isSplitSystemName(editing.name) || isExhaustFanName(editing.name)) && (
            <div className="form-grid">
              {isSplitSystemName(editing.name) && (
                <>
                  <div className="field">
                    <label>Охлаждение, кВт</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={editing.coolingKw || ""}
                      onChange={(e) => setEditing({ ...editing, coolingKw: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="field">
                    <label>BTU</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={editing.coolingBtu || ""}
                      onChange={(e) => setEditing({ ...editing, coolingBtu: Number(e.target.value) || 0 })}
                    />
                  </div>
                </>
              )}
              {isExhaustFanName(editing.name) && (
                <div className="field">
                  <label>Производительность, м³/ч</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={editing.exhaustM3 || ""}
                    onChange={(e) => setEditing({ ...editing, exhaustM3: Number(e.target.value) || 0 })}
                  />
                </div>
              )}
            </div>
          )}
          <div className="field">
            <label>Ссылка на товар</label>
            <input value={editing.link} onChange={(e) => setEditing({ ...editing, link: e.target.value })} />
          </div>
          <div className="field">
            <label>Фото</label>
            <input
              value={editing.imageUrl || editing.photoUrl || ""}
              onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value, photoUrl: e.target.value })}
              placeholder="URL или загрузите файл"
            />
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <label className="btn btn-sm">
                Загрузить файл
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const { url } = await api.uploadPhoto(file);
                    setEditing((ed) => ({ ...ed, imageUrl: url, photoUrl: url }));
                  }}
                />
              </label>
            </div>
            {(editing.imageUrl || editing.photoUrl) && (
              <img
                src={photoSrc(editing.imageUrl || editing.photoUrl)}
                alt=""
                className="thumb-img"
                style={{ marginTop: 8 }}
              />
            )}
          </div>
          <div className="field">
            <label>НДС, %</label>
            <select value={editing.vatRate || 0} onChange={(e) => setEditing({ ...editing, vatRate: Number(e.target.value) })}>
              <option value={0}>0%</option>
              <option value={5}>5%</option>
              <option value={20}>20%</option>
            </select>
          </div>
          {isProfilePipeName(editing.name) ? (
            <ProfilePipeCutsEditor
              name={editing.name}
              value={editing.pipeCuts}
              onChange={(patch) => setEditing({ ...editing, ...patch })}
            />
          ) : (
            <div className="field">
              <label>Пояснение клиенту</label>
              <textarea rows={2} value={editing.clientNote} onChange={(e) => setEditing({ ...editing, clientNote: e.target.value })} />
            </div>
          )}
          <TagsEditor editing={editing} setEditing={setEditing} tagPresets={tagPresets} />
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
    </>
  );
}

function TagsEditor({ editing, setEditing, tagPresets = [] }) {
  const [tagDraft, setTagDraft] = useState("");
  const tags = Array.isArray(editing.tags) ? editing.tags : [];

  const addTag = (raw) => {
    const t = raw.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    setEditing({ ...editing, tags: [...tags, t] });
    setTagDraft("");
  };

  return (
    <div className="field">
      <label>Теги</label>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        {tags.map((t) => (
          <span key={t} className="chip chip--neutral" style={{ gap: 4 }}>
            {t}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: "0 4px", minHeight: 0 }}
              onClick={() => setEditing({ ...editing, tags: tags.filter((x) => x !== t) })}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        {tagPresets.filter((p) => !tags.includes(p)).map((p) => (
          <button key={p} type="button" className="btn btn-sm btn-ghost" onClick={() => addTag(p)}>
            + {p}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input
          value={tagDraft}
          placeholder="свой тег"
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag(tagDraft))}
        />
        <button type="button" className="btn btn-sm" onClick={() => addTag(tagDraft)}>Добавить</button>
      </div>
    </div>
  );
}

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
