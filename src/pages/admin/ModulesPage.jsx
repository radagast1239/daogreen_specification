import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { PageHeader, BackLink } from "../../components/Layout.jsx";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import {
  appendSectionVersion,
  catalogEditorLines,
  exportSectionBundle,
  moveSection,
  newFarmSection,
  parseFarmSectionCatalogs,
  parseFarmSectionVersions,
  parseSectionImport,
  patchSection,
  patchSectionName,
  normalizeSection,
  removeSection,
  resolveFarmSections,
  resolveFarmSectionGroups,
  stripLineIds,
} from "../../lib/farmSectionsConfig.js";
import { resolveCategories } from "../../lib/categories.js";
import { cloneBuilderLines } from "../../lib/presetHelpers.js";
import {
  DEFAULT_STELLAGE_PARAMS,
  formatStellageParamsSummary,
  normalizeStellageParams,
} from "../../lib/stellagePresetParams.js";
import { useStore } from "../../store/StoreContext.jsx";
import DirectoriesTab from "./DirectoriesTab.jsx";
import ClientBrandTab from "./ClientBrandTab.jsx";
import PublishRulesTab from "./PublishRulesTab.jsx";
import StellageGroupsEditor from "../../components/StellageGroupsEditor.jsx";
import StellagePhotoField, { StellagePhotoThumb } from "../../components/StellagePhotoField.jsx";
import { referenceToSettings, buildReferenceData } from "../../lib/referenceData.js";
import {
  parseStellageModuleCatalogs,
  parseStellageModuleMeta,
  patchStellageModulePhoto,
  resolveStellagePhoto,
  stellageModulePhoto,
  copyStellageCatalogEntry,
  stellageCatalogCount,
  stellageCatalogEditorLines,
  stellageCatalogLinesCopiedFrom,
  stripStellageCatalogLines,
} from "../../lib/stellageCatalogConfig.js";

const TABS = [
  { id: "stellage", label: "Пресеты стеллажей" },
  { id: "stellage_composition", label: "Состав стеллажей" },
  { id: "farm", label: "Разделы фермы" },
  { id: "catalog", label: "Модули базы" },
  { id: "directories", label: "Справочники" },
  { id: "brand", label: "Клиент и бренд" },
  { id: "publish", label: "Правила публикации" },
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

const PROTECTED_MODULE_NAMES = new Set(["Общая закупка на ферму"]);

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
  const [selectedModIds, setSelectedModIds] = useState(() => new Set());
  const [editingMod, setEditingMod] = useState(null);
  const [modForm, setModForm] = useState(emptyModuleForm);
  const [modSaving, setModSaving] = useState(false);
  const [dragPresetId, setDragPresetId] = useState(null);
  const [appSettings, setAppSettings] = useState({});
  const [stellageCatalogs, setStellageCatalogs] = useState({});
  const [stellageModuleMeta, setStellageModuleMeta] = useState({});
  const [editingStellageMod, setEditingStellageMod] = useState(null);
  const [editingStellagePhoto, setEditingStellagePhoto] = useState("");
  const [stellageGroupsDraft, setStellageGroupsDraft] = useState([]);

  const stellageMods = state.modules.filter((m) => m.type === "stellage");
  const stellagePresets = useMemo(
    () =>
      [...presets.filter((p) => p.presetType === "stellage")].sort(
        (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
      ),
    [presets]
  );

  const farmSectionGroups = useMemo(() => {
    const base = resolveFarmSectionGroups(appSettings);
    const known = new Set(base.map((g) => g.id));
    const extras = farmSections
      .map((s) => s.group)
      .filter((id) => id && !known.has(id))
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .map((id) => ({ id, label: id, icon: "📋", color: "#888" }));
    return [...base, ...extras];
  }, [appSettings, farmSections]);

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
    setStellageCatalogs(parseStellageModuleCatalogs(s.stellageModuleCatalogs));
    setStellageModuleMeta(parseStellageModuleMeta(s.stellageModuleMeta));
    setAppSettings(s);
    setStellageGroupsDraft(buildReferenceData(s).stellageGroups);
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
      params: {
        ...DEFAULT_STELLAGE_PARAMS,
        photoUrl: mod?.id ? stellageModulePhoto(stellageModuleMeta, mod.id) : "",
      },
    });
    setEditLines(mod?.name ? stellageCatalogEditorLines(stellageCatalogs, mod?.id, state.materials, mod.name) : []);
  };

  const openStellageModuleEditor = (mod) => {
    setEditing(null);
    setEditingSection(null);
    setEditingMod(null);
    setEditingStellageMod(mod);
    setStellageGroupsDraft(ref.stellageGroups);
    setEditingStellagePhoto(stellageModulePhoto(stellageModuleMeta, mod.id));
    setEditLines(stellageCatalogEditorLines(stellageCatalogs, mod.id, state.materials, mod.name));
  };

  const saveStellageGroups = async () => {
    const nextRef = { ...ref, stellageGroups: stellageGroupsDraft };
    await api.saveSettings(referenceToSettings(nextRef));
    await actions.refresh();
  };

  const saveStellageModuleCatalog = async () => {
    if (!editingStellageMod) return;
    setSaving(true);
    try {
      const catalogs = {
        ...stellageCatalogs,
        [editingStellageMod.id]: stripStellageCatalogLines(editLines),
      };
      const meta = patchStellageModulePhoto(stellageModuleMeta, editingStellageMod.id, editingStellagePhoto);
      await api.saveSettings({
        stellageModuleCatalogs: JSON.stringify(catalogs),
        stellageModuleMeta: JSON.stringify(meta),
        ...referenceToSettings({ ...ref, stellageGroups: stellageGroupsDraft }),
      });
      setStellageCatalogs(catalogs);
      setStellageModuleMeta(meta);
      setEditingStellageMod(null);
      await reload();
      await actions.refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
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

  const duplicateFarmSection = async (sec) => {
    const name = window.prompt("Название копии раздела:", `${sec.name} (копия)`);
    if (!name?.trim()) return;
    const copySec = normalizeSection({
      ...newFarmSection(name),
      group: sec.group,
      icon: sec.icon,
      color: sec.color,
      defaultResponsible: sec.defaultResponsible,
      hiddenForFarmTypes: [...(sec.hiddenForFarmTypes || [])],
    });
    const sourceCatalog = farmCatalogs[sec.id] || [];
    const catalogs = {
      ...farmCatalogs,
      [copySec.id]: sourceCatalog.length ? stripLineIds(cloneBuilderLines(sourceCatalog)) : [],
    };
    const sections = [...farmSections, copySec];
    setFarmSections(sections);
    setFarmCatalogs(catalogs);
    await persistFarm(sections, catalogs);
    openSectionEditor(copySec);
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
  const inEditor = !!(editing || editingSection || editingMod || editingStellageMod);
  const tabLabel = TABS.find((t) => t.id === tab)?.label || "раздел";

  const exitEditor = () => {
    setEditing(null);
    setEditingSection(null);
    setEditingMod(null);
    setEditingStellageMod(null);
  };

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

  const duplicateStellagePreset = async (p) => {
    const name = window.prompt("Название копии пресета:", `${p.name} (копия)`);
    if (!name?.trim()) return;
    setSaving(true);
    try {
      await api.createPreset({
        name: name.trim(),
        presetType: "stellage",
        moduleId: p.moduleId,
        moduleName: p.moduleName,
        sectionId: p.sectionId || "",
        params: normalizeStellageParams(p.params),
        items: (p.items || []).map(({ id, ...rest }) => rest),
        note: p.note || "",
        sortOrder: stellagePresets.length,
      });
      await reload();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const pickStellageModuleTarget = (sourceMod, title) => {
    const others = stellageMods.filter((m) => m.id !== sourceMod.id);
    if (!others.length) {
      alert("Нет других типов стеллажей.");
      return null;
    }
    const list = others.map((m, i) => `${i + 1}. ${m.name}`).join("\n");
    const pick = window.prompt(`${title}\n\n${list}\n\nВведите номер:`);
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= others.length) return null;
    return others[idx];
  };

  const copyStellageCatalogToModule = async (sourceMod) => {
    if (!stellageCatalogCount(stellageCatalogs, sourceMod.id)) {
      alert(`У «${sourceMod.name}» пустой шаблон — нечего копировать.`);
      return;
    }
    const target = pickStellageModuleTarget(sourceMod, `Скопировать состав «${sourceMod.name}» в:`);
    if (!target) return;
    const existing = stellageCatalogCount(stellageCatalogs, target.id);
    if (existing > 0 && !window.confirm(`У «${target.name}» уже ${existing} поз. Перезаписать?`)) return;
    setSaving(true);
    try {
      const catalogs = copyStellageCatalogEntry(stellageCatalogs, sourceMod.id, target.id);
      await api.saveSettings({
        stellageModuleCatalogs: JSON.stringify(catalogs),
        stellageModuleMeta: JSON.stringify(stellageModuleMeta),
        ...referenceToSettings(ref),
      });
      setStellageCatalogs(catalogs);
      await reload();
      await actions.refresh();
      alert(`Состав скопирован в «${target.name}».`);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const applyStellageCatalogFromModule = (sourceModuleId) => {
    if (!editingStellageMod || !sourceModuleId || sourceModuleId === editingStellageMod.id) return;
    const srcMod = stellageMods.find((m) => m.id === sourceModuleId);
    if (!srcMod) return;
    if (!window.confirm(`Подставить состав из «${srcMod.name}»? Несохранённые изменения будут заменены.`)) return;
    const lines = stellageCatalogLinesCopiedFrom(
      stellageCatalogs,
      sourceModuleId,
      editingStellageMod.id,
      state.materials,
      editingStellageMod.name
    );
    if (!lines) {
      alert(`У «${srcMod.name}» пустой шаблон.`);
      return;
    }
    setEditLines(lines);
  };

  const catalogCount = (sectionId) => (farmCatalogs[sectionId] || []).length;

  const visibleMods = showArchived ? mods : mods.filter((m) => m.active !== false);

  const archivableMods = useMemo(
    () => visibleMods.filter((m) => m.active !== false && !PROTECTED_MODULE_NAMES.has(m.name)),
    [visibleMods]
  );

  const archivedVisibleMods = useMemo(
    () => visibleMods.filter((m) => m.active === false),
    [visibleMods]
  );

  const toggleModSelection = (id) => {
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllArchivable = () => {
    if (selectedModIds.size >= archivableMods.length) {
      setSelectedModIds(new Set());
    } else {
      setSelectedModIds(new Set(archivableMods.map((m) => m.id)));
    }
  };

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
    if (PROTECTED_MODULE_NAMES.has(m.name)) {
      alert(`Модуль «${m.name}» нельзя убрать — он нужен для сборки проекта.`);
      return;
    }
    const n = m.materialCount || 0;
    const extra =
      n > 0
        ? `\n\n${n} материал(ов) останутся в базе (раздел «Материалы»). Их можно перенести в другой модуль.`
        : "\n\nМатериалы в базе не затронуты.";
    if (!window.confirm(`Убрать модуль «${m.name}» из списка?${extra}`)) return;
    await api.archiveModule(m.id);
    setSelectedModIds((prev) => {
      const next = new Set(prev);
      next.delete(m.id);
      return next;
    });
    if (editingMod?.id === m.id) setEditingMod(null);
    await reload();
    await actions.refresh();
  };

  const handleBulkArchive = async () => {
    const picked = archivableMods.filter((m) => selectedModIds.has(m.id));
    if (!picked.length) return;
    const totalMats = picked.reduce((s, m) => s + (m.materialCount || 0), 0);
    const names = picked.map((m) => `• ${m.name}`).join("\n");
    const extra =
      totalMats > 0
        ? `\n\n${totalMats} материал(ов) останутся в базе — ищите их в «Материалы».`
        : "";
    if (
      !window.confirm(
        `Убрать из списка ${picked.length} модул(ей)?\n\n${names}${extra}\n\nМодуль не удаляется навсегда — можно вернуть через «Показать архив».`
      )
    )
      return;
    for (const m of picked) await api.archiveModule(m.id);
    setSelectedModIds(new Set());
    await reload();
    await actions.refresh();
  };

  const handleBulkRestore = async () => {
    const picked = archivedVisibleMods.filter((m) => selectedModIds.has(m.id));
    if (!picked.length) return;
    if (!window.confirm(`Вернуть ${picked.length} модул(ей) из архива?`)) return;
    for (const m of picked) await api.restoreModule(m.id);
    setSelectedModIds(new Set());
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
        sub="Разделы фермы, состав стеллажей по умолчанию, пресеты и справочники."
        back={{ to: "/", label: "Проекты" }}
      />

      {inEditor && (
        <div className="subnav-back">
          <BackLink label={`К списку: ${tabLabel}`} onClick={exitEditor} />
        </div>
      )}

      {!inEditor && (
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
      )}

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

      {tab === "publish" && !editing && !editingSection && !editingMod && (
        <PublishRulesTab
          settings={appSettings}
          onSaved={async () => {
            await reload();
          }}
        />
      )}

      {tab === "stellage" && !inEditor && (
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
                    <StellagePhotoThumb
                      url={resolveStellagePhoto(stellageModuleMeta, p.moduleId, p.params?.photoUrl)}
                      size={72}
                    />
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
                      <button type="button" className="btn btn-sm" onClick={() => duplicateStellagePreset(p)}>
                        Копия
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

      {tab === "stellage_composition" && !inEditor && (
        <div className="content">
          <StellageGroupsEditor
            groups={stellageGroupsDraft}
            onChange={setStellageGroupsDraft}
          />
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn btn-sm" disabled={saving} onClick={saveStellageGroups}>
              Сохранить группы
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Шаблон по умолчанию для каждого типа стеллажа — попадает в мастер «Новый проект» и в пресеты. Отметьте
            позиции, укажите кол-во и группу состава.
          </p>
          {stellageMods.length === 0 ? (
            <p className="muted">Нет модулей типа «Стеллаж» — создайте в «Модули базы».</p>
          ) : (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <table className="spec">
                <thead>
                  <tr>
                    <th style={{ width: 64 }}>Фото</th>
                    <th>Тип стеллажа</th>
                    <th>Технология</th>
                    <th className="right" style={{ width: 90 }}>В шаблоне</th>
                    <th className="right" style={{ width: 220 }} />
                  </tr>
                </thead>
                <tbody>
                  {stellageMods.map((mod) => (
                    <tr key={mod.id}>
                      <td>
                        <StellagePhotoThumb url={stellageModulePhoto(stellageModuleMeta, mod.id)} />
                      </td>
                      <td>
                        <ModuleBadge mod={mod} />
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>{mod.tech || "—"}</td>
                      <td className="right num muted">{stellageCatalogCount(stellageCatalogs, mod.id)}</td>
                      <td className="right">
                        <button type="button" className="btn btn-sm" onClick={() => openStellageModuleEditor(mod)}>
                          Настроить
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Скопировать состав в другой тип"
                          onClick={() => copyStellageCatalogToModule(mod)}
                        >
                          Копия
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "farm" && !inEditor && (
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
                  <th className="right" style={{ width: 340 }} />
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
                        {farmSectionGroups.map((g) => (
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
                      <button type="button" className="btn btn-sm" onClick={() => duplicateFarmSection(sec)}>
                        Копия
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
          <div className="toolbar" style={{ marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={openNewModule}>
              ＋ Новый модуль
            </button>
            {selectedModIds.size > 0 && archivableMods.some((m) => selectedModIds.has(m.id)) && (
              <button type="button" className="btn btn-sm" onClick={handleBulkArchive}>
                В архив ({archivableMods.filter((m) => selectedModIds.has(m.id)).length})
              </button>
            )}
            {selectedModIds.size > 0 && archivedVisibleMods.some((m) => selectedModIds.has(m.id)) && (
              <button type="button" className="btn btn-sm" onClick={handleBulkRestore}>
                Вернуть из архива ({archivedVisibleMods.filter((m) => selectedModIds.has(m.id)).length})
              </button>
            )}
            <label className="row" style={{ gap: 6, marginLeft: "auto", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => {
                  setShowArchived(e.target.checked);
                  setSelectedModIds(new Set());
                }}
              />
              Показать архив
            </label>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Модули — «листы» каталога при сборке проекта. <strong>В архив</strong> = убрать из списка при
            создании проекта. <strong>Материалы не удаляются</strong> — остаются в «Материалы» с тем же названием
            модуля; при необходимости перенесите их в другой модуль.
          </p>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    {archivableMods.length > 0 && (
                      <input
                        type="checkbox"
                        title="Выбрать все"
                        checked={
                          archivableMods.length > 0 &&
                          archivableMods.every((m) => selectedModIds.has(m.id))
                        }
                        onChange={toggleSelectAllArchivable}
                      />
                    )}
                  </th>
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
                    <td className="center">
                      {(m.active === false || !PROTECTED_MODULE_NAMES.has(m.name)) && (
                        <input
                          type="checkbox"
                          checked={selectedModIds.has(m.id)}
                          onChange={() => toggleModSelection(m.id)}
                          title={PROTECTED_MODULE_NAMES.has(m.name) ? "Системный модуль" : "Выбрать"}
                          disabled={PROTECTED_MODULE_NAMES.has(m.name)}
                        />
                      )}
                    </td>
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
                        !PROTECTED_MODULE_NAMES.has(m.name) && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleArchiveModule(m)}>
                            В архив
                          </button>
                        )
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
            {editingMod.id && editingMod.active !== false && !PROTECTED_MODULE_NAMES.has(editingMod.name) && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleArchiveModule(editingMod)}
              >
                В архив
              </button>
            )}
            {editingMod.id && editingMod.active !== false && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginLeft: editingMod.active !== false && !PROTECTED_MODULE_NAMES.has(editingMod.name) ? 0 : "auto" }}
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
                    const meta = farmSectionGroups.find((g) => g.id === group);
                    setEditingSection({
                      ...editingSection,
                      group,
                      icon: editingSection.icon || meta?.icon,
                      color: editingSection.color || meta?.color,
                    });
                  }}
                >
                  {farmSectionGroups.map((g) => (
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

      {editingStellageMod && (
        <div className="content">
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>
              Состав по умолчанию: <ModuleBadge mod={editingStellageMod} />
            </h3>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
              Эти позиции подставляются при создании проекта и в новых пресетах. Группа состава — колонка «Группа» в
              таблице ниже.
            </p>
            <StellagePhotoField
              value={editingStellagePhoto}
              onChange={setEditingStellagePhoto}
              hint="Фото по умолчанию для этого типа стеллажа — подставляется в новый проект и в пресеты без своего фото."
            />
            <StellageGroupsEditor
              groups={stellageGroupsDraft}
              onChange={setStellageGroupsDraft}
              compact
            />
          </div>

          <SpecPickerTable
            lines={editLines}
            onChange={setEditLines}
            materials={state.materials}
            catalogModule={editingStellageMod.name}
            catalogLabel="позицию"
            onSaveMaterial={saveMaterial}
            categories={categories}
            suppliers={suppliers}
            showQty
            qtyLabel="Кол-во по умолч."
            showCompositionGroups
            stellageGroups={stellageGroupsDraft}
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={saveStellageModuleCatalog}>
              {saving ? "Сохранение…" : "Сохранить шаблон"}
            </button>
            <button type="button" className="btn" onClick={() => setEditingStellageMod(null)}>
              Отмена
            </button>
            {stellageMods.length > 1 && (
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                Скопировать из
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value;
                    e.target.value = "";
                    if (id) applyStellageCatalogFromModule(id);
                  }}
                >
                  <option value="">— тип стеллажа —</option>
                  {stellageMods
                    .filter((m) => m.id !== editingStellageMod.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({stellageCatalogCount(stellageCatalogs, m.id)} поз.)
                      </option>
                    ))}
                </select>
              </label>
            )}
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
                    setEditing({
                      ...editing,
                      moduleId: mod.id,
                      moduleName: mod.name,
                      note: mod.tech || "",
                      params: {
                        ...editing.params,
                        photoUrl: stellageModulePhoto(stellageModuleMeta, mod.id),
                      },
                    });
                    setEditLines(stellageCatalogEditorLines(stellageCatalogs, mod.id, state.materials, mod.name));
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
            <StellagePhotoField
              value={resolveStellagePhoto(stellageModuleMeta, editing.moduleId, editing.params?.photoUrl)}
              onChange={(url) => setPresetParam("photoUrl", url)}
              hint="Своё фото пресета. Если пусто — берётся из «Состав стеллажей» для выбранного типа."
            />
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
            stellageGroups={stellageGroupsDraft.length ? stellageGroupsDraft : ref.stellageGroups}
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
