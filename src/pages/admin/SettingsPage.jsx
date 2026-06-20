import React, { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";

export default function SettingsPage() {
  const [form, setForm] = useState({
    companyName: "Daogreen",
    contactPhone: "",
    contactEmail: "",
    contactTelegram: "",
    brandColor: "#116355",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(setForm);
  }, []);

  const save = async () => {
    await api.saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <PageHeader title="Настройки" sub="Контакты для PDF и клиентского экрана" />
      <div className="content" style={{ maxWidth: 520 }}>
        <div className="card" style={{ padding: 22 }}>
          {[
            ["companyName", "Название компании"],
            ["contactPhone", "Телефон"],
            ["contactEmail", "Email"],
            ["contactTelegram", "Telegram"],
            ["brandColor", "Цвет бренда"],
          ].map(([k, label]) => (
            <div className="field" key={k}>
              <label>{label}</label>
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <button className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
          {saved && <span className="muted" style={{ marginLeft: 10 }}>Сохранено на сервере</span>}
        </div>
      </div>
    </>
  );
}
