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
  const [priceDraft, setPriceDraft] = useState({});

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
        title="База материалов"
        sub="Справочник позиций и цен. Количество задаётся только в смете проекта — не здесь."
        actions={
          <>
            <button className="btn" onClick={exportAll}>
              Excel ↓
            </button>
            <button className="btn btn-primary" onClick={() => setEditing({ ...blank })}>
              ＋ Позиция
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
                  <tr key={m.id}>
                    <td className="spec-photo">
                      {(m.imageUrl || m.photoUrl) ? (
                        <img src={photoSrc(m.imageUrl || m.photoUrl)} alt="" className="thumb-img" />
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>нет фото</span>
                      )}
                    </td>
                    <td style={{ minWidth: 220 }} className="material-name">{m.name}</td>
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
              <input value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
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
            <input value={editing.module} onChange={(e) => setEditing({ ...editing, module: e.target.value })} />
          </div>
          <div className="field">
            <label>Поставщик</label>
            <input value={editing.supplier} onChange={(e) => setEditing({ ...editing, supplier: e.target.value })} />
          </div>
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
          <div className="field">
            <label>Пояснение клиенту</label>
            <textarea rows={2} value={editing.clientNote} onChange={(e) => setEditing({ ...editing, clientNote: e.target.value })} />
          </div>
        </Modal>
      )}
    </>
  );
}
