import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import {
  appendSectionVersion,
  catalogEditorLines,
  exportSectionBundle,
  FARM_SECTION_GROUPS,
  GROUP_LABEL,
  moveSection,
  newFarmSection,
  parseFarmSectionCatalogs,
  parseFarmSectionVersions,
  parseSectionImport,
  patchSection,
  patchSectionName,
  removeSection,
  resolveFarmSections,
  stripLineIds,
} from "../../lib/farmSectionsConfig.js";
import { resolveCategories } from "../../lib/categories.js";
import { catalogLinesForModule } from "../../lib/projectBuilder.js";
import { cloneBuilderLines } from "../../lib/presetHelpers.js";
import {
  DEFAULT_STELLAGE_PARAMS,
  formatStellageParamsSummary,
  normalizeStellageParams,
} from "../../lib/stellagePresetParams.js";
import { useStore } from "../../store/StoreContext.jsx";
import DirectoriesTab from "./DirectoriesTab.jsx";
import ClientBrandTab from "./ClientBrandTab.jsx";

const TABS = [
  { id: "stellage", label: "Пресеты стеллажей" },
  { id: "farm", label: "Разделы фермы" },
  { id: "catalog", label: "Модули базы" },
  { id: "directories", label: "Справочники" },
  { id: "brand", label: "Клиент и бренд" },
];

const MODULE_TYPES = [
  { id: "stellage", label: "Стеллаж" },
  { id: "general", label: "Общий" },
  { id: "assembly", label: "Монтаж" },
  { id: "consumables", label: "Расходники" },
];

const TECH_OPTIONS = ["проточка", "подтопление", "аэропоника", "клубника", "смешанная", "—"];

const ICON_PRESETS = ["📦", "🌱", "💧", "⚡", "🌡️", "🔧", "🏗️", "📋"];

const TYPE_LABEL = Object.fromEntries(MODULE_TYPES.map((t) => [t.id, t.label]));

const emptyModuleForm = () => ({
  name: "",
  type: "general",
  tech: "—",
  icon: "📦",
  color: "#116355",
  farmSectionId: "",
});

function ModuleBadge({ mod }) {
  return (
    <span
      className="module-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 8,
        background: `${mod.color || "#116355"}18`,
        border: `1px solid ${mod.color || "#116355"}44`,
      }}
    >
      <span aria-hidden>{mod.icon || "📦"}</span>
      <strong>{mod.name}</strong>
    </span>
  );
}

export default function ModulesPage() {
  const { state, actions } = useStore();
  const ref = state.reference;
  const [tab, setTab] = useState("farm");
  const [presets, setPresets] = useState([]);
  const [mods, setMods] = useState([]);
  const [farmSections, setFarmSections] = useState([]);
  const [farmCatalogs, setFarmCatalogs] = useState({});
  const [farmSectionVersions, setFarmSectionVersions] = useState({});
  const [editing, setEditing] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [editLines, setEditLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editingMod, setEditingMod] = useState(null);
  const [modForm, setModForm] = useState(emptyModuleForm);
  const [modSaving, setModSaving] = useState(false);
  const [dragPresetId, setDragPresetId] = useState(null);
  const [appSettings, setAppSettings] = useState({});

  const stellageMods = state.modules.filter((m) => m.type === "stellage");
  const stellagePresets = useMemo(
    () =>
      [...presets.filter((p) => p.presetType === "stellage")].sort(
        (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
      ),
    [presets]
  );

  const persistFarm = async (sections, catalogs, versions = farmSectionVersions) => {
    await api.saveSettings({
      farmSections: JSON.stringify(sections),
      farmSectionCatalogs: JSON.stringify(catalogs),
      farmSectionVersions: JSON.stringify(versions),
    });
  };

  const reload = useCallback(async () => {
    const [p, m, s, sup] = await Promise.all([
      api.getPresets(),
      api.getModulesAdmin(),
      api.getSettings(),
      api.getSuppliers(),
    ]);
    setPresets(p);
    setMods(m);
    setCategories(resolveCategories(s));
    setSuppliers(sup);
    setFarmSections(resolveFarmSections(s));
    setFarmCatalogs(parseFarmSectionCatalogs(s.farmSectionCatalogs));
    setFarmSectionVersions(parseFarmSectionVersions(s.farmSectionVersions));
    setAppSettings(s);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveMaterial = async (payload) => {
    const m = await actions.materialAdd(payload);
    await actions.refresh();
    return m;
  };

  const startNewStellagePreset = () => {
    const mod = stellageMods[0];
    setEditingSection(null);
    setEditing({
      id: null,
      name: "",
      presetType: "stellage",
      moduleId: mod?.id || "",
      moduleName: mod?.name || "",
      sectionId: "",
      note: mod?.tech || "",
      params: { ...DEFAULT_STELLAGE_PARAMS },
    });
    setEditLines(mod?.name ? catalogLinesForModule(state.materials, mod.name) : []);
  };

  const openStellagePreset = (p) => {
    setEditingSection(null);
    setEditing({ ...p, params: normalizeStellageParams(p.params) });
    setEditLines(cloneBuilderLines(p.items));
  };

  const setPresetParam = (key, value) => {
    setEditing((e) => ({
      ...e,
      params: normalizeStellageParams({ ...e.params, [key]: value }),
    }));
  };

  const reorderStellagePresets = async (targetId) => {
    if (!dragPresetId || dragPresetId === targetId) return;
    const ids = stellagePresets.map((p) => p.id);
    const from = ids.indexOf(dragPresetId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragPresetId);
    await api.reorderPresets(ids);
    setDragPresetId(null);
    await reload();
  };

  const openSectionEditor = (sec) => {
    setEditing(null);
    setEditingSection(sec);
    setEditLines(catalogEditorLines(farmCatalogs, sec.id, state.materials));
  };

  const addFarmSection = async () => {
    const name = window.prompt("Название нового раздела:", "Новый раздел");
    if (!name?.trim()) return;
    const sec = newFarmSection(name);
    const sections = [...farmSections, sec];
    setFarmSections(sections);
    await persistFarm(sections, farmCatalogs);
    openSectionEditor(sec);
  };

  const saveSectionName = async (sectionId, name) => {
    const sections = patchSectionName(farmSections, sectionId, name);
    setFarmSections(sections);
    await persistFarm(sections, farmCatalogs);
  };

  const moveFarmSection = async (sectionId, dir) => {
    const sections = moveSection(farmSections, sectionId, dir);
    setFarmSections(sections);
    await persistFarm(sections, farmCatalogs);
  };

  const saveSectionMeta = async (sectionId, patch) => {
    const sections = patchSection(farmSections, sectionId, patch);
    setFarmSections(sections);
    if (editingSection?.id === sectionId) {
      setEditingSection(sections.find((s) => s.id === sectionId));
    }
    await persistFarm(sections, farmCatalogs);
  };

  const deleteFarmSection = async (sec) => {
    if (!window.confirm(`Удалить раздел «${sec.name}» и его состав?`)) return;
    const { sections, catalogs, versions } = removeSection(
      farmSections,
      farmCatalogs,
      sec.id,
      farmSectionVersions
    );
    setFarmSections(sections);
    setFarmCatalogs(catalogs);
    setFarmSectionVersions(versions);
    if (editingSection?.id === sec.id) setEditingSection(null);
    await persistFarm(sections, catalogs, versions);
  };

  const saveSectionCatalog = async () => {
    if (!editingSection) return;
    setSaving(true);
    try {
      const prevCatalog = farmCatalogs[editingSection.id] || [];
      const prevCount = prevCatalog.filter((ln) => ln.included !== false).length;
      const newCatalog = stripLineIds(editLines);
      const newCount = newCatalog.length;
      const catalogs = {
        ...farmCatalogs,
        [editingSection.id]: newCatalog,
      };
      const sections = patchSection(farmSections, editingSection.id, editingSection);
      const versions =
        prevCount !== newCount
          ? appendSectionVersion(farmSectionVersions, editingSection.id, {
              prevCount,
              newCount,
              catalog: newCatalog,
            })
          : farmSectionVersions;
      setFarmCatalogs(catalogs);
      setFarmSections(sections);
      setFarmSectionVersions(versions);
      await persistFarm(sections, catalogs, versions);
      setEditingSection(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const exportSectionJson = (sec) => {
    const bundle = exportSectionBundle(sec, farmCatalogs[sec.id] || editLines);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `farm-section-${sec.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importSectionJson = async (file, targetSection = null) => {
    const text = await file.text();
    const { section, catalog } = parseSectionImport(text);
    let secId;
    let sections;
    if (targetSection) {
      secId = targetSection.id;
      sections = patchSection(farmSections, secId, {
        name: section.name,
        group: section.group,
        icon: section.icon,
        color: section.color,
        defaultResponsible: section.defaultResponsible,
        hiddenForFarmTypes: section.hiddenForFarmTypes,
      });
    } else {
      secId = section.id;
      sections = [...farmSections, section];
    }
    const catalogs = { ...farmCatalogs, [secId]: catalog };
    setFarmSections(sections);
    setFarmCatalogs(catalogs);
    await persistFarm(sections, catalogs);
    openSectionEditor(sections.find((s) => s.id === secId));
  };

  const restoreSectionVersion = async (ver) => {
    if (!editingSection || !ver?.catalog) return;
    if (!window.confirm(`Восстановить состав от ${new Date(ver.savedAt).toLocaleString()} (${ver.newCount} поз.)?`)) return;
    setEditLines(catalogEditorLines({ [editingSection.id]: ver.catalog }, editingSection.id, state.materials));
  };

  const sectionVersions = editingSection ? farmSectionVersions[editingSection.id] || [] : [];

  const responsibleLabel = (id) => ref.responsibleRoles.find((r) => r.id === id)?.label || "—";

  const saveStellagePreset = async () => {
    if (!editing?.name?.trim()) {
      alert("Укажите название пресета.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...editing,
        params: normalizeStellageParams(editing.params),
        items: editLines.map(({ id, ...rest }) => rest),
      };
      if (editing.id) await api.updatePreset(editing.id, body);
      else await api.createPreset({ ...body, sortOrder: stellagePresets.length });
      setEditing(null);
      await reload();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deletePreset = async (id) => {
    if (!window.confirm("Удалить пресет?")) return;
    await api.deletePreset(id);
    await reload();
  };

  const catalogCount = (sectionId) => (farmCatalogs[sectionId] || []).length;

  const visibleMods = showArchived ? mods : mods.filter((m) => m.active !== false);

  const farmSectionLabel = (id) => {
    if (!id) return "—";
    return farmSections.find((s) => s.id === id)?.name || id;
  };

  const openNewModule = () => {
    setEditingMod({ id: null });
    setModForm(emptyModuleForm());
  };

  const openEditModule = (m) => {
    setEditingMod(m);
    setModForm({
      name: m.name,
      type: m.type || "general",
      tech: m.tech || "—",
      icon: m.icon || "📦",
      color: m.color || "#116355",
      farmSectionId: m.farmSectionId || "",
    });
  };

  const saveModuleForm = async () => {
    if (!modForm.name?.trim()) {
      alert("Укажите название модуля.");
      return;
    }
    setModSaving(true);
    try {
      if (editingMod?.id) {
        await api.updateModule(editingMod.id, modForm);
      } else {
        await api.createModule(modForm);
      }
      setEditingMod(null);
      await reload();
      await actions.refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setModSaving(false);
    }
  };

  const handleArchiveModule = async (m) => {
    if (!window.confirm(`Архивировать модуль «${m.name}»? Материалы останутся в базе.`)) return;
    await api.archiveModule(m.id);
    if (editingMod?.id === m.id) setEditingMod(null);
    await reload();
    await actions.refresh();
  };

  const handleRestoreModule = async (m) => {
    await api.restoreModule(m.id);
    await reload();
    await actions.refresh();
  };

  const handleDuplicateModule = async (m) => {
    if (!window.confirm(`Создать копию модуля «${m.name}» со всеми материалами?`)) return;
    setModSaving(true);
    try {
      const result = await api.duplicateModule(m.id);
      alert(`Создан модуль «${result.module.name}» — ${result.materialCount} поз.`);
      await reload();
      await actions.refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setModSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Модули / разделы фермы"
        sub="Настройте разделы «Ферма целиком»: состав материалов по умолчанию подтягивается при создании проекта."
      />

      <div className="step-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn btn-sm ${tab === t.id ? "btn-primary" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "directories" && !editing && !editingSection && !editingMod && (
        <DirectoriesTab
          settings={appSettings}
          onSaved={async () => {
            await reload();
            await actions.refresh();
          }}
        />
      )}

      {tab === "brand" && !editing && !editingSection && !editingMod && (
        <ClientBrandTab
          settings={appSettings}
          onSaved={async () => {
            await reload();
            await actions.refresh();
          }}
        />
      )}

      {tab === "stellage" && !editing && !editingSection && !editingMod && (
        <div className="content">
          <div className="toolbar">
            <button type="button" className="btn btn-primary btn-sm" onClick={startNewStellagePreset}>
              ＋ Новый пресет стеллажа
            </button>
          </div>
          {stellagePresets.length === 0 ? (
            <p className="muted">Пока нет сохранённых конфигураций стеллажей.</p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Перетащите карточки для изменения порядка в «Новый проект».
              </p>
              <div className="preset-grid preset-grid--sortable">
                {stellagePresets.map((p) => (
                  <div
                    key={p.id}
                    className={`preset-card ${dragPresetId === p.id ? "preset-card--drag" : ""}`}
                    draggable
                    style={{ cursor: "grab" }}
                    onDragStart={() => setDragPresetId(p.id)}
                    onDragEnd={() => setDragPresetId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => reorderStellagePresets(p.id)}
                  >
                    <span className="preset-drag-handle" title="Перетащить">⠿</span>
                    <strong>{p.name}</strong>
                    <span className="muted">{p.moduleName}</span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {p.items.filter((i) => i.included).length} поз.
                      {formatStellageParamsSummary(p.params) ? ` · ${formatStellageParamsSummary(p.params)}` : ""}
                    </span>
                    <div className="row" style={{ marginTop: 10, gap: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => openStellagePreset(p)}>
                        Редактировать
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => deletePreset(p.id)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "farm" && !editingSection && !editing && !editingMod && (
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={addFarmSection}>
              ＋ Новый раздел
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Каждый раздел — шаблон списка материалов с кол-вом по умолчанию. В проекте вы отмечаете нужные позиции.
            Можно экспортировать раздел в JSON и перенести на другой сервер.
          </p>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Раздел</th>
                  <th>Группа</th>
                  <th>Ответств.</th>
                  <th className="right" style={{ width: 90 }}>В составе</th>
                  <th className="right" style={{ width: 280 }} />
                </tr>
              </thead>
              <tbody>
                {farmSections.map((sec, i) => (
                  <tr key={sec.id}>
                    <td className="muted num">{i + 1}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span aria-hidden>{sec.icon}</span>
                        <input
                          className="spec-cell-input"
                          value={sec.name}
                          style={{ borderColor: `${sec.color}55` }}
                          onChange={(e) =>
                            setFarmSections(patchSectionName(farmSections, sec.id, e.target.value))
                          }
                          onBlur={(e) => saveSectionName(sec.id, e.target.value)}
                        />
                      </span>
                    </td>
                    <td>
                      <select
                        className="spec-cell-input"
                        value={sec.group || "other"}
                        onChange={(e) => saveSectionMeta(sec.id, { group: e.target.value })}
                      >
                        {FARM_SECTION_GROUPS.map((g) => (
                          <option key={g.id} value={g.id}>{g.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {responsibleLabel(sec.defaultResponsible)}
                    </td>
                    <td className="right num muted">{catalogCount(sec.id)}</td>
                    <td className="right">
                      <button type="button" className="btn btn-sm" onClick={() => openSectionEditor(sec)}>
                        Настроить
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" title="Экспорт JSON" onClick={() => exportSectionJson(sec)}>
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={i === 0}
                        onClick={() => moveFarmSection(sec.id, "up")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={i === farmSections.length - 1}
                        onClick={() => moveFarmSection(sec.id, "down")}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Удалить"
                        onClick={() => deleteFarmSection(sec)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="btn btn-sm">
              ↑ Импорт раздела JSON
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importSectionJson(f).catch((err) => alert(err.message));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}

      {tab === "catalog" && !editing && !editingSection && !editingMod && (
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={openNewModule}>
              ＋ Новый модуль
            </button>
            <label className="row" style={{ gap: 6, marginLeft: "auto", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Показать архив
            </label>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Модули — это «листы» базы материалов. Тип, технология и раздел фермы помогают при сборке проекта.
          </p>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Модуль</th>
                  <th>Тип</th>
                  <th>Технология</th>
                  <th>Раздел фермы</th>
                  <th className="right">Позиций</th>
                  <th className="right" style={{ width: 220 }} />
                </tr>
              </thead>
              <tbody>
                {visibleMods.map((m) => (
                  <tr key={m.id} style={m.active === false ? { opacity: 0.55 } : undefined}>
                    <td>
                      <ModuleBadge mod={m} />
                      {m.active === false && (
                        <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>архив</span>
                      )}
                    </td>
                    <td className="muted">{TYPE_LABEL[m.type] || m.type}</td>
                    <td className="muted">{m.tech || "—"}</td>
                    <td className="muted">{farmSectionLabel(m.farmSectionId)}</td>
                    <td className="right num">{m.materialCount}</td>
                    <td className="right">
                      <button type="button" className="btn btn-sm" onClick={() => openEditModule(m)}>
                        Изменить
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => handleDuplicateModule(m)}>
                        Копия
                      </button>
                      {m.active === false ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleRestoreModule(m)}>
                          Восст.
                        </button>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleArchiveModule(m)}>
                          Архив
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingMod && (
        <div className="content">
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{editingMod.id ? "Редактирование модуля" : "Новый модуль"}</h3>
            <div className="form-grid">
              <label>
                Название *
                <input
                  value={modForm.name}
                  onChange={(e) => setModForm({ ...modForm, name: e.target.value })}
                  placeholder="Стеллаж проточка, Электрика…"
                />
              </label>
              <label>
                Тип
                <select
                  value={modForm.type}
                  onChange={(e) => setModForm({ ...modForm, type: e.target.value })}
                >
                  {MODULE_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Технология
                <select
                  value={modForm.tech}
                  onChange={(e) => setModForm({ ...modForm, tech: e.target.value })}
                >
                  {TECH_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Раздел фермы по умолчанию
                <select
                  value={modForm.farmSectionId}
                  onChange={(e) => setModForm({ ...modForm, farmSectionId: e.target.value })}
                >
                  <option value="">— не привязан —</option>
                  {farmSections.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Цвет в интерфейсе
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="color"
                    value={modForm.color}
                    onChange={(e) => setModForm({ ...modForm, color: e.target.value })}
                    style={{ width: 48, height: 36, padding: 2 }}
                  />
                  <input
                    value={modForm.color}
                    onChange={(e) => setModForm({ ...modForm, color: e.target.value })}
                  />
                </div>
              </label>
              <label>
                Иконка
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {ICON_PRESETS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className={`btn btn-sm ${modForm.icon === ic ? "btn-primary" : ""}`}
                      onClick={() => setModForm({ ...modForm, icon: ic })}
                    >
                      {ic}
                    </button>
                  ))}
                  <input
                    value={modForm.icon}
                    onChange={(e) => setModForm({ ...modForm, icon: e.target.value })}
                    style={{ width: 56 }}
                    maxLength={4}
                  />
                </div>
              </label>
            </div>
            <div style={{ marginTop: 12 }}>
              <span className="muted" style={{ fontSize: 12, marginRight: 10 }}>Предпросмотр:</span>
              <ModuleBadge mod={{ ...modForm, name: modForm.name || "Название" }} />
            </div>
          </div>
          <div className="toolbar">
            <button type="button" className="btn btn-primary" disabled={modSaving} onClick={saveModuleForm}>
              {modSaving ? "Сохранение…" : "Сохранить модуль"}
            </button>
            <button type="button" className="btn" onClick={() => setEditingMod(null)}>
              Отмена
            </button>
            {editingMod.id && editingMod.active !== false && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginLeft: "auto" }}
                onClick={() => handleDuplicateModule(editingMod)}
              >
                Дублировать с материалами
              </button>
            )}
          </div>
        </div>
      )}

      {editingSection && (
        <div className="content">
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>
              {editingSection.icon} Состав раздела: {editingSection.name}
            </h3>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
              Галочка — позиция в шаблоне. Кол-во — по умолчанию при сборке проекта (подставится, когда отметите строку).
            </p>
            <div className="form-grid">
              <label>
                Название раздела
                <input
                  value={editingSection.name}
                  onChange={(e) => setEditingSection({ ...editingSection, name: e.target.value })}
                  onBlur={(e) => saveSectionName(editingSection.id, e.target.value)}
                />
              </label>
              <label>
                Группа
                <select
                  value={editingSection.group || "other"}
                  onChange={(e) => {
                    const group = e.target.value;
                    const meta = FARM_SECTION_GROUPS.find((g) => g.id === group);
                    setEditingSection({
                      ...editingSection,
                      group,
                      icon: editingSection.icon || meta?.icon,
                      color: editingSection.color || meta?.color,
                    });
                  }}
                >
                  {FARM_SECTION_GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Ответственный по умолчанию
                <select
                  value={editingSection.defaultResponsible || ""}
                  onChange={(e) => {
                    const defaultResponsible = e.target.value;
                    setEditingSection({ ...editingSection, defaultResponsible });
                    saveSectionMeta(editingSection.id, { defaultResponsible });
                  }}
                >
                  <option value="">По категории материала</option>
                  {ref.responsibleRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Цвет вкладки
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="color"
                    value={editingSection.color || "#116355"}
                    onChange={(e) => setEditingSection({ ...editingSection, color: e.target.value })}
                    onBlur={() => saveSectionMeta(editingSection.id, { color: editingSection.color })}
                    style={{ width: 48, height: 36, padding: 2 }}
                  />
                  <input
                    value={editingSection.color || "#116355"}
                    onChange={(e) => setEditingSection({ ...editingSection, color: e.target.value })}
                    onBlur={() => saveSectionMeta(editingSection.id, { color: editingSection.color })}
                  />
                </div>
              </label>
              <label>
                Иконка вкладки
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {ICON_PRESETS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className={`btn btn-sm ${editingSection.icon === ic ? "btn-primary" : ""}`}
                      onClick={() => {
                        setEditingSection({ ...editingSection, icon: ic });
                        saveSectionMeta(editingSection.id, { icon: ic });
                      }}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </label>
              <label className="full">
                Скрыть для типов фермы
                <span className="muted" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>
                  Раздел не показывается в мастере, если выбран этот тип (например, «проточка» не видит раздел только для аэропоники)
                </span>
                <div className="row wrap" style={{ gap: 10 }}>
                  {ref.farmTypes.map((t) => (
                    <label key={t} className="row" style={{ fontSize: 13, gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={(editingSection.hiddenForFarmTypes || []).includes(t)}
                        onChange={(e) => {
                          const cur = editingSection.hiddenForFarmTypes || [];
                          const next = e.target.checked ? [...cur, t] : cur.filter((x) => x !== t);
                          setEditingSection({ ...editingSection, hiddenForFarmTypes: next });
                          saveSectionMeta(editingSection.id, { hiddenForFarmTypes: next });
                        }}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </label>
            </div>
            {sectionVersions.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <strong style={{ fontSize: 13 }}>История шаблона</strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
                  {sectionVersions.slice(0, 8).map((ver) => (
                    <li key={ver.id} style={{ marginBottom: 4 }}>
                      {new Date(ver.savedAt).toLocaleString("ru")} — было {ver.prevCount} поз., стало {ver.newCount}
                      {" · "}
                      <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => restoreSectionVersion(ver)}>
                        восстановить
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <SpecPickerTable
            lines={editLines}
            onChange={setEditLines}
            materials={state.materials}
            catalogModule=""
            farmSectionId={editingSection.id}
            catalogLabel="материал"
            onSaveMaterial={saveMaterial}
            categories={categories}
            suppliers={suppliers}
            showQty
            qtyLabel="Кол-во по умолч."
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={saveSectionCatalog}>
              {saving ? "Сохранение…" : "Сохранить раздел"}
            </button>
            <button type="button" className="btn" onClick={() => setEditingSection(null)}>
              Отмена
            </button>
            <button type="button" className="btn btn-sm" onClick={() => exportSectionJson(editingSection)}>
              ↓ Экспорт JSON
            </button>
            <label className="btn btn-sm">
              ↑ Импорт
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importSectionJson(f, editingSection).catch((err) => alert(err.message));
                  e.target.value = "";
                }}
              />
            </label>
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {countIncluded(editLines)} поз. в шаблоне
            </span>
          </div>
        </div>
      )}

      {editing && (
        <div className="content">
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{editing.id ? "Редактирование пресета" : "Новый пресет стеллажа"}</h3>
            <div className="form-grid">
              <label>
                Название пресета *
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              <label>
                Тип стеллажа
                <select
                  value={editing.moduleId}
                  onChange={(e) => {
                    const mod = stellageMods.find((m) => m.id === e.target.value);
                    if (!mod) return;
                    setEditing({ ...editing, moduleId: mod.id, moduleName: mod.name, note: mod.tech || "" });
                    setEditLines(catalogLinesForModule(state.materials, mod.name));
                  }}
                >
                  {stellageMods.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label>
                Длина, м
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editing.params?.length ?? ""}
                  onChange={(e) => setPresetParam("length", e.target.value)}
                />
              </label>
              <label>
                Ширина, м
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editing.params?.width ?? ""}
                  onChange={(e) => setPresetParam("width", e.target.value)}
                />
              </label>
              <label>
                Высота, м
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editing.params?.height ?? ""}
                  onChange={(e) => setPresetParam("height", e.target.value)}
                />
              </label>
              <label>
                Ярусы
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={editing.params?.tiers ?? ""}
                  onChange={(e) => setPresetParam("tiers", e.target.value)}
                />
              </label>
              <label>
                Поддоны / ярус
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={editing.params?.traysPerTier ?? ""}
                  onChange={(e) => setPresetParam("traysPerTier", e.target.value)}
                />
              </label>
              <label>
                Свет / ярус
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={editing.params?.lightsPerTier ?? ""}
                  onChange={(e) => setPresetParam("lightsPerTier", e.target.value)}
                />
              </label>
              <label>
                Культура
                <input
                  value={editing.params?.crop ?? ""}
                  placeholder="салат, клубника…"
                  onChange={(e) => setPresetParam("crop", e.target.value)}
                />
              </label>
              <label>
                Зона
                <input
                  value={editing.params?.zone ?? ""}
                  placeholder="Зона А…"
                  onChange={(e) => setPresetParam("zone", e.target.value)}
                />
              </label>
              <label>
                Кол-во стеллажей по умолч.
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={editing.params?.defaultCount ?? 1}
                  onChange={(e) => setPresetParam("defaultCount", e.target.value)}
                />
              </label>
              <label className="full">
                Комментарий к пресету
                <input
                  value={editing.params?.comment ?? ""}
                  onChange={(e) => setPresetParam("comment", e.target.value)}
                />
              </label>
            </div>
          </div>

          <SpecPickerTable
            lines={editLines}
            onChange={setEditLines}
            materials={state.materials}
            catalogModule={editing.moduleName}
            catalogLabel="позицию"
            onSaveMaterial={saveMaterial}
            categories={categories}
            suppliers={suppliers}
            showCompositionGroups
            stellageGroups={ref.stellageGroups}
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={saveStellagePreset}>
              {saving ? "Сохранение…" : "Сохранить пресет"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </>
  );
}
