import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";
import { useToast } from "../../components/Toast.jsx";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import { resolveCategories } from "../../lib/categories.js";
import { DEFAULT_MANUAL_PARAMS } from "../../lib/itemHelpers.js";
import { api } from "../../lib/api.js";
import {
  filterSectionsForFarmType,
  GROUP_LABEL,
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
import { parseStellageModuleCatalogs, parseStellageModuleMeta, projectStellageLinesFromCatalog, resolveStellagePhoto, stellageModulePhoto } from "../../lib/stellageCatalogConfig.js";
import StellagePhotoField, { StellagePhotoThumb } from "../../components/StellagePhotoField.jsx";
import {
  draftFromStellagePreset,
  emptyFarmSectionsState,
  presetPayloadFromDraft,
} from "../../lib/presetHelpers.js";
import { formatStellageParamsSummary } from "../../lib/stellagePresetParams.js";
import CoolingFarmTab from "../../components/CoolingFarmTab.jsx";
import CompactTableToggle from "../../components/CompactTableToggle.jsx";
import RoomsEditor from "../../components/RoomsEditor.jsx";
import FloorPlanField from "../../components/FloorPlanField.jsx";
import FloorPlanPin from "../../components/FloorPlanPin.jsx";
import { COOLING_FARM_DEFAULTS, computeCoolingFarm } from "../../lib/coolingFarmCalc.js";
import { defaultRooms } from "../../lib/roomHelpers.js";

const STEPS = [
  { id: "basics", label: "1. Проект" },
  { id: "stellages", label: "2. Стеллажи" },
  { id: "general", label: "3. Ферма целиком" },
  { id: "cooling", label: "4. Расчёт охлаждения" },
  { id: "consumables", label: "5. Расходные материалы" },
  { id: "review", label: "6. Создание" },
];

export default function ProjectBuilderPage() {
  const { state, actions } = useStore();
  const ref = state.reference;
  const { confirm, success, error } = useToast();
  const nav = useNavigate();

  const [step, setStep] = useState("basics");
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState([]);
  const [farmCatalogs, setFarmCatalogs] = useState({});
  const [stellageCatalogs, setStellageCatalogs] = useState({});
  const [stellageModuleMeta, setStellageModuleMeta] = useState({});
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
    () => filterSectionsForFarmType(resolveFarmSections(farmSettings || {}), form.type),
    [farmSettings, form.type]
  );
  const stellageMods = state.modules.filter((m) => m.type === "stellage");
  const stellagePresets = useMemo(
    () =>
      [...presets.filter((p) => p.presetType === "stellage")].sort(
        (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
      ),
    [presets]
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setManual = (k, v) =>
    setForm((f) => ({ ...f, manualParams: { ...(f.manualParams || {}), [k]: v } }));
  const floorPlanUrl = form.manualParams?.floorPlanUrl || "";
  const showFloorPlanPin = (step === "general" || step === "cooling" || step === "consumables" || step === "review") && !!floorPlanUrl;

  useEffect(() => {
    Promise.all([api.getPresets(), api.getSettings(), api.getSuppliers()]).then(([p, s, sup]) => {
      setPresets(p);
      setFarmSettings(s);
      setFarmCatalogs(parseFarmSectionCatalogs(s.farmSectionCatalogs));
      setStellageCatalogs(parseStellageModuleCatalogs(s.stellageModuleCatalogs));
      setStellageModuleMeta(parseStellageModuleMeta(s.stellageModuleMeta));
      setCategories(resolveCategories(s));
      setSuppliers(sup);
    });
  }, []);

  useEffect(() => {
    if (step === "stellages" && !draft) {
      setDraft(newStellageDraft(state.modules, state.materials, stellages.length + 1, stellageCatalogs, stellageModuleMeta));
    }
  }, [step, draft, state.modules, state.materials, stellages.length, stellageCatalogs, stellageModuleMeta]);

  useEffect(() => {
    if (step === "general" && !farmLoaded && sections.length) {
      setFarmSectionLines(emptyFarmSectionsState(sections, farmCatalogs, state.materials));
      setActiveFarmSection(sections[0].id);
      setFarmLoaded(true);
    }
  }, [step, farmLoaded, sections, farmCatalogs, state.materials]);

  useEffect(() => {
    setFarmLoaded(false);
  }, [form.type]);

  const changeDraftModule = async (moduleId) => {
    const mod = state.modules.find((m) => m.id === moduleId);
    if (!mod) return;
    const reload = () =>
      setDraft((d) => ({
        ...d,
        moduleId: mod.id,
        moduleName: mod.name,
        tech: mod.tech || "",
        presetId: null,
        photoUrl: stellageModulePhoto(stellageModuleMeta, mod.id),
        items: projectStellageLinesFromCatalog(stellageCatalogs, mod.id, state.materials, mod.name),
      }));
    if (draft?.items?.some((ln) => ln.included)) {
      if (!(await confirm({ title: "Сменить тип?", message: "Текущие отметки будут заменены списком из базы." }))) return;
    }
    reload();
  };

  const applyStellagePreset = async (preset) => {
    if (draft?.items?.some((ln) => ln.included) && !(await confirm({ title: "Загрузить пресет?", message: "Текущая сборка будет заменена." }))) return;
    setDraft(draftFromStellagePreset(preset, preset.name, stellages.length + 1, stellageModuleMeta));
  };

  const saveDraftAsPreset = async () => {
    const name = window.prompt("Название конфигурации стеллажа (пресет):", draft?.name || "");
    if (!name?.trim()) return;
    if (countIncluded(draft.items) === 0) {
      error("Отметьте хотя бы одну позицию.");
      return;
    }
    try {
      await api.createPreset(presetPayloadFromDraft(draft, name));
      setPresets(await api.getPresets());
      success("Пресет сохранён в «Модули / разделы».");
    } catch (e) {
      error(e.message);
    }
  };

  const finishStellage = () => {
    if (!draft?.name?.trim()) {
      error("Укажите название стеллажа в проекте.");
      return;
    }
    if (countIncluded(draft.items) === 0) {
      error("Отметьте хотя бы одну позицию галочкой.");
      return;
    }
    setStellages((list) => [...list, { ...draft, items: draft.items.map((ln) => ({ ...ln })) }]);
    setDraft(newStellageDraft(state.modules, state.materials, stellages.length + 2, stellageCatalogs, stellageModuleMeta));
  };

  const editStellage = async (id) => {
    const st = stellages.find((s) => s.id === id);
    if (!st) return;
    if (draft?.items?.some((ln) => ln.included) && !(await confirm({ title: "Заменить сборку?" }))) return;
    setStellages((list) => list.filter((s) => s.id !== id));
    setDraft({ ...st, items: st.items.map((ln) => ({ ...ln })) });
  };

  const removeStellage = async (id) => {
    if (!(await confirm({ title: "Удалить готовый стеллаж?" }))) return;
    setStellages((list) => list.filter((s) => s.id !== id));
  };

  const saveMaterial = async (payload) => {
    const m = await actions.materialAdd(payload);
    await actions.refresh();
    return m;
  };

  const resetFarmSection = async () => {
    if (!activeFarmSection) return;
    const cur = farmSectionLines[activeFarmSection] || [];
    const sec = sections.find((s) => s.id === activeFarmSection);
    if (cur.some((ln) => ln.included) && !(await confirm({ title: "Сбросить раздел?" }))) return;
    setFarmSectionLines((s) => ({
      ...s,
      [activeFarmSection]: projectLinesFromCatalog(farmCatalogs, activeFarmSection, state.materials, sec),
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
        defaultResponsible: sec.defaultResponsible || "",
        items: farmSectionLines[sec.id] || [],
      }));
      const payload = buildProjectFromBuilder({
        form,
        stellages,
        farmSections,
        materials: state.materials,
        rooms,
        stellageModuleMeta,
      });
      const project = await actions.projectCreate(payload);
      nav(`/project/${project.id}`);
    } catch (e) {
      error(e.message || "Ошибка создания");
    } finally {
      setSaving(false);
    }
  };

  const activeSection = sections.find((s) => s.id === activeFarmSection);

  return (
    <>
      <PageHeader
        title="Новый проект"
        sub="Соберите стеллажи и разделы фермы. Состав разделов — в «Модули / разделы фермы»."
        back={{ to: "/", label: "Проекты" }}
        actions={
          <>
            <CompactTableToggle />
            <Link to="/modules" className="btn btn-sm">
              Модули / разделы
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
                {ref.farmTypes.map((t) => (
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

          <RoomsEditor rooms={rooms} onChange={setRooms} />

          <FloorPlanField value={floorPlanUrl} onChange={(url) => setManual("floorPlanUrl", url)} />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={!form.name.trim()} onClick={() => setStep("stellages")}>
              Далее: стеллажи →
            </button>
          </div>
        </div>
      )}

      {step === "stellages" && draft && (
        <div>
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn" onClick={() => setStep("basics")}>← Назад</button>
            <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={() => setStep("general")}>
              Ферма целиком →
            </button>
          </div>

          {stellages.length > 0 && (
            <div className="card" style={{ marginBottom: 14, padding: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>В проекте ({stellages.length})</div>
              {stellages.map((st) => (
                <div key={st.id} className="row between stellage-list-row" style={{ marginBottom: 8, gap: 10 }}>
                  <StellagePhotoThumb
                    url={resolveStellagePhoto(stellageModuleMeta, st.moduleId, st.photoUrl || st.params?.photoUrl)}
                    size={48}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{st.name}</strong>
                    {(Number(st.count) || 1) > 1 && (
                      <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>× {st.count} шт.</span>
                    )}
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
                  <button key={p.id} type="button" className="preset-card preset-card--photo" onClick={() => applyStellagePreset(p)}>
                    <StellagePhotoThumb
                      url={resolveStellagePhoto(stellageModuleMeta, p.moduleId, p.params?.photoUrl)}
                      size={80}
                    />
                    <strong>{p.name}</strong>
                    <span className="muted">{p.moduleName}</span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {p.items.filter((i) => i.included).length} поз.
                      {formatStellageParamsSummary(p.params) ? ` · ${formatStellageParamsSummary(p.params)}` : ""}
                    </span>
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
              <label>
                Количество стеллажей
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.count ?? 1}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, count: Math.max(1, Number(e.target.value) || 1) }))
                  }
                  title="Материалы умножаются на это число"
                />
              </label>
            </div>
            <StellagePhotoField
              value={resolveStellagePhoto(stellageModuleMeta, draft.moduleId, draft.photoUrl || draft.params?.photoUrl)}
              onChange={(url) => setDraft((d) => ({ ...d, photoUrl: url, params: { ...(d.params || {}), photoUrl: url } }))}
              hint="Своё фото экземпляра. Если убрать — подставится фото типа из «Состав стеллажей»."
              compact={false}
            />
            {draft.params && formatStellageParamsSummary(draft.params) && (
              <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
                Параметры пресета: {formatStellageParamsSummary(draft.params)}
              </p>
            )}
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={saveDraftAsPreset}>
                💾 Сохранить как пресет
              </button>
            </div>
          </div>

          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button type="button" className="btn btn-primary" onClick={finishStellage}>
              ✓ Стеллаж готов — следующий
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              Отметьте позиции и укажите кол-во — без кол-ва клиенту не попадёт
            </span>
          </div>

          <SpecPickerTable
            lines={draft.items}
            onChange={(items) => setDraft((d) => ({ ...d, items }))}
            materials={state.materials}
            catalogModule={draft.moduleName}
            catalogLabel="позицию"
            onSaveMaterial={saveMaterial}
            showQty
            showCompositionGroups
            stellageGroups={ref.stellageGroups}
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

      {step === "general" && !sections.length && (
        <div className="card" style={{ padding: 20 }}>
          <p className="muted" style={{ margin: 0 }}>
            Для типа фермы «{form.type}» нет доступных разделов — проверьте настройки в «Модули / разделы → Разделы фермы»
            (галочки «Скрыть для типов фермы»).
          </p>
          <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setStep("basics")}>
            ← Изменить тип фермы
          </button>
        </div>
      )}

      {step === "general" && activeSection && (
        <div>
          <FloorPlanField value={floorPlanUrl} onChange={(url) => setManual("floorPlanUrl", url)} />

          {rooms.length > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
              Комнаты ({rooms.length}):{" "}
              {rooms.map((r) => r.name + (r.area ? ` ${r.area} м²` : "")).join(" · ")}
              {" — "}
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, verticalAlign: "baseline" }} onClick={() => setStep("basics")}>
                изменить в «Проект»
              </button>
            </p>
          )}

          <div className="farm-layout">
            <nav className="section-tabs" aria-label="Разделы фермы">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={sec.id === activeFarmSection ? "active" : ""}
                  title={`${GROUP_LABEL[sec.group] || ""} · ${sec.name}`}
                  style={
                    sec.id === activeFarmSection
                      ? {
                          borderColor: sec.color,
                          color: sec.color,
                          background: `${sec.color}14`,
                        }
                      : { borderColor: `${sec.color}33` }
                  }
                  onClick={() => setActiveFarmSection(sec.id)}
                >
                  <span className="sec-tab-name">
                    {sec.icon ? `${sec.icon} ` : ""}
                    {sec.name}
                  </span>
                  <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 10.5, marginTop: 2 }}>
                    {GROUP_LABEL[sec.group] || "Раздел"}
                    {" · "}
                    {(farmSectionLines[sec.id] || []).length} поз.
                    {countIncluded(farmSectionLines[sec.id] || []) > 0 &&
                      ` · ${countIncluded(farmSectionLines[sec.id] || [])} отм.`}
                  </span>
                </button>
              ))}
            </nav>

            <div className="farm-layout__main">
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
            {floorPlanUrl && (
              <FloorPlanPin url={floorPlanUrl} title="Схема помещения" variant="button" />
            )}
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setStep("cooling")}>
              Расчёт охлаждения →
            </button>
          </div>
        </div>
      )}

      {step === "cooling" && (
        <div>
          {floorPlanUrl && (
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <FloorPlanPin url={floorPlanUrl} title="Схема помещения" variant="button" />
            </div>
          )}
          <CoolingFarmTab
            inputs={coolingInputs}
            onInputsChange={setCoolingInputs}
            draftArea={form.area}
            draftHeight={form.height}
            onApplyToProject={applyCoolingToForm}
          />
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStep("general")}>← Ферма целиком</button>
            <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setStep("consumables")}>
              Расходные материалы →
            </button>
          </div>
        </div>
      )}

      {step === "consumables" && (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>Расходные материалы</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Ссылка на корзину с расходниками (Ozon, Wildberries, поставщик) — сохранится в проекте и будет видна в спецификации.
          </p>
          <label className="field" style={{ display: "block", maxWidth: 640 }}>
            Ссылка на корзину / список расходников
            <input
              type="url"
              placeholder="https://…"
              value={form.manualParams?.consumablesCartUrl || ""}
              onChange={(e) => setManual("consumablesCartUrl", e.target.value)}
            />
          </label>
          {form.manualParams?.consumablesCartUrl && (
            <p style={{ fontSize: 13, marginTop: 12 }}>
              <a href={form.manualParams.consumablesCartUrl} target="_blank" rel="noreferrer">
                Открыть корзину ↗
              </a>
            </p>
          )}
          <div className="toolbar" style={{ marginTop: 20 }}>
            <button type="button" className="btn" onClick={() => setStep("cooling")}>← Расчёт охлаждения</button>
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
            <li>
              Стеллажей:{" "}
              <strong>
                {stellages.reduce((n, st) => n + Math.max(1, Number(st.count) || 1), 0)}
              </strong>
              {stellages.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {" "}
                  ({stellages.length} конфиг.)
                </span>
              )}
            </li>
            {sections.map((sec) => (
              <li key={sec.id}>
                {sec.name}: <strong>{activeLines(farmSectionLines[sec.id] || []).length}</strong> поз.
              </li>
            ))}
            <li>Комнат: <strong>{rooms.length}</strong>
              {rooms.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {" "}({rooms.map((r) => r.name).join(", ")})
                </span>
              )}
            </li>
            <li>
              Охлаждение: <strong>{Math.round(coolingCalc.totalKwSafety * 10) / 10} кВт</strong>
              {form.manualParams?.coolingPower ? ` (сохранено ${form.manualParams.coolingPower} кВт)` : ""}
            </li>
            {form.manualParams?.consumablesCartUrl && (
              <li>
                Корзина расходников:{" "}
                <a href={form.manualParams.consumablesCartUrl} target="_blank" rel="noreferrer">
                  открыть ↗
                </a>
              </li>
            )}
          </ul>
          {!canCreate && (
            <p style={{ color: "var(--danger)", fontSize: 13 }}>Нужно название и хотя бы одна позиция.</p>
          )}
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setStep("consumables")}>← Назад</button>
            <button type="button" className="btn btn-primary" disabled={!canCreate || saving} onClick={create}>
              {saving ? "Создание…" : "Создать проект"}
            </button>
          </div>
        </div>
      )}

      {showFloorPlanPin && <FloorPlanPin url={floorPlanUrl} title="Схема помещения" />}
    </>
  );
}
