import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import {
  PUBLISH_RULE_OPTIONS,
  DEFAULT_CLIENT_LINK_TEMPLATE,
  buildPublishRulesForm,
  publishRulesToSettings,
} from "../../lib/publishRulesConfig.js";
import {
  resolveClientSections,
  clientSectionsToSettings,
  applyClientSectionsFromSettings,
} from "../../lib/clientSectionsConfig.js";
import ClientSectionsEditor from "../../components/admin/ClientSectionsEditor.jsx";
import { StickySaveBar, TechDetails } from "../../components/modulesUi.jsx";

export default function PublishRulesTab({ settings, onSaved }) {
  const [form, setForm] = useState(() => buildPublishRulesForm(settings));
  const [clientSections, setClientSections] = useState(() => resolveClientSections(settings));
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setForm(buildPublishRulesForm(settings));
    setClientSections(resolveClientSections(settings));
    applyClientSectionsFromSettings(settings);
  }, [settings]);

  const rulesBaseline = useMemo(() => JSON.stringify(buildPublishRulesForm(settings)), [settings]);
  const sectionsBaseline = useMemo(
    () => JSON.stringify(resolveClientSections(settings)),
    [settings]
  );
  const dirty =
    JSON.stringify(form) !== rulesBaseline ||
    JSON.stringify(clientSections) !== sectionsBaseline;

  const patchRule = (id, value) =>
    setForm((f) => ({ ...f, rules: { ...f.rules, [id]: value } }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...publishRulesToSettings(form),
        ...clientSectionsToSettings(clientSections),
      };
      await api.saveSettings(payload);
      applyClientSectionsFromSettings(payload);
      onSaved?.();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setForm(buildPublishRulesForm(settings));
    setClientSections(resolveClientSections(settings));
  };

  return (
    <div className="content modules-page-panel">
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Что должно быть заполнено у позиций перед «Ссылка клиенту» и «Утвердить версию». Проверяются видимые и включённые
        позиции; для клиента дополнительно нужны утверждение и количество.
      </p>

      <div className="card publish-rules-card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Обязательные поля</h3>
        <div className="publish-rules-list">
          {PUBLISH_RULE_OPTIONS.map((opt) => (
            <label key={opt.id} className="publish-rule-row">
              <input
                type="checkbox"
                checked={!!form.rules[opt.id]}
                onChange={(e) => patchRule(opt.id, e.target.checked)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>

        <div className="publish-rules-extra">
          <label className="publish-rule-row">
            <input
              type="checkbox"
              checked={!!form.rules.requireMinClientItems}
              onChange={(e) => patchRule("requireMinClientItems", e.target.checked)}
            />
            <span className="publish-rule-row__text">
              Минимум позиций для клиента:{" "}
              <input
                type="number"
                min={0}
                className="publish-rule-row__num"
                value={form.rules.minClientItems ?? 1}
                onChange={(e) => patchRule("minClientItems", Number(e.target.value) || 0)}
              />
            </span>
          </label>

          <label className="publish-rule-row">
            <input
              type="checkbox"
              checked={form.rules.allowForcePublish !== false}
              onChange={(e) => patchRule("allowForcePublish", e.target.checked)}
            />
            <span>Разрешить «Всё равно отправить», если чеклист не пройден</span>
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Текст сообщения клиенту</h3>
        <TechDetails summary="Дополнительно — подстановки">
          <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
            Подстановки: <code>{"{greeting}"}</code>, <code>{"{clientName}"}</code>, <code>{"{projectName}"}</code>,{" "}
            <code>{"{url}"}</code>, <code>{"{company}"}</code>
          </p>
        </TechDetails>
        <textarea
          rows={9}
          value={form.clientLinkTemplate}
          onChange={(e) => setForm((f) => ({ ...f, clientLinkTemplate: e.target.value }))}
          style={{ width: "100%", fontFamily: "inherit", fontSize: 13, marginTop: 8 }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => setForm((f) => ({ ...f, clientLinkTemplate: DEFAULT_CLIENT_LINK_TEMPLATE }))}
        >
          ↺ Шаблон по умолчанию
        </button>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Разделы закупки для клиента</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Настройте названия, порядок, подразделы и видимость разделов в клиентской выдаче.
        </p>
        <ClientSectionsEditor sections={clientSections} onChange={setClientSections} />
      </div>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        saved={savedFlash}
        onSave={save}
        onCancel={cancel}
        saveLabel="Сохранить правила"
      />
    </div>
  );
}
