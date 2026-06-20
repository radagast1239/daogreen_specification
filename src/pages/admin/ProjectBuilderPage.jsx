import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import { FARM_TYPES } from "../../data/modules.js";
import { resolveCategories } from "../../lib/categories.js";
import { DEFAULT_MANUAL_PARAMS } from "../../lib/itemHelpers.js";
import { api } from "../../lib/api.js";
import {
  parseFarmSectionCatalogs,
  projectLinesFromCatalog,
  resolveFarmSections,
} from "../../lib/farmSectionsConfig.js";
import {
  activeLines,
  buildProjectFromBuilder,
  catalogLinesForModule,
  newStellageDraft,
} from "../../lib/projectBuilder.js";
import {
  draftFromStellagePreset,
  emptyFarmSectionsState,
  presetPayloadFromDraft,
} from "../../lib/presetHelpers.js";
import CoolingFarmTab from "../../components/CoolingFarmTab.jsx";
import RoomsEditor from "../../components/RoomsEditor.jsx";
import { COOLING_FARM_DEFAULTS, computeCoolingFarm } from "../../lib/coolingFarmCalc.js";
import { defaultRooms } from "../../lib/roomHelpers.js";

const STEPS = [
  { id: "basics", label: "1. Проект" },
  { id: "stellages", label: "2. Стеллажи" },
  { id: "general", label: "3. Ферма целиком" },
  { id: "cooling", label: "4. Расчёт охлаждения" },
  { id: "review", label: "5. Создание" },
];

export default function ProjectBuilderPage() {
  const { state, actions } = useStore();
  const nav = useNavigate();

  const [step, setStep] = useState("basics");
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState([]);
  const [farmCatalogs, setFarmCatalogs] = useState({});
  const [farmSettings, setFarmSettings] = useState(null);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

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
  const [farmSectionLines, setFarmSectionLines] = useState({});
  const [activeFarmSection, setActiveFarmSection] = useState(null);
  const [farmLoaded, setFarmLoaded] = useState(false);
  const [rooms, setRooms] = useState(defaultRooms);

  const sections = useMemo(
    () => resolveFarmSections(farmSettings || {}),
    [farmSettings]
  );
  const stellageMods = state.modules.filter((m) => m.type === "stellage");
  const stellagePresets = presets.filter((p) => p.presetType === "stellage");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([api.getPresets(), api.getSettings(), api.getSuppliers()]).then(([p, s, sup]) => {
      setPresets(p);
      setFarmSettings(s);
      setFarmCatalogs(parseFarmSectionCatalogs(s.farmSectionCatalogs));
      setCategories(resolveCategories(s));
      setSuppliers(sup);
    });
  }, []);

  useEffect(() => {
    if (step === "stellages" && !draft) {
      setDraft(newStellageDraft(state.modules, state.materials, stellages.length + 1));
    }
  }, [step, draft, state.modules, state.materials, stellages.length]);

  useEffect(() => {
    if (step === "general" && !farmLoaded && sections.length) {
      setFarmSectionLines(emptyFarmSectionsState(sections, farmCatalogs, state.materials));
      setActiveFarmSection(sections[0].id);
      setFarmLoaded(true);
    }
  }, [step, farmLoaded, sections, farmCatalogs, state.materials]);

  const changeDraftModule = (moduleId) => {
    const mod = state.modules.find((m) => m.id === moduleId);
    if (!mod) return;
    const reload = () =>
      setDraft((d) => ({
        ...d,
        moduleId: mod.id,
        moduleName: mod.name,
        tech: mod.tech || "",
        presetId: null,
        items: catalogLinesForModule(state.materials, mod.name),
      }));
    if (draft?.items?.some((ln) => ln.included)) {
      if (!window.confirm("Сменить тип? Текущие отметки будут заменены списком из базы.")) return;
    }
    reload();
  };

  const applyStellagePreset = (preset) => {
    if (draft?.items?.some((ln) => ln.included) && !window.confirm("Загрузить пресет? Текущая сборка будет заменена.")) return;
    setDraft(draftFromStellagePreset(preset, preset.name, stellages.length + 1));
  };

  const saveDraftAsPreset = async () => {
    const name = window.prompt("Название конфигурации стеллажа (пресет):", draft?.name || "");
    if (!name?.trim()) return;
    if (countIncluded(draft.items) === 0) {
      alert("Отметьте хотя бы одну позицию.");
      return;
    }
    try {
      await api.createPreset(presetPayloadFromDraft(draft, name));
      setPresets(await api.getPresets());
      alert("Пресет сохранён. Найдёте его в разделе «Пресеты».");
    } catch (e) {
      alert(e.message);
    }
  };

  const finishStellage = () => {
    if (!draft?.name?.trim()) {
      alert("Укажите название стеллажа в проекте.");
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

  const resetFarmSection = () => {
    if (!activeFarmSection) return;
    const cur = farmSectionLines[activeFarmSection] || [];
    if (cur.some((ln) => ln.included) && !window.confirm("Сбросить раздел к сохранённому шаблону?")) return;
    setFarmSectionLines((s) => ({
      ...s,
      [activeFarmSection]: projectLinesFromCatalog(farmCatalogs, activeFarmSection, state.materials),
    }));
  };

  const farmHasItems = Object.values(farmSectionLines).some((lines) => activeLines(lines).length > 0);

  const coolingInputs = form.manualParams?.coolingFarm || COOLING_FARM_DEFAULTS;
  const coolingCalc = useMemo(() => computeCoolingFarm(coolingInputs), [coolingInputs]);

  const setCoolingInputs = (next) => {
    setForm((f) => ({
      ...f,
      manualParams: { ...f.manualParams, coolingFarm: next },
    }));
  };

  const applyCoolingToForm = ({ coolingKw, coolingBtu }) => {
    setForm((f) => ({
      ...f,
      manualParams: {
        ...f.manualParams,
        coolingFarm: coolingInputs,
        coolingPower: coolingKw,
        coolingBtu,
      },
    }));
  };

  const canCreate =
    form.name.trim() &&
    (stellages.some((s) => activeLines(s.items).length > 0) || farmHasItems);

  const create = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      const farmSections = sections.map((sec) => ({
        sectionId: sec.id,
        sectionName: sec.name,
        items: farmSectionLines[sec.id] || [],
      }));
      const payload = buildProjectFromBuilder({
        form,
        stellages,
        farmSections,
        materials: state.materials,
        rooms,
      });
      const project = await actions.projectCreate(payload);
      nav(`/project/${project.id}`);
    } catch (e) {
      alert(e.message || "Ошибка создания");
    } finally {
      setSaving(false);
    }
  };

  const activeSection = sections.find((s) => s.id === activeFarmSection);

  return (
    <>
      <PageHeader
        title="Новый проект"
        sub="Соберите стеллажи и разделы фермы. Состав разделов настраивается в «Пресеты → Разделы фермы»."
        actions={
          <>
            <Link to="/modules" className="btn btn-sm">
              Пресеты
            </Link>
            <Link to="/new/template" className="btn btn-sm">
              Быстро из шаблона
            </Link>
          </>
        }
      />

      <div className="step-tabs">
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
        <div className="card" style={{ padding: 20 }}>
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
                  <option key={t} value={t}>{t}</option>
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
            <div className="card" style={{ marginBottom: 14, padding: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>В проекте ({stellages.length})</div>
              {stellages.map((st, i) => (
                <div key={st.id} className="row between" style={{ marginBottom: 6 }}>
                  <span>
                    <strong>{st.name}</strong>
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                      {st.moduleName} · {countIncluded(st.items)} поз.
                      {st.presetId ? " · пресет" : ""}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => editStellage(st.id)}>Изменить</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStellage(st.id)}>✕</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {stellagePresets.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Готовые конфигурации</div>
              <div className="preset-grid">
                {stellagePresets.map((p) => (
                  <button key={p.id} type="button" className="preset-card" onClick={() => applyStellagePreset(p)}>
                    <strong>{p.name}</strong>
                    <span className="muted">{p.moduleName} · {p.items.filter((i) => i.included).length} поз.</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Стеллаж в проекте</h3>
            <div className="form-grid">
              <label>
                Название в проекте
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              <label>
                Тип
                <select value={draft.moduleId} onChange={(e) => changeDraftModule(e.target.value)}>
                  {stellageMods.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={saveDraftAsPreset}>
                💾 Сохранить как пресет
              </button>
            </div>
          </div>

          <SpecPickerTable
            lines={draft.items}
            onChange={(items) => setDraft((d) => ({ ...d, items }))}
            materials={state.materials}
            catalogModule={draft.moduleName}
            catalogLabel="позицию"
            onSaveMaterial={saveMaterial}
            showQty
            categories={categories}
            suppliers={suppliers}
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={finishStellage}>
              ✓ Стеллаж готов — следующий
            </button>
            <button type="button" className="btn" onClick={() => setStep("basics")}>← Назад</button>
            <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => setStep("general")}>
              Ферма целиком →
            </button>
          </div>
        </div>
      )}

      {step === "general" && activeSection && (
        <div>
          <RoomsEditor rooms={rooms} onChange={setRooms} />

          <div className="farm-layout">
            <nav className="section-tabs">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={sec.id === activeFarmSection ? "active" : ""}
                  onClick={() => setActiveFarmSection(sec.id)}
                >
                  {sec.name}
                  <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 11, marginTop: 2 }}>
                    {(farmSectionLines[sec.id] || []).length} поз.
                    {countIncluded(farmSectionLines[sec.id] || []) > 0 &&
                      ` · ${countIncluded(farmSectionLines[sec.id] || [])} отм.`}
                  </span>
                </button>
              ))}
            </nav>

            <div>
              <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{activeSection.name}</h3>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  Отметьте нужные позиции, укажите количество и комнату. Список взят из шаблона раздела (Пресеты → Разделы фермы).
                </p>
                <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={resetFarmSection}>
                  ↺ Сбросить к шаблону раздела
                </button>
              </div>

              <SpecPickerTable
                lines={farmSectionLines[activeFarmSection] || []}
                onChange={(lines) => setFarmSectionLines((s) => ({ ...s, [activeFarmSection]: lines }))}
                materials={state.materials}
                catalogModule=""
                catalogLabel="материал"
                onSaveMaterial={saveMaterial}
                showQty
                showRoom={rooms.length > 0}
                rooms={rooms}
                categories={categories}
                suppliers={suppliers}
                farmSectionId={activeFarmSection}
              />
            </div>
          </div>

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStep("stellages")}>← Стеллажи</button>
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setStep("cooling")}>
              Расчёт охлаждения →
            </button>
          </div>
        </div>
      )}

      {step === "cooling" && (
        <div>
          <CoolingFarmTab
            inputs={coolingInputs}
            onInputsChange={setCoolingInputs}
            draftArea={form.area}
            draftHeight={form.height}
            onApplyToProject={applyCoolingToForm}
          />
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStep("general")}>← Ферма целиком</button>
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setStep("review")}>
              Проверить →
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Итого</h3>
          <ul style={{ fontSize: 14, lineHeight: 1.9 }}>
            <li><strong>{form.name}</strong>{form.client ? ` · ${form.client}` : ""}</li>
            <li>Стеллажей: <strong>{stellages.length}</strong></li>
            {sections.map((sec) => (
              <li key={sec.id}>
                {sec.name}: <strong>{activeLines(farmSectionLines[sec.id] || []).length}</strong> поз.
              </li>
            ))}
            <li>Комнат: <strong>{rooms.length}</strong></li>
            <li>
              Охлаждение: <strong>{Math.round(coolingCalc.totalKwSafety * 10) / 10} кВт</strong>
              {form.manualParams?.coolingPower ? ` (сохранено ${form.manualParams.coolingPower} кВт)` : ""}
            </li>
          </ul>
          {!canCreate && (
            <p style={{ color: "var(--danger)", fontSize: 13 }}>Нужно название и хотя бы одна позиция.</p>
          )}
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStep("cooling")}>← Назад</button>
            <button type="button" className="btn btn-primary" disabled={!canCreate || saving} onClick={create}>
              {saving ? "Создание…" : "Создать проект"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
