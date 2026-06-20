import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Modal } from "../../components/ui.jsx";

const blank = { name: "", phone: "", site: "", note: "" };

export default function SuppliersPage() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const reload = () => api.getSuppliers().then(setList);

  useEffect(() => {
    reload();
  }, []);

  const save = async () => {
    if (!editing?.name?.trim()) return;
    setSaving(true);
    try {
      if (editing.id) await api.updateSupplier(editing.id, editing);
      else await api.createSupplier(editing);
      setEditing(null);
      await reload();
    } catch (e) {
      alert(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Удалить поставщика?")) return;
    await api.deleteSupplier(id);
    await reload();
  };

  return (
    <>
      <PageHeader
        title="Поставщики"
        sub="Справочник для привязки к материалам"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...blank })}>
            ＋ Поставщик
          </button>
        }
      />
      <div className="content">
        {list.length === 0 ? (
          <p className="muted">Пока нет поставщиков — создайте первого.</p>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {list.map((s) => (
              <div key={s.id} className="card" style={{ padding: 14 }}>
                <div className="between">
                  <strong>{s.name}</strong>
                  <div className="row" style={{ gap: 2 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...s })}>
                      ✎
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(s.id)}>
                      ✕
                    </button>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {s.materialCount} позиций
                  {s.phone ? ` · ${s.phone}` : ""}
                </div>
                {s.site && (
                  <a href={s.site} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    {s.site}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
          Привязка к материалам — в <Link to="/materials">базе материалов</Link> или при настройке пресетов.
        </p>
      </div>

      {editing && (
        <Modal
          title={editing.id ? "Редактировать поставщика" : "Новый поставщик"}
          onClose={() => !saving && setEditing(null)}
          footer={
            <>
              <button type="button" className="btn" disabled={saving} onClick={() => setEditing(null)}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </>
          }
        >
          <div className="field">
            <label>Название *</label>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
          </div>
          <div className="field">
            <label>Телефон</label>
            <input value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>Сайт</label>
            <input value={editing.site || ""} onChange={(e) => setEditing({ ...editing, site: e.target.value })} />
          </div>
          <div className="field">
            <label>Заметка</label>
            <textarea rows={2} value={editing.note || ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          </div>
        </Modal>
      )}
    </>
  );
}
