import React, { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { resolveCategories } from "../../lib/categories.js";
import { CATEGORIES } from "../../data/modules.js";
import { PageHeader } from "../../components/Layout.jsx";
import { useToast } from "../../components/Toast.jsx";
import ClientSectionsEditor from "../../components/admin/ClientSectionsEditor.jsx";
import {
  resolveClientSections,
  clientSectionsToSettings,
  applyClientSectionsFromSettings,
} from "../../lib/clientSectionsConfig.js";

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
  const [newUserName, setNewUserName] = useState("");
  const [createdKeyOnce, setCreatedKeyOnce] = useState(null);
  const [categories, setCategories] = useState([...CATEGORIES]);
  const [clientSections, setClientSections] = useState([]);
  const [newCat, setNewCat] = useState("");

  useEffect(() => {
    api.getSettings().then((s) => {
      setForm(s);
      setCategories(resolveCategories(s));
      setClientSections(resolveClientSections(s));
      applyClientSectionsFromSettings(s);
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
      ...clientSectionsToSettings(clientSections),
    };
    await api.saveSettings(payload);
    setForm(payload);
    applyClientSectionsFromSettings(payload);
    success("Настройки сохранены");
  };

  return (
    <>
      <PageHeader title="Настройки" sub="Ключи, срок ссылки, категории и разделы закупки для клиента." back={{ to: "/", label: "Проекты" }} />
      <div className="content" style={{ maxWidth: 720 }}>
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

        <div className="card" style={{ padding: 22, marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Разделы закупки для клиента</h3>
          <ClientSectionsEditor sections={clientSections} onChange={setClientSections} />
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
          <p className="muted" style={{ fontSize: 13 }}>
            Дополнительные ключи админки. Основной — в ADMIN_KEY на сервере (не хранится в БД).
          </p>
          {adminUsers.map((u) => (
            <div key={u.id} className="row between" style={{ fontSize: 13, marginBottom: 8 }}>
              <span>{u.name}{u.active === false ? " (отключён)" : ""}</span>
              <code style={{ fontSize: 11 }}>…{u.keyHint || "????"}</code>
            </div>
          ))}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <input
              placeholder="Имя"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                const name = newUserName.trim();
                if (!name) return;
                const created = await api.createAdminUser({ name });
                setAdminUsers(await api.getAdminUsers());
                setNewUserName("");
                setCreatedKeyOnce(created?.apiKey || null);
                success("Ключ создан");
              }}
            >
              Добавить
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                if (!(await confirm({
                  title: "Выйти на всех устройствах?",
                  message: "Все активные сессии админки будут отозваны. Ключи API продолжат работать.",
                }))) return;
                await api.revokeAllSessions();
                success("Сессии отозваны на всех устройствах");
              }}
            >
              Выйти на всех устройствах
            </button>
          </div>
        </div>
      </div>

      {createdKeyOnce ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div className="card" style={{ maxWidth: 480, width: "100%", padding: 22 }}>
            <h3 style={{ marginTop: 0 }}>Новый ключ доступа</h3>
            <p style={{ fontSize: 14 }}>
              Скопируйте ключ сейчас. После закрытия окна он больше не будет показан.
            </p>
            <code
              style={{
                display: "block",
                wordBreak: "break-all",
                fontSize: 12,
                padding: 12,
                background: "var(--surface-2, #f4f4f4)",
                borderRadius: 8,
              }}
            >
              {createdKeyOnce}
            </code>
            <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdKeyOnce);
                    success("Ключ скопирован");
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Копировать
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setCreatedKeyOnce(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
