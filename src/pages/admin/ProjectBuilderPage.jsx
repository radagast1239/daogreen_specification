import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import { FARM_TYPES } from "../../data/modules.js";
import { DEFAULT_MANUAL_PARAMS } from "../../lib/itemHelpers.js";
import {
  activeLines,
  buildProjectFromBuilder,
  catalogLinesForModule,
  newStellageDraft,
} from "../../lib/projectBuilder.js";

const STEPS = [
  { id: "basics", label: "1. Проект" },
  { id: "stellages", label: "2. Стеллажи" },
  { id: "general", label: "3. Ферма целиком" },
  { id: "review", label: "4. Создание" },
];

export default function ProjectBuilderPage() {
  const { state, actions } = useStore();
  const nav = useNavigate();

  const [step, setStep] = useState("basics");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    client: "",
    city: "",
    area: "",
    height: "",
    sowingArea: "",
    type: "проточка",
    currency: "₽",
    vat: false,
    comment: "",
    manualParams: { ...DEFAULT_MANUAL_PARAMS },
  });

  const [stellages, setStellages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [generalLines, setGeneralLines] = useState([]);
  const [generalLoaded, setGeneralLoaded] = useState(false);

  const stellageMods = state.modules.filter((m) => m.type === "stellage");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (step === "stellages" && !draft) {
      setDraft(newStellageDraft(state.modules, state.materials, stellages.length + 1));
    }
  }, [step, draft, state.modules, state.materials, stellages.length]);

  useEffect(() => {
    if (step === "general" && !generalLoaded) {
      setGeneralLines(catalogLinesForModule(state.materials, "Общая закупка на ферму"));
      setGeneralLoaded(true);
    }
  }, [step, generalLoaded, state.materials]);

  const changeDraftModule = (moduleId) => {
    const mod = state.modules.find((m) => m.id === moduleId);
    if (!mod) return;
    const reload = () =>
      setDraft((d) => ({
        ...d,
        moduleId: mod.id,
        moduleName: mod.name,
        tech: mod.tech || "",
        items: catalogLinesForModule(state.materials, mod.name),
      }));
    if (draft?.items?.some((ln) => ln.included)) {
      if (!window.confirm("Сменить тип стеллажа? Текущие отметки и правки будут заменены списком из базы.")) return;
    }
    reload();
  };

  const finishStellage = () => {
    if (!draft?.name?.trim()) {
      alert("Укажите название стеллажа.");
      return;
    }
    if (countIncluded(draft.items) === 0) {
      alert("Отметьте хотя бы одну позицию галочкой.");
      return;
    }
    setStellages((list) => [...list, { ...draft, items: draft.items.map((ln) => ({ ...ln })) }]);
    setDraft(newStellageDraft(state.modules, state.materials, stellages.length + 2));
  };

  const editStellage = (id) => {
    const st = stellages.find((s) => s.id === id);
    if (!st) return;
    if (draft?.items?.some((ln) => ln.included) && !window.confirm("Заменить текущую незавершённую сборку?")) return;
    setStellages((list) => list.filter((s) => s.id !== id));
    setDraft({ ...st, items: st.items.map((ln) => ({ ...ln })) });
  };

  const removeStellage = (id) => {
    if (!window.confirm("Удалить готовый стеллаж?")) return;
    setStellages((list) => list.filter((s) => s.id !== id));
  };

  const saveMaterial = async (payload) => {
    const m = await actions.materialAdd(payload);
    await actions.refresh();
    return m;
  };

  const canCreate =
    form.name.trim() &&
    (stellages.some((s) => activeLines(s.items).length > 0) || activeLines(generalLines).length > 0);

  const create = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      const payload = buildProjectFromBuilder({ form, stellages, generalLines });
      const project = await actions.projectCreate(payload);
      nav(`/project/${project.id}`);
    } catch (e) {
      alert(e.message || "Ошибка создания");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Новый проект — сборка по позициям"
        sub="Выберите стеллаж, отметьте галочками что входит, введите количество и цену прямо в таблице. Без отдельного редактирования."
        actions={
          <Link to="/new/template" className="btn btn-sm">
            Быстро из шаблона
          </Link>
        }
      />

      <div className="toolbar" style={{ marginBottom: 16, flexWrap: "wrap", gap: 6 }}>
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn btn-sm ${step === s.id ? "btn-primary" : ""}`}
            onClick={() => setStep(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {step === "basics" && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h3 style={{ marginTop: 0 }}>Данные проекта</h3>
          <div className="form-grid">
            <label>
              Название *
              <input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label>
              Клиент
              <input value={form.client} onChange={(e) => set("client", e.target.value)} />
            </label>
            <label>
              Город
              <input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </label>
            <label>
              Тип фермы
              <select value={form.type} onChange={(e) => set("type", e.target.value)}>
                {FARM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Площадь, м²
              <input type="number" value={form.area} onChange={(e) => set("area", e.target.value)} />
            </label>
            <label>
              Высота, м
              <input type="number" value={form.height} onChange={(e) => set("height", e.target.value)} />
            </label>
            <label className="full">
              Комментарий
              <textarea rows={2} value={form.comment} onChange={(e) => set("comment", e.target.value)} />
            </label>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={!form.name.trim()} onClick={() => setStep("stellages")}>
              Далее: стеллажи →
            </button>
          </div>
        </div>
      )}

      {step === "stellages" && draft && (
        <div>
          {stellages.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Готовые стеллажи ({stellages.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stellages.map((st, i) => (
                  <div key={st.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <span>
                      <strong>{st.name || `Стеллаж ${i + 1}`}</strong>
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                        {st.moduleName} · {countIncluded(st.items)} поз.
                      </span>
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => editStellage(st.id)}>
                        Изменить
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStellage(st.id)}>
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Сборка стеллажа</h3>
            <div className="form-grid" style={{ marginBottom: 4 }}>
              <label>
                Название
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              <label>
                Тип стеллажа
                <select value={draft.moduleId} onChange={(e) => changeDraftModule(e.target.value)}>
                  {stellageMods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
              Отметьте ✓ что входит в этот стеллаж. Меняйте название, количество и цену прямо в ячейках.
            </p>
          </div>

          <SpecPickerTable
            lines={draft.items}
            onChange={(items) => setDraft((d) => ({ ...d, items }))}
            materials={state.materials}
            catalogModule={draft.moduleName}
            catalogLabel="позицию из базы"
            onSaveMaterial={saveMaterial}
            emptyHint="Для выбранного типа в базе пока нет позиций — добавьте новую в базу."
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={finishStellage}>
              ✓ Стеллаж готов — следующий
            </button>
            <button type="button" className="btn" onClick={() => setStep("basics")}>
              ← Назад
            </button>
            <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => setStep("general")}>
              Ферма целиком →
            </button>
          </div>
        </div>
      )}

      {step === "general" && (
        <div>
          <div className="card" style={{ marginBottom: 12, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Общая спецификация фермы</h3>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Насосы, ёмкости, магистрали, электрика — отметьте галочками, введите количество и цены. Всё сохраняется в проект как есть.
            </p>
          </div>

          <SpecPickerTable
            lines={generalLines}
            onChange={setGeneralLines}
            materials={state.materials}
            catalogModule="Общая закупка на ферму"
            catalogLabel="позицию"
            onSaveMaterial={saveMaterial}
            emptyHint="Загрузка позиций из базы…"
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStep("stellages")}>
              ← Стеллажи
            </button>
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setStep("review")}>
              Проверить и создать →
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>Итого</h3>
          <ul style={{ fontSize: 14, lineHeight: 1.8 }}>
            <li>
              <strong>{form.name}</strong>
              {form.client ? ` · ${form.client}` : ""}
            </li>
            <li>
              Стеллажей: <strong>{stellages.length}</strong> (
              {stellages.reduce((n, s) => n + activeLines(s.items).length, 0)} поз.)
            </li>
            <li>
              Общая спецификация: <strong>{activeLines(generalLines).length}</strong> поз.
            </li>
          </ul>
          {!canCreate && (
            <p style={{ color: "var(--danger)", fontSize: 13 }}>
              Нужно название проекта и хотя бы одна отмеченная позиция.
            </p>
          )}
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStep("general")}>
              ← Назад
            </button>
            <button type="button" className="btn btn-primary" disabled={!canCreate || saving} onClick={create}>
              {saving ? "Создание…" : "Создать проект"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
