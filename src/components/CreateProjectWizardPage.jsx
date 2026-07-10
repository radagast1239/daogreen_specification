import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/StoreContext.jsx";
import { PageHeader } from "./Layout.jsx";
import { useToast } from "./Toast.jsx";
import {
  PROJECT_KIND,
  PROJECT_KIND_OPTIONS,
  CREATE_SCENARIO,
  CREATE_SCENARIO_OPTIONS,
  suggestProjectName,
  buildNewProjectPayload,
  validateNewProjectForm,
  canSubmitNewProject,
  resolveCreateProjectRedirect,
  getProjectKindLabel,
  createProjectSubmitGuard,
} from "../../shared/projectCreation.js";
import { getProjectStatusLabel } from "../../shared/projectStatus.js";

const STEPS = [
  { id: 1, label: "Проект и клиент" },
  { id: 2, label: "Параметры фермы" },
  { id: 3, label: "Начальная структура" },
  { id: 4, label: "Проверка" },
];

function blankForm() {
  return {
    name: "",
    client: "",
    city: "",
    responsible: "",
    projectKind: PROJECT_KIND.CLIENT,
    type: "проточка",
    area: "",
    sowingArea: "",
    height: "",
    comment: "",
    internalNote: "",
    scenario: CREATE_SCENARIO.EMPTY,
    nameTouched: false,
  };
}

/**
 * Guided create wizard. Does NOT call createProject until final confirm.
 */
export default function CreateProjectWizardPage() {
  const { state, actions } = useStore();
  const nav = useNavigate();
  const { error: toastError } = useToast();
  const farmTypes = state.reference?.farmTypes || ["проточка", "подтопление", "аэропоника", "смешанная"];

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submitGuardRef = useRef(null);
  if (!submitGuardRef.current) submitGuardRef.current = createProjectSubmitGuard();

  const setField = (key, value) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "client" || key === "city") {
        if (!f.nameTouched) {
          next.name = suggestProjectName({
            client: key === "client" ? value : f.client,
            city: key === "city" ? value : f.city,
          });
        }
      }
      if (key === "name") next.nameTouched = true;
      return next;
    });
  };

  const errors = useMemo(() => validateNewProjectForm(form), [form]);
  const canNextFrom1 = canSubmitNewProject(form);

  const goNext = () => {
    if (step === 1 && !canNextFrom1) return;
    setStep((s) => Math.min(4, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const createOnce = async () => {
    if (saving || submitGuardRef.current.busy) return;
    if (!canSubmitNewProject(form)) {
      setStep(1);
      return;
    }
    setSaving(true);
    setSubmitError("");
    try {
      const outcome = await submitGuardRef.current.run(async () => {
        const payload = buildNewProjectPayload(form);
        return actions.projectCreate(payload);
      });
      if (outcome.skipped) return;
      const path = resolveCreateProjectRedirect(outcome.result, form.scenario);
      nav(path, { replace: true });
    } catch (e) {
      setSubmitError(e.message || "Не удалось создать проект");
      toastError(e.message || "Не удалось создать проект");
      setSaving(false);
    }
  };

  const onSubmitFinal = (e) => {
    e?.preventDefault?.();
    createOnce();
  };

  const scenarioLabel =
    CREATE_SCENARIO_OPTIONS.find((o) => o.id === form.scenario)?.label || "Пустой проект";

  return (
    <>
      <PageHeader
        title="Создать проект"
        sub="Данные сохраняются только после подтверждения на последнем шаге"
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content" style={{ maxWidth: 720 }}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
          {STEPS.map((s) => (
            <span
              key={s.id}
              className={`chip${step === s.id ? " chip--brand" : ""}`}
              style={{ opacity: step >= s.id ? 1 : 0.55 }}
            >
              {s.id}. {s.label}
            </span>
          ))}
        </div>

        <form className="card" style={{ padding: 22 }} onSubmit={onSubmitFinal}>
          {step === 1 ? (
            <>
              <h3 style={{ marginTop: 0 }}>Проект и клиент</h3>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Название проекта *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder="Вертикальная ферма — Клиент — Город"
                    autoFocus
                  />
                  {errors.name ? <span className="muted" style={{ color: "var(--danger)" }}>{errors.name}</span> : null}
                </div>
                <div className="field">
                  <label>Клиент / компания *</label>
                  <input
                    value={form.client}
                    onChange={(e) => setField("client", e.target.value)}
                    placeholder="ООО Пример"
                  />
                  {errors.client ? <span className="muted" style={{ color: "var(--danger)" }}>{errors.client}</span> : null}
                </div>
                <div className="field">
                  <label>Город</label>
                  <input value={form.city} onChange={(e) => setField("city", e.target.value)} />
                </div>
                <div className="field">
                  <label>Ответственный</label>
                  <input
                    value={form.responsible}
                    onChange={(e) => setField("responsible", e.target.value)}
                    placeholder="Имя"
                  />
                </div>
                <div className="field">
                  <label>Тип проекта</label>
                  <select value={form.projectKind} onChange={(e) => setField("projectKind", e.target.value)}>
                    {PROJECT_KIND_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h3 style={{ marginTop: 0 }}>Основные параметры фермы</h3>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label>Тип фермы</label>
                  <select value={form.type} onChange={(e) => setField("type", e.target.value)}>
                    {farmTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Общая площадь, м²</label>
                  <input type="number" min="0" step="any" value={form.area} onChange={(e) => setField("area", e.target.value)} />
                </div>
                <div className="field">
                  <label>Посевная площадь, м²</label>
                  <input type="number" min="0" step="any" value={form.sowingArea} onChange={(e) => setField("sowingArea", e.target.value)} />
                </div>
                <div className="field">
                  <label>Высота помещения, м</label>
                  <input type="number" min="0" step="any" value={form.height} onChange={(e) => setField("height", e.target.value)} />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Краткое описание</label>
                  <textarea rows={2} value={form.comment} onChange={(e) => setField("comment", e.target.value)} />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Внутренний комментарий</label>
                  <textarea rows={2} value={form.internalNote} onChange={(e) => setField("internalNote", e.target.value)} />
                </div>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h3 style={{ marginTop: 0 }}>Начальная структура</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                На этом шаге ничего не сохраняется. Пустые стеллажи и комнаты не создаются автоматически.
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                {CREATE_SCENARIO_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className="panel"
                    style={{
                      padding: 14,
                      cursor: "pointer",
                      borderColor: form.scenario === opt.id ? "var(--brand)" : "var(--line)",
                      background: form.scenario === opt.id ? "var(--brand-tint)" : "var(--paper)",
                    }}
                  >
                    <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name="scenario"
                        checked={form.scenario === opt.id}
                        onChange={() => setField("scenario", opt.id)}
                        style={{ marginTop: 3 }}
                      />
                      <div>
                        <strong>{opt.label}</strong>
                        <div className="muted" style={{ fontSize: 13 }}>{opt.detail}</div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <h3 style={{ marginTop: 0 }}>Проверка и создание</h3>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "160px 1fr", gap: "8px 12px", fontSize: 14 }}>
                <dt className="muted">Название</dt><dd style={{ margin: 0 }}><strong>{form.name || "—"}</strong></dd>
                <dt className="muted">Клиент</dt><dd style={{ margin: 0 }}>{form.client || "—"}</dd>
                <dt className="muted">Город</dt><dd style={{ margin: 0 }}>{form.city || "—"}</dd>
                <dt className="muted">Тип проекта</dt><dd style={{ margin: 0 }}>{getProjectKindLabel(form.projectKind)}</dd>
                <dt className="muted">Тип фермы</dt><dd style={{ margin: 0 }}>{form.type || "—"}</dd>
                <dt className="muted">Площадь</dt><dd style={{ margin: 0 }}>{form.area || "0"} м²</dd>
                <dt className="muted">Посевная</dt><dd style={{ margin: 0 }}>{form.sowingArea || "0"} м²</dd>
                <dt className="muted">Сценарий</dt><dd style={{ margin: 0 }}>{scenarioLabel}</dd>
                <dt className="muted">Статус</dt><dd style={{ margin: 0 }}>{getProjectStatusLabel("active")}</dd>
              </dl>
              {submitError ? (
                <p style={{ color: "var(--danger)", marginTop: 12 }}>{submitError}</p>
              ) : null}
            </>
          ) : null}

          <div className="row" style={{ marginTop: 20, justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={() => nav("/")} disabled={saving}>
              Отмена
            </button>
            {step > 1 ? (
              <button type="button" className="btn" onClick={goBack} disabled={saving}>
                Назад
              </button>
            ) : null}
            {step < 4 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={goNext}
                disabled={step === 1 && !canNextFrom1}
              >
                Далее
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !canSubmitNewProject(form)}
              >
                {saving ? "Создаём проект…" : "Создать проект"}
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
