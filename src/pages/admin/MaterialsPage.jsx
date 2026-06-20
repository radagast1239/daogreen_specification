import React, { useMemo, useState } from "react";
import { useStore } from "../../store/StoreContext.jsx";
import { CATEGORIES } from "../../data/modules.js";
import { api, photoSrc } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Modal, Empty } from "../../components/ui.jsx";
import { downloadCSV } from "../../lib/export.js";

const ITEM_TYPES = [
  ["material", "Материал"],
  ["equipment", "Оборудование"],
  ["consumable", "Расходник"],
  ["work", "Работа"],
  ["delivery", "Доставка"],
];

const blank = {
  name: "",
  unit: "шт.",
  basePrice: 0,
  defaultQty: 1,
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
  techNote: "",
  status: "active",
  needsApproval: false,
  clientVisibleDefault: true,
};

export default function MaterialsPage() {
  const { state, actions } = useStore();
  const [q, setQ] = useState("");
  const [modF, setModF] = useState("");
  const [catF, setCatF] = useState("");
  const [editing, setEditing] = useState(null);

  const modules = [...new Set(state.materials.map((m) => m.module))];

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
    if (editing.id) await actions.materialUpdate(editing.id, editing);
    else await actions.materialAdd(editing);
    setEditing(null);
  };

  const exportAll = () =>
    downloadCSV(
      "База_материалов_Daogreen",
      state.materials.map((m) => ({
        Наименование: m.name,
        Ед: m.unit,
        Цена: m.basePrice,
        КолПоУмолч: m.defaultQty,
        Модуль: m.module,
        Категория: m.category,
        Поставщик: m.supplier,
        Ссылка: m.link,
      }))
    );

  return (
    <>
      <PageHeader
        title="База материалов"
        sub={`${state.materials.length} позиций · ${modules.length} модулей`}
        actions={
          <>
            <button className="btn" onClick={exportAll}>
              Excel ↓
            </button>
            <button className="btn btn-primary" onClick={() => setEditing({ ...blank })}>
              ＋ Материал
            </button>
          </>
        }
      />
      <div className="content">
        <div className="toolbar">
          <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          <select value={modF} onChange={(e) => setModF(e.target.value)} style={{ width: "auto" }}>
            <option value="">Все модули</option>
            {modules.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select value={catF} onChange={(e) => setCatF(e.target.value)} style={{ width: "auto" }}>
            <option value="">Все категории</option>
            {CATEGORIES.map((c) => (
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
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th></th>
                  <th>Наименование</th>
                  <th>Модуль</th>
                  <th>Категория</th>
                  <th>Ед</th>
                  <th className="right">Кол.</th>
                  <th className="right">Цена</th>
                  <th>Поставщик</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td style={{ width: 40 }}>
                      {(m.imageUrl || m.photoUrl) ? (
                        <img src={m.imageUrl || m.photoUrl} alt="" className="thumb-img" style={{ width: 32, height: 32 }} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ minWidth: 220 }}>{m.name}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {m.module}
                    </td>
                    <td>
                      <span className="tag-cat">{m.category}</span>
                    </td>
                    <td>{m.unit}</td>
                    <td className="right num">{m.defaultQty}</td>
                    <td className="right num">{money(m.basePrice)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {m.supplier || "—"}
                    </td>
                    <td className="row" style={{ gap: 2 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...m })}>
                        ✎
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => confirm("Удалить?") && actions.materialDelete(m.id)}
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
      </div>

      {editing && (
        <Modal
          title={editing.id ? "Редактировать" : "Новый материал"}
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
          <div className="field">
            <label>Наименование *</label>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Единица</label>
              <input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
            </div>
            <div className="field">
              <label>Кол-во по умолчанию</label>
              <input
                type="number"
                value={editing.defaultQty}
                onChange={(e) => setEditing({ ...editing, defaultQty: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>Цена</label>
              <input
                type="number"
                value={editing.basePrice}
                onChange={(e) => setEditing({ ...editing, basePrice: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>Тип</label>
              <select value={editing.itemType} onChange={(e) => setEditing({ ...editing, itemType: e.target.value })}>
                {ITEM_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Категория</label>
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Поставщик</label>
              <input value={editing.supplier} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Модуль</label>
            <input value={editing.module} onChange={(e) => setEditing({ ...editing, module: e.target.value })} />
          </div>
          <div className="field">
            <label>Ссылка на товар</label>
            <input value={editing.link} onChange={(e) => setEditing({ ...editing, link: e.target.value })} />
          </div>
          <div className="field">
            <label>URL фото товара</label>
            <input
              value={editing.imageUrl || editing.photoUrl || ""}
              onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value, photoUrl: e.target.value })}
              placeholder="https://... или загрузите файл"
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
                style={{ maxHeight: 80, marginTop: 8, borderRadius: 8 }}
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
          <div className="field">
            <label>Пояснение клиенту</label>
            <textarea rows={2} value={editing.clientNote} onChange={(e) => setEditing({ ...editing, clientNote: e.target.value })} />
          </div>
          <div className="field">
            <label>Технический комментарий</label>
            <textarea rows={2} value={editing.techNote} onChange={(e) => setEditing({ ...editing, techNote: e.target.value })} />
          </div>
        </Modal>
      )}
    </>
  );
}
