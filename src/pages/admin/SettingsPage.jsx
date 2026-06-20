import React, { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { resolveCategories } from "../../lib/categories.js";
import { CATEGORIES } from "../../data/modules.js";
import { PageHeader } from "../../components/Layout.jsx";
import { useToast } from "../../components/Toast.jsx";

export default function SettingsPage() {
  const { confirm, success } = useToast();
  const [form, setForm] = useState({
    companyName: "Daogreen",
    contactPhone: "",
    contactEmail: "",
    contactTelegram: "",
    brandColor: "#116355",
    materialCategories: "",
    clientLinkTtlDays: "0",
    logoUrl: "",
  });
  const [adminUsers, setAdminUsers] = useState([]);
  const [newUser, setNewUser] = useState({ name: "", apiKey: "" });
  const [categories, setCategories] = useState([...CATEGORIES]);
  const [newCat, setNewCat] = useState("");

  useEffect(() => {
    api.getSettings().then((s) => {
      setForm(s);
      setCategories(resolveCategories(s));
    });
    api.getAdminUsers().then(setAdminUsers).catch(() => {});
  }, []);

  const addCategory = () => {
    const name = newCat.trim();
    if (!name || categories.includes(name)) return;
    setCategories((c) => [...c, name]);
    setNewCat("");
  };

  const removeCategory = async (name) => {
    if (!(await confirm({ title: `Убрать категорию «${name}»?` }))) return;
    setCategories((c) => c.filter((x) => x !== name));
  };

  const save = async () => {
    const payload = {
      ...form,
      materialCategories: JSON.stringify(categories),
    };
    await api.saveSettings(payload);
    setForm(payload);
    success("Настройки сохранены");
  };

  return (
    <>
      <PageHeader title="Настройки" sub="Ключи, срок ссылки, категории. Бренд клиента — в «Модули / разделы → Клиент и бренд»." back={{ to: "/", label: "Проекты" }} />
      <div className="content" style={{ maxWidth: 560 }}>
        <div className="card" style={{ padding: 22, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Компания</h3>
          {[
            ["companyName", "Название компании"],
            ["contactPhone", "Телефон"],
            ["contactEmail", "Email"],
            ["contactTelegram", "Telegram"],
            ["clientLinkTtlDays", "Срок ссылки, дней"],
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

        <div className="row wrap" style={{ marginTop: 18, gap: 10 }}>
          <button type="button" className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
          <button type="button" className="btn" onClick={() => api.downloadBackup().then(() => success("Бэкап скачан"))}>
            Скачать бэкап БД
          </button>
        </div>

        <div className="card" style={{ padding: 22, marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Клиентская ссылка</h3>
          <div className="field">
            <label>Срок действия (дней, 0 = без ограничения)</label>
            <input
              type="number"
              min={0}
              value={form.clientLinkTtlDays || "0"}
              onChange={(e) => setForm({ ...form, clientLinkTtlDays: e.target.value })}
            />
          </div>
        </div>

        <div className="card" style={{ padding: 22, marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Ключи доступа</h3>
          <p className="muted" style={{ fontSize: 13 }}>Дополнительные ключи админки. Основной — в ADMIN_KEY на сервере.</p>
          {adminUsers.map((u) => (
            <div key={u.id} className="row between" style={{ fontSize: 13, marginBottom: 8 }}>
              <span>{u.name}</span>
              <code style={{ fontSize: 11 }}>{u.apiKey.slice(0, 8)}…</code>
            </div>
          ))}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <input placeholder="Имя" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
            <input placeholder="Ключ" value={newUser.apiKey} onChange={(e) => setNewUser({ ...newUser, apiKey: e.target.value })} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                await api.createAdminUser(newUser);
                setAdminUsers(await api.getAdminUsers());
                setNewUser({ name: "", apiKey: "" });
                success("Ключ добавлен");
              }}
            >
              Добавить
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
