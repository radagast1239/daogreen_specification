import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../../store/StoreContext.jsx";
import { buildItemsFromModules } from "../../lib/apiHelpers.js";
import { DEFAULT_MANUAL_PARAMS } from "../../lib/itemHelpers.js";
import { defaultStellageGroupIds } from "../../lib/referenceData.js";
import { selectionToApi } from "../../../shared/stellageComposition.js";
import StellageModulePicker from "../../components/StellageModulePicker.jsx";
import { PageHeader } from "../../components/Layout.jsx";

const blankZone = () => ({
  id: `z_${Date.now()}`,
  name: "",
  tech: "проточка",
  stellageCount: 1,
  irrigationPump: 1,
  drainPump: 1,
  nursery: false,
  pipeLength: "",
  cableLength: "",
  comment: "",
});

export default function NewProjectPage() {
  const { state, actions } = useStore();
  const ref = state.reference;
  const nav = useNavigate();

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
  });
  const [selected, setSelected] = useState({});
  const [zones, setZones] = useState([]);
  const [manualParams, setManualParams] = useState({ ...DEFAULT_MANUAL_PARAMS });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleModule = (mod) => {
    setSelected((s) => {
      const next = { ...s };
      if (next[mod.id] != null) delete next[mod.id];
      else if (mod.type === "stellage") {
        next[mod.id] = { count: 1, groups: defaultStellageGroupIds(ref.stellageGroups), excludedMaterialIds: [] };
      } else {
        next[mod.id] = 1;
      }
      return next;
    });
  };

  const setModuleSel = (modId, value) => {
    setSelected((s) => ({ ...s, [modId]: value }));
  };

  const matCount = (modName) => state.materials.filter((m) => m.module === modName).length;

  const create = async () => {
    setSaving(true);
    try {
      const sel = Object.entries(selected).map(([moduleId, v]) => selectionToApi(moduleId, v));
      const items = buildItemsFromModules(state.materials, state.modules, sel);
      const project = await actions.projectCreate({
        ...form,
        area: Number(form.area) || 0,
        height: Number(form.height) || 0,
        sowingArea: Number(form.sowingArea) || 0,
        selectedModules: sel,
        zones,
        manualParams,
        items,
      });
      nav(`/project/${project.id}`);
    } finally {
      setSaving(false);
    }
  };

  const canCreate = form.name.trim() && Object.keys(selected).length > 0;

  return (
    <>
      <PageHeader title="Новый проект" sub="Вводные, модули, зоны и ручные параметры коммуникаций" back={{ to: "/", label: "Проекты" }} />
      <div className="content" style={{ maxWidth: 900 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="spine" />
            <h3>Общие данные</h3>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Название проекта *</label>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ферма зелени 40 м²" />
            </div>
            <div className="field">
              <label>Клиент</label>
              <input value={form.client} onChange={(e) => set("client", e.target.value)} />
            </div>
            <div className="field">
              <label>Город</label>
              <input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="field">
              <label>Тип фермы</label>
              <select value={form.type} onChange={(e) => set("type", e.target.value)}>
                {ref.farmTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Площадь, м²</label>
              <input type="number" value={form.area} onChange={(e) => set("area", e.target.value)} />
            </div>
            <div className="field">
              <label>Высота потолка, м</label>
              <input type="number" value={form.height} onChange={(e) => set("height", e.target.value)} />
            </div>
            <div className="field">
              <label>Посевная площадь, м²</label>
              <input type="number" value={form.sowingArea} onChange={(e) => set("sowingArea", e.target.value)} />
            </div>
            <div className="field">
              <label>Валюта</label>
              <input value={form.currency} onChange={(e) => set("currency", e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 22, marginTop: 16 }}>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="spine" />
            <h3>Ручные параметры</h3>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {[
              ["waterLineLength", "Магистраль воды, м"],
              ["drainLineLength", "Дренаж / канализация, м"],
              ["cableLength", "Кабель, м"],
              ["toSewer", "До канализации, м"],
              ["toWater", "До воды, м"],
              ["toPanel", "До щита, м"],
              ["ventilationCapacity", "Вентиляция (м³/ч)"],
              ["coolingPower", "Охлаждение (кВт)"],
              ["tankVolume", "Ёмкость, л"],
              ["exhaust", "Вытяжка"],
              ["cooling", "Кондиционер"],
              ["ventilation", "Вентиляция"],
            ].map(([k, label]) => (
              <div className="field" key={k}>
                <label>{label}</label>
                <input
                  value={manualParams[k] ?? ""}
                  onChange={(e) => setManualParams((m) => ({ ...m, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Заметки по расчёту</label>
            <textarea rows={2} value={manualParams.notes || ""} onChange={(e) => setManualParams((m) => ({ ...m, notes: e.target.value }))} />
          </div>
        </div>

        <div className="card" style={{ padding: 22, marginTop: 16 }}>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="spine" />
            <h3>Зоны</h3>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setZones([...zones, blankZone()])}>
              ＋ зона
            </button>
          </div>
          {zones.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Опционально: группы стеллажей с одной культурой</p>
          ) : (
            zones.map((z, idx) => (
              <div key={z.id} className="panel" style={{ padding: 12, marginBottom: 10 }}>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <div className="field">
                    <label>Название</label>
                    <input
                      value={z.name}
                      onChange={(e) => {
                        const nz = [...zones];
                        nz[idx] = { ...z, name: e.target.value };
                        setZones(nz);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Стеллажей</label>
                    <input
                      type="number"
                      value={z.stellageCount}
                      onChange={(e) => {
                        const nz = [...zones];
                        nz[idx] = { ...z, stellageCount: Number(e.target.value) };
                        setZones(nz);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Рассадное</label>
                    <select
                      value={z.nursery ? "1" : "0"}
                      onChange={(e) => {
                        const nz = [...zones];
                        nz[idx] = { ...z, nursery: e.target.value === "1" };
                        setZones(nz);
                      }}
                    >
                      <option value="0">Нет</option>
                      <option value="1">Да</option>
                    </select>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card" style={{ padding: 22, marginTop: 16 }}>
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="spine" />
            <h3>Модули и состав стеллажей</h3>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Для стеллажей отметьте блоки состава (каркас, полив, свет…) и при необходимости снимите отдельные детали.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {state.modules.map((mod) => {
              const on = selected[mod.id] != null;
              const count = matCount(mod.name);
              return (
                <div
                  key={mod.id}
                  className="panel"
                  style={{
                    padding: 14,
                    borderColor: on ? "var(--brand)" : "var(--line)",
                    background: on ? "var(--brand-tint)" : "var(--paper)",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleModule(mod)}
                >
                  <div className="between">
                    <div>
                      <strong>{mod.name}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {mod.type === "stellage" ? "стеллаж" : "модуль"} · {count} позиц.
                      </div>
                    </div>
                    <input type="checkbox" readOnly checked={on} style={{ width: 18, height: 18 }} />
                  </div>
                  {on && mod.type === "stellage" && (
                    <StellageModulePicker
                      mod={mod}
                      materials={state.materials}
                      stellageGroups={ref.stellageGroups}
                      value={selected[mod.id]}
                      onChange={(v) => setModuleSel(mod.id, v)}
                    />
                  )}
                  {on && mod.type !== "stellage" && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                      Модуль целиком · {count} позиц.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="row" style={{ marginTop: 18, justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={() => nav("/")}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={!canCreate || saving} onClick={create}>
            {saving ? "Создание…" : "Сформировать спецификацию →"}
          </button>
        </div>
      </div>
    </>
  );
}
