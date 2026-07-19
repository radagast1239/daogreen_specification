import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { resolveCategories } from "../../lib/categories.js";
import { CATEGORIES } from "../../data/modules.js";
import { PageHeader } from "../../components/Layout.jsx";
import { TechDetails } from "../../components/modulesUi.jsx";
import { useToast } from "../../components/Toast.jsx";
import {
  resolveClientSections,
  clientSectionsToSettings,
  applyClientSectionsFromSettings,
} from "../../lib/clientSectionsConfig.js";
import { resolveFarmSections } from "../../lib/farmSectionsConfig.js";
import {
  SETTINGS_TABS,
  adminKeyFingerprint,
  formatAdminKeyCreatedAt,
  previewNames,
} from "../../lib/settingsUi.js";
import packageJson from "../../../package.json";

export default function SettingsPage() {
  const { confirm, success } = useToast();
  const [tab, setTab] = useState("overview");
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
  const [clientSections, setClientSections] = useState([]);
  const [farmSections, setFarmSections] = useState([]);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setForm(s);
      setCategories(resolveCategories(s));
      setClientSections(resolveClientSections(s));
      setFarmSections(resolveFarmSections(s));
      applyClientSectionsFromSettings(s);
    });
    api.getAdminUsers().then(setAdminUsers).catch(() => {});
    api
      .health()
      .then((h) => {
        setHealth(h);
        setHealthError(false);
      })
      .catch(() => {
        setHealth(null);
        setHealthError(true);
      });
  }, []);

  const categoryPreview = useMemo(() => previewNames(categories, 4), [categories]);
  const clientSectionPreview = useMemo(
    () =>
      previewNames(
        clientSections.filter((s) => !s.hidden).map((s) => s.label),
        4
      ),
    [clientSections]
  );
  const farmPreview = useMemo(
    () => previewNames(farmSections.map((s) => s.name), 4),
    [farmSections]
  );
  const visibleClientSections = useMemo(
    () => clientSections.filter((s) => !s.hidden),
    [clientSections]
  );

  const saveLinkSettings = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        materialCategories: JSON.stringify(categories),
        ...clientSectionsToSettings(clientSections),
      };
      await api.saveSettings(payload);
      setForm(payload);
      applyClientSectionsFromSettings(payload);
      success("Сохранено");
    } finally {
      setSaving(false);
    }
  };

  const addAdminKey = async () => {
    if (!newUser.name.trim() || !newUser.apiKey.trim()) return;
    await api.createAdminUser(newUser);
    setAdminUsers(await api.getAdminUsers());
    setNewUser({ name: "", apiKey: "" });
    success("Сохранено");
  };

  const removeAdminKey = async (u) => {
    if (!(await confirm({ title: "Удалить дополнительный ключ?", message: u.name, confirmLabel: "Удалить" }))) {
      return;
    }
    await api.deleteAdminUser(u.id);
    setAdminUsers(await api.getAdminUsers());
    success("Сохранено");
  };

  return (
    <>
      <PageHeader
        title="Настройки"
        sub="Ссылки, доступ и системные параметры приложения"
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content settings-page">
        <div className="settings-tabs" role="tablist" aria-label="Разделы настроек">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={"settings-tabs__btn" + (tab === t.id ? " is-active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="settings-grid">
            <article className="card settings-card">
              <h3 className="settings-card__title">Компания и бренд</h3>
              <p className="settings-card__desc muted">
                Редактирование — в «Шаблоны и справочники».
              </p>
              <dl className="settings-kv">
                <div>
                  <dt>Компания</dt>
                  <dd>{form.companyName || "—"}</dd>
                </div>
                <div>
                  <dt>Телефон</dt>
                  <dd>{form.contactPhone || "—"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{form.contactEmail || "—"}</dd>
                </div>
                <div>
                  <dt>Telegram</dt>
                  <dd>{form.contactTelegram || "—"}</dd>
                </div>
              </dl>
              <Link className="btn btn-sm" to="/modules?tab=brand">
                Открыть клиент и бренд
              </Link>
            </article>

            <article className="card settings-card">
              <h3 className="settings-card__title">Категории материалов</h3>
              <p className="settings-card__desc muted">
                {categories.length} категори{categories.length === 1 ? "я" : categories.length >= 2 && categories.length <= 4 ? "и" : "й"}
              </p>
              <div className="settings-chip-row">
                {categoryPreview.map((c) => (
                  <span key={c} className="chip chip--neutral">
                    {c}
                  </span>
                ))}
                {categories.length > categoryPreview.length ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    +{categories.length - categoryPreview.length}
                  </span>
                ) : null}
              </div>
              <Link className="btn btn-sm" to="/modules?tab=directories">
                Открыть справочники
              </Link>
            </article>

            <article className="card settings-card">
              <h3 className="settings-card__title">Разделы клиентской выдачи</h3>
              <p className="settings-card__desc muted">
                {visibleClientSections.length} раздел
                {visibleClientSections.length === 1
                  ? ""
                  : visibleClientSections.length >= 2 && visibleClientSections.length <= 4
                    ? "а"
                    : "ов"}{" "}
                в клиентской выдаче
              </p>
              <div className="settings-chip-row">
                {clientSectionPreview.map((name) => (
                  <span key={name} className="chip chip--neutral">
                    {name}
                  </span>
                ))}
                {visibleClientSections.length > clientSectionPreview.length ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    +{visibleClientSections.length - clientSectionPreview.length}
                  </span>
                ) : null}
              </div>
              <Link className="btn btn-sm" to="/modules?tab=publish">
                Настроить разделы
              </Link>
            </article>

            <article className="card settings-card">
              <h3 className="settings-card__title">Разделы фермы</h3>
              <p className="settings-card__desc muted">
                {farmSections.length} раздел
                {farmSections.length === 1
                  ? ""
                  : farmSections.length >= 2 && farmSections.length <= 4
                    ? "а"
                    : "ов"}{" "}
                структуры фермы
              </p>
              <div className="settings-chip-row">
                {farmPreview.map((name) => (
                  <span key={name} className="chip chip--neutral">
                    {name}
                  </span>
                ))}
                {farmSections.length > farmPreview.length ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    +{farmSections.length - farmPreview.length}
                  </span>
                ) : null}
              </div>
              <Link className="btn btn-sm" to="/modules?tab=farm">
                Открыть структуру фермы
              </Link>
            </article>
          </div>
        )}

        {tab === "links" && (
          <article className="card settings-card settings-card--narrow">
            <h3 className="settings-card__title">Срок действия клиентской ссылки</h3>
            <p className="settings-card__desc muted">
              Применяется к новым клиентским ссылкам. 0 = без ограничения.
            </p>
            <div className="field" style={{ maxWidth: 220 }}>
              <label htmlFor="client-link-ttl">Дней</label>
              <input
                id="client-link-ttl"
                type="number"
                min={0}
                value={form.clientLinkTtlDays || "0"}
                onChange={(e) => setForm({ ...form, clientLinkTtlDays: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={saving}
              onClick={saveLinkSettings}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </article>
        )}

        {tab === "security" && (
          <div className="settings-stack">
            <article className="card settings-card">
              <h3 className="settings-card__title">Основной доступ</h3>
              <p className="settings-card__desc">Основной доступ настроен на сервере.</p>
            </article>

            <details className="card settings-card settings-details">
              <summary>Дополнительные ключи доступа</summary>
              <div className="settings-details__body">
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  Используйте только при необходимости. Основной вход работает отдельно.
                </p>
                {adminUsers.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>Нет дополнительных ключей.</p>
                ) : (
                  <ul className="settings-key-list">
                    {adminUsers.map((u) => {
                      const fp = adminKeyFingerprint(u.apiKey);
                      const created = formatAdminKeyCreatedAt(u.createdAt);
                      return (
                        <li key={u.id} className="settings-key-row">
                          <div>
                            <strong>{u.name}</strong>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {created ? `Создан: ${created}` : null}
                              {fp ? `${created ? " · " : ""}…${fp}` : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => removeAdminKey(u)}
                          >
                            Удалить
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="settings-key-add">
                  <input
                    placeholder="Имя"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  />
                  <input
                    placeholder="Новый ключ"
                    value={newUser.apiKey}
                    onChange={(e) => setNewUser({ ...newUser, apiKey: e.target.value })}
                    autoComplete="off"
                  />
                  <button type="button" className="btn btn-sm" onClick={addAdminKey}>
                    Добавить
                  </button>
                </div>
              </div>
            </details>
          </div>
        )}

        {tab === "system" && (
          <div className="settings-stack">
            <article className="card settings-card">
              <h3 className="settings-card__title">Файлы и резервные копии</h3>
              <p className="settings-card__desc muted">
                Просмотр загруженных файлов и скачивание резервной копии базы.
              </p>
              <div className="settings-card__actions">
                <Link className="btn btn-sm btn-primary" to="/storage">
                  Открыть файлы и хранилище
                </Link>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => api.downloadBackup().then(() => success("Бэкап скачан"))}
                >
                  Скачать резервную копию
                </button>
              </div>
            </article>

            <TechDetails summary="Техническая информация">
              <dl className="settings-kv">
                <div>
                  <dt>Версия frontend</dt>
                  <dd>{packageJson.version || "—"}</dd>
                </div>
                <div>
                  <dt>Подключение</dt>
                  <dd>
                    {healthError
                      ? "Нет связи с API"
                      : health
                        ? "API доступен"
                        : "Проверка…"}
                  </dd>
                </div>
                {health?.materials != null && (
                  <div>
                    <dt>Материалов в базе</dt>
                    <dd>{health.materials}</dd>
                  </div>
                )}
              </dl>
            </TechDetails>
          </div>
        )}
      </div>
    </>
  );
}
