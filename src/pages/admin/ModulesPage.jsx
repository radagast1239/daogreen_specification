import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import {
  catalogEditorLines,
  moveSection,
  newFarmSection,
  parseFarmSectionCatalogs,
  patchSectionName,
  removeSection,
  resolveFarmSections,
  stripLineIds,
} from "../../lib/farmSectionsConfig.js";
import { resolveCategories } from "../../lib/categories.js";
import { catalogLinesForModule } from "../../lib/projectBuilder.js";
import { cloneBuilderLines } from "../../lib/presetHelpers.js";
import { useStore } from "../../store/StoreContext.jsx";

const TABS = [
  { id: "stellage", label: "Пресеты стеллажей" },
  { id: "farm", label: "Разделы фермы" },
  { id: "catalog", label: "Модули базы" },
];

export default function ModulesPage() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState("farm");
  const [presets, setPresets] = useState([]);
  const [mods, setMods] = useState([]);
  const [farmSections, setFarmSections] = useState([]);
  const [farmCatalogs, setFarmCatalogs] = useState({});
  const [editing, setEditing] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [editLines, setEditLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const stellageMods = state.modules.filter((m) => m.type === "stellage");
  const stellagePresets = presets.filter((p) => p.presetType === "stellage");

  const persistFarm = async (sections, catalogs) => {
    await api.saveSettings({
      farmSections: JSON.stringify(sections),
      farmSectionCatalogs: JSON.stringify(catalogs),
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
    });
    setEditLines(mod?.name ? catalogLinesForModule(state.materials, mod.name) : []);
  };

  const openStellagePreset = (p) => {
    setEditingSection(null);
    setEditing(p);
    setEditLines(cloneBuilderLines(p.items));
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

  const deleteFarmSection = async (sec) => {
    if (!window.confirm(`Удалить раздел «${sec.name}» и его состав?`)) return;
    const { sections, catalogs } = removeSection(farmSections, farmCatalogs, sec.id);
    setFarmSections(sections);
    setFarmCatalogs(catalogs);
    if (editingSection?.id === sec.id) setEditingSection(null);
    await persistFarm(sections, catalogs);
  };

  const saveSectionCatalog = async () => {
    if (!editingSection) return;
    setSaving(true);
    try {
      const catalogs = {
        ...farmCatalogs,
        [editingSection.id]: stripLineIds(editLines),
      };
      const sections = patchSectionName(farmSections, editingSection.id, editingSection.name);
      setFarmCatalogs(catalogs);
      setFarmSections(sections);
      await persistFarm(sections, catalogs);
      setEditingSection(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveStellagePreset = async () => {
    if (!editing?.name?.trim()) {
      alert("Укажите название пресета.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...editing,
        items: editLines.map(({ id, ...rest }) => rest),
      };
      if (editing.id) await api.updatePreset(editing.id, body);
      else await api.createPreset(body);
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

      {tab === "stellage" && !editing && !editingSection && (
        <div className="content">
          <div className="toolbar">
            <button type="button" className="btn btn-primary btn-sm" onClick={startNewStellagePreset}>
              ＋ Новый пресет стеллажа
            </button>
          </div>
          {stellagePresets.length === 0 ? (
            <p className="muted">Пока нет сохранённых конфигураций стеллажей.</p>
          ) : (
            <div className="preset-grid">
              {stellagePresets.map((p) => (
                <div key={p.id} className="preset-card" style={{ cursor: "default" }}>
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {p.moduleName} · {p.items.filter((i) => i.included).length} поз.
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
          )}
        </div>
      )}

      {tab === "farm" && !editingSection && !editing && (
        <div className="content">
          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={addFarmSection}>
              ＋ Новый раздел
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Каждый раздел — шаблон списка материалов. В проекте вы отмечаете нужные позиции и задаёте количество при создании.
            Материалы можно брать из любого модуля базы.
          </p>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Раздел</th>
                  <th className="right" style={{ width: 90 }}>В составе</th>
                  <th className="right" style={{ width: 220 }} />
                </tr>
              </thead>
              <tbody>
                {farmSections.map((sec, i) => (
                  <tr key={sec.id}>
                    <td className="muted num">{i + 1}</td>
                    <td>
                      <input
                        className="spec-cell-input"
                        value={sec.name}
                        onChange={(e) =>
                          setFarmSections(patchSectionName(farmSections, sec.id, e.target.value))
                        }
                        onBlur={(e) => saveSectionName(sec.id, e.target.value)}
                      />
                    </td>
                    <td className="right num muted">{catalogCount(sec.id)}</td>
                    <td className="right">
                      <button type="button" className="btn btn-sm" onClick={() => openSectionEditor(sec)}>
                        Настроить состав
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
        </div>
      )}

      {tab === "catalog" && !editing && !editingSection && (
        <div className="content">
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="spec">
              <thead>
                <tr>
                  <th>Модуль</th>
                  <th>Тип</th>
                  <th>Технология</th>
                  <th className="right">Позиций</th>
                </tr>
              </thead>
              <tbody>
                {mods.map((m) => (
                  <tr key={m.id}>
                    <td><strong>{m.name}</strong></td>
                    <td className="muted">{m.type}</td>
                    <td className="muted">{m.tech}</td>
                    <td className="right num">{m.materialCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingSection && (
        <div className="content">
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Состав раздела: {editingSection.name}</h3>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
              Добавьте материалы из базы — они будут появляться в этом разделе при сборке каждого нового проекта.
              Галочка здесь означает «входит в шаблон раздела».
            </p>
            <label>
              Название раздела
              <input
                value={editingSection.name}
                onChange={(e) => setEditingSection({ ...editingSection, name: e.target.value })}
                onBlur={(e) => saveSectionName(editingSection.id, e.target.value)}
              />
            </label>
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
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={saveSectionCatalog}>
              {saving ? "Сохранение…" : "Сохранить раздел"}
            </button>
            <button type="button" className="btn" onClick={() => setEditingSection(null)}>
              Отмена
            </button>
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {editLines.length} поз. в шаблоне · {countIncluded(editLines)} отмечено
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
