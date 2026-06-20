import React, { useState, useEffect } from "react";
import { api } from "../../lib/api.js";
import {
  buildReferenceData,
  DEFAULT_UNITS,
  referenceToSettings,
  STATUS_CHIP_OPTIONS,
  slugId,
} from "../../lib/referenceData.js";

function StringListEditor({ items, onChange, placeholder = "Новое значение" }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        {items.map((item) => (
          <span key={item} className="chip row" style={{ gap: 6 }}>
            {item}
            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: "0 4px" }} onClick={() => onChange(items.filter((x) => x !== item))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        <button type="button" className="btn btn-sm" onClick={add}>＋</button>
      </div>
    </div>
  );
}

export default function DirectoriesTab({ settings, onSaved }) {
  const [ref, setRef] = useState(() => buildReferenceData(settings));
  const [saving, setSaving] = useState(false);
  const [newStatus, setNewStatus] = useState({ label: "", chip: "neutral", clientVisible: true });
  const [newRole, setNewRole] = useState({ label: "" });
  const [newGroup, setNewGroup] = useState({ label: "" });

  useEffect(() => {
    setRef(buildReferenceData(settings));
  }, [settings]);

  const patch = (key, value) => setRef((r) => ({ ...r, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(referenceToSettings(ref));
      onSaved?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetSection = (key) => {
    if (!window.confirm("Сбросить раздел к значениям по умолчанию?")) return;
    const empty = {};
    const rebuilt = buildReferenceData(empty);
    patch(key, rebuilt[key]);
  };

  const addPurchaseStatus = () => {
    const label = newStatus.label.trim();
    if (!label) return;
    const id = slugId(label);
    if (ref.purchaseStatuses.some((s) => s.id === id)) return;
    patch("purchaseStatuses", [...ref.purchaseStatuses, { id, label, chip: newStatus.chip, clientVisible: newStatus.clientVisible }]);
    setNewStatus({ label: "", chip: "neutral", clientVisible: true });
  };

  const addRole = () => {
    const label = newRole.label.trim();
    if (!label) return;
    const id = slugId(label);
    if (ref.responsibleRoles.some((r) => r.id === id)) return;
    patch("responsibleRoles", [...ref.responsibleRoles, { id, label }]);
    setNewRole({ label: "" });
  };

  const addStellageGroup = () => {
    const label = newGroup.label.trim();
    if (!label) return;
    const id = slugId(label);
    if (ref.stellageGroups.some((g) => g.id === id)) return;
    const order = ref.stellageGroups.length + 1;
    patch("stellageGroups", [...ref.stellageGroups, { id, label, order }]);
    setNewGroup({ label: "" });
  };

  const moveGroup = (id, dir) => {
    const list = [...ref.stellageGroups];
    const i = list.findIndex((g) => g.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch("stellageGroups", list.map((g, idx) => ({ ...g, order: idx + 1 })));
  };

  return (
    <div className="content">
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Общие списки для материалов, клиента и сборки стеллажей. Изменения применяются ко всему сервису.
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Теги материалов</h3>
        <StringListEditor items={ref.tags} onChange={(tags) => patch("tags", tags)} placeholder="охлаждение, NFT…" />
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => resetSection("tags")}>Сброс</button>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Единицы измерения</h3>
        <StringListEditor items={ref.units} onChange={(units) => patch("units", units)} placeholder="шт., м, м²…" />
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => patch("units", [...DEFAULT_UNITS])}>Стандартный набор</button>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Статусы закупки</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Снимите «Клиент» — статус только для админки.</p>
        <table className="spec" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Подпись</th>
              <th>Цвет</th>
              <th>Клиент</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ref.purchaseStatuses.map((s) => (
              <tr key={s.id}>
                <td>
                  <input
                    className="spec-cell-input"
                    value={s.label}
                    onChange={(e) =>
                      patch(
                        "purchaseStatuses",
                        ref.purchaseStatuses.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x))
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    className="spec-cell-input"
                    value={s.chip}
                    onChange={(e) =>
                      patch(
                        "purchaseStatuses",
                        ref.purchaseStatuses.map((x) => (x.id === s.id ? { ...x, chip: e.target.value } : x))
                      )
                    }
                  >
                    {STATUS_CHIP_OPTIONS.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={s.clientVisible !== false}
                    onChange={(e) =>
                      patch(
                        "purchaseStatuses",
                        ref.purchaseStatuses.map((x) =>
                          x.id === s.id ? { ...x, clientVisible: e.target.checked } : x
                        )
                      )
                    }
                  />
                </td>
                <td className="right">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => patch("purchaseStatuses", ref.purchaseStatuses.filter((x) => x.id !== s.id))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            placeholder="Новый статус"
            value={newStatus.label}
            onChange={(e) => setNewStatus({ ...newStatus, label: e.target.value })}
          />
          <select value={newStatus.chip} onChange={(e) => setNewStatus({ ...newStatus, chip: e.target.value })}>
            {STATUS_CHIP_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <label className="row" style={{ gap: 4, fontSize: 13 }}>
            <input type="checkbox" checked={newStatus.clientVisible} onChange={(e) => setNewStatus({ ...newStatus, clientVisible: e.target.checked })} />
            Клиент
          </label>
          <button type="button" className="btn btn-sm" onClick={addPurchaseStatus}>＋</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Исполнители (роли)</h3>
        <table className="spec" style={{ marginBottom: 12 }}>
          <thead>
            <tr><th>ID</th><th>Подпись</th><th /></tr>
          </thead>
          <tbody>
            {ref.responsibleRoles.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ fontSize: 12 }}>{r.id}</td>
                <td>
                  <input
                    className="spec-cell-input"
                    value={r.label}
                    onChange={(e) =>
                      patch(
                        "responsibleRoles",
                        ref.responsibleRoles.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x))
                      )
                    }
                  />
                </td>
                <td className="right">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch("responsibleRoles", ref.responsibleRoles.filter((x) => x.id !== r.id))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ gap: 8 }}>
          <input placeholder="Новая роль" value={newRole.label} onChange={(e) => setNewRole({ label: e.target.value })} />
          <button type="button" className="btn btn-sm" onClick={addRole}>＋</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Типы фермы</h3>
        <StringListEditor items={ref.farmTypes} onChange={(farmTypes) => patch("farmTypes", farmTypes)} placeholder="NFT, микрозелень…" />
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Группы состава стеллажа</h3>
        <table className="spec" style={{ marginBottom: 12 }}>
          <thead>
            <tr><th>#</th><th>Группа</th><th className="right" style={{ width: 100 }} /></tr>
          </thead>
          <tbody>
            {ref.stellageGroups.map((g, i) => (
              <tr key={g.id}>
                <td className="muted num">{i + 1}</td>
                <td>
                  <input
                    className="spec-cell-input"
                    value={g.label}
                    onChange={(e) =>
                      patch(
                        "stellageGroups",
                        ref.stellageGroups.map((x) => (x.id === g.id ? { ...x, label: e.target.value } : x))
                      )
                    }
                  />
                </td>
                <td className="right">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveGroup(g.id, "up")}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === ref.stellageGroups.length - 1} onClick={() => moveGroup(g.id, "down")}>↓</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch("stellageGroups", ref.stellageGroups.filter((x) => x.id !== g.id))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ gap: 8 }}>
          <input placeholder="Новая группа" value={newGroup.label} onChange={(e) => setNewGroup({ label: e.target.value })} />
          <button type="button" className="btn btn-sm" onClick={addStellageGroup}>＋</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Категории материалов</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Тот же список, что в «Настройках».</p>
        <StringListEditor items={ref.categories} onChange={(categories) => patch("categories", categories)} placeholder="Новая категория" />
      </div>

      <div className="toolbar">
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? "Сохранение…" : "Сохранить справочники"}
        </button>
      </div>
    </div>
  );
}
