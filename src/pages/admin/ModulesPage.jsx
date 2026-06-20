import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import SpecPickerTable, { countIncluded } from "../../components/SpecPickerTable.jsx";
import { orderedFarmSections, moveSectionOrder } from "../../lib/farmSectionOrder.js";
import {
  catalogLinesForModule,
} from "../../lib/projectBuilder.js";
import {
  cloneBuilderLines,
} from "../../lib/presetHelpers.js";
import { useStore } from "../../store/StoreContext.jsx";

const TABS = [
  { id: "stellage", label: "Пресеты стеллажей" },
  { id: "farm", label: "Пресеты разделов фермы" },
  { id: "order", label: "Порядок разделов" },
  { id: "catalog", label: "Модули базы" },
];

export default function ModulesPage() {
  const { state, actions } = useStore();
  const [tab, setTab] = useState("stellage");
  const [presets, setPresets] = useState([]);
  const [mods, setMods] = useState([]);
  const [sectionOrder, setSectionOrder] = useState("");
  const [editing, setEditing] = useState(null);
  const [editLines, setEditLines] = useState([]);
  const [saving, setSaving] = useState(false);

  const sections = useMemo(() => orderedFarmSections(sectionOrder), [sectionOrder]);
  const stellageMods = state.modules.filter((m) => m.type === "stellage");

  const reload = useCallback(async () => {
    const [p, m, s] = await Promise.all([api.getPresets(), api.getModulesAdmin(), api.getSettings()]);
    setPresets(p);
    setMods(m);
    setSectionOrder(s.farmSectionOrder || "");
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const stellagePresets = presets.filter((p) => p.presetType === "stellage");
  const farmPresets = presets.filter((p) => p.presetType === "farm_section");

  const saveMaterial = async (payload) => {
    const m = await actions.materialAdd(payload);
    await actions.refresh();
    return m;
  };

  const startNewStellagePreset = () => {
    const mod = stellageMods[0];
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

  const startNewFarmPreset = (section) => {
    setEditing({
      id: null,
      name: "",
      presetType: "farm_section",
      moduleId: "",
      moduleName: section.module,
      sectionId: section.id,
    });
    setEditLines(catalogLinesForModule(state.materials, section.module));
  };

  const openPreset = (p) => {
    setEditing(p);
    setEditLines(cloneBuilderLines(p.items));
  };

  const changeEditModule = (moduleId) => {
    const mod = stellageMods.find((m) => m.id === moduleId);
    if (!mod) return;
    setEditing((e) => ({ ...e, moduleId: mod.id, moduleName: mod.name, note: mod.tech || "" }));
    setEditLines(catalogLinesForModule(state.materials, mod.name));
  };

  const savePreset = async () => {
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

  const moveSection = async (id, dir) => {
    const next = moveSectionOrder(sectionOrder, id, dir);
    setSectionOrder(next);
    await api.saveSettings({ farmSectionOrder: next });
  };

  return (
    <>
      <PageHeader
        title="Пресеты и структура фермы"
        sub="Сохраняйте готовые конфигурации стеллажей и разделов — потом выбирайте их при создании проекта."
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

      {tab === "stellage" && !editing && (
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
                    <button type="button" className="btn btn-sm" onClick={() => openPreset(p)}>
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

      {tab === "farm" && !editing && (
        <div className="content">
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Пресет привязан к разделу фермы. При сборке проекта можно загрузить его одним кликом.
          </p>
          {sections.map((sec) => {
            const list = farmPresets.filter((p) => p.sectionId === sec.id);
            return (
              <div key={sec.id} className="card" style={{ padding: 14, marginBottom: 12 }}>
                <div className="between" style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>{sec.name}</strong>
                  <button type="button" className="btn btn-sm" onClick={() => startNewFarmPreset(sec)}>
                    ＋ Пресет
                  </button>
                </div>
                {list.length === 0 ? (
                  <span className="muted" style={{ fontSize: 12 }}>Нет пресетов</span>
                ) : (
                  <div className="preset-grid">
                    {list.map((p) => (
                      <div key={p.id} className="preset-card" style={{ cursor: "default" }}>
                        <strong>{p.name}</strong>
                        <span className="muted">{p.items.filter((i) => i.included).length} поз.</span>
                        <div className="row" style={{ marginTop: 8, gap: 6 }}>
                          <button type="button" className="btn btn-sm" onClick={() => openPreset(p)}>
                            Изменить
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
            );
          })}
        </div>
      )}

      {tab === "order" && (
        <div className="content">
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Порядок разделов на шаге «Ферма целиком» при создании проекта.
          </p>
          <div className="card" style={{ padding: 0, overflow: "hidden", maxWidth: 560 }}>
            <table className="spec">
              <tbody>
                {sections.map((sec, i) => (
                  <tr key={sec.id}>
                    <td style={{ width: 40 }} className="muted num">{i + 1}</td>
                    <td>{sec.name}</td>
                    <td className="right" style={{ width: 100 }}>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveSection(sec.id, "up")}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={i === sections.length - 1}
                        onClick={() => moveSection(sec.id, "down")}
                      >
                        ↓
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "catalog" && (
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

      {editing && (
        <div className="content">
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{editing.id ? "Редактирование пресета" : "Новый пресет"}</h3>
            <div className="form-grid">
              <label>
                Название пресета *
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              {editing.presetType === "stellage" ? (
                <label>
                  Тип стеллажа
                  <select value={editing.moduleId} onChange={(e) => changeEditModule(e.target.value)}>
                    {stellageMods.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Раздел
                  <input value={editing.moduleName} disabled />
                </label>
              )}
            </div>
          </div>

          <SpecPickerTable
            lines={editLines}
            onChange={setEditLines}
            materials={state.materials}
            catalogModule={editing.moduleName}
            catalogLabel="позицию"
            onSaveMaterial={saveMaterial}
          />

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={savePreset}>
              {saving ? "Сохранение…" : "Сохранить пресет"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Отмена
            </button>
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
              {countIncluded(editLines)} поз. в пресете
            </span>
          </div>
        </div>
      )}
    </>
  );
}
