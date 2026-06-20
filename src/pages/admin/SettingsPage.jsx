import React, { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { resolveCategories } from "../../lib/categories.js";
import { CATEGORIES } from "../../data/modules.js";
import { PageHeader } from "../../components/Layout.jsx";

export default function SettingsPage() {
  const [form, setForm] = useState({
    companyName: "Daogreen",
    contactPhone: "",
    contactEmail: "",
    contactTelegram: "",
    brandColor: "#116355",
    materialCategories: "",
  });
  const [categories, setCategories] = useState([...CATEGORIES]);
  const [newCat, setNewCat] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setForm(s);
      setCategories(resolveCategories(s));
    });
  }, []);

  const addCategory = () => {
    const name = newCat.trim();
    if (!name || categories.includes(name)) return;
    setCategories((c) => [...c, name]);
    setNewCat("");
  };

  const removeCategory = (name) => {
    if (!confirm(`Убрать категорию «${name}» из списка?`)) return;
    setCategories((c) => c.filter((x) => x !== name));
  };

  const save = async () => {
    const payload = {
      ...form,
      materialCategories: JSON.stringify(categories),
    };
    await api.saveSettings(payload);
    setForm(payload);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <PageHeader title="Настройки" sub="Контакты, категории материалов для пресетов и смет" />
      <div className="content" style={{ maxWidth: 560 }}>
        <div className="card" style={{ padding: 22, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Компания</h3>
          {[
            ["companyName", "Название компании"],
            ["contactPhone", "Телефон"],
            ["contactEmail", "Email"],
            ["contactTelegram", "Telegram"],
            ["brandColor", "Цвет бренда"],
          ].map(([k, label]) => (
            <div className="field" key={k}>
              <label>{label}</label>
              <input value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ marginTop: 0 }}>Категории материалов</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Список для выбора в базе материалов и при настройке пресетов. Можно добавлять свои.
          </p>
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
            {categories.map((c) => (
              <span key={c} className="chip chip--neutral" style={{ gap: 6 }}>
                {c}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: "0 4px", minHeight: 0, fontSize: 12 }}
                  onClick={() => removeCategory(c)}
                  title="Удалить"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Новая категория…"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCategory())}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={addCategory}>
              Добавить
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
          {saved && <span className="muted" style={{ marginLeft: 10 }}>Сохранено на сервере</span>}
        </div>
      </div>
    </>
  );
}
