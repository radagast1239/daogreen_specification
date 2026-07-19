import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import {
  buildReferenceData,
  DEFAULT_UNITS,
  referenceToSettings,
  STATUS_CHIP_OPTIONS,
  slugId,
} from "../../lib/referenceData.js";
import { emptySearchMessage, filterByQuery } from "../../lib/modulesListView.js";
import {
  ModulesSearch,
  RowActionsMenu,
  StickySaveBar,
  TechDetails,
} from "../../components/modulesUi.jsx";

function StringListEditor({ items, onChange, placeholder = "Новое значение", addLabel = "+ Добавить" }) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const visible = filterByQuery(items, query, (x) => x);
  const emptyMsg = emptySearchMessage(query, visible.length);

  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft("");
  };

  return (
    <div>
      <div className="modules-list-toolbar">
        <ModulesSearch value={query} onChange={setQuery} placeholder="Поиск…" />
      </div>
      {emptyMsg ? (
        <p className="muted modules-empty">{emptyMsg}</p>
      ) : (
        <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
          {visible.map((item) => (
            <span key={item} className="chip row" style={{ gap: 6 }}>
              {item}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: "0 4px" }}
                onClick={() => onChange(items.filter((x) => x !== item))}
                title="Удалить"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <button type="button" className="btn btn-sm" onClick={add}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function EditableTextRow({
  index,
  title,
  meta,
  editing,
  onStartEdit,
  onCancelEdit,
  editFields,
  menuItems,
  primaryAction,
}) {
  return (
    <tr className={"modules-row" + (editing ? " modules-row--editing" : "")}>
      <td className="muted num">{index}</td>
      <td>
        {editing ? (
          <div className="modules-row__edit">{editFields}</div>
        ) : (
          <div className="modules-row__view">
            <strong className="modules-row__title">{title}</strong>
            {meta ? <span className="muted modules-row__meta">{meta}</span> : null}
          </div>
        )}
      </td>
      <td className="right modules-row__actions">
        {editing ? (
          <button type="button" className="btn btn-sm" onClick={onCancelEdit}>
            Готово
          </button>
        ) : (
          <>
            {primaryAction}
            <RowActionsMenu items={menuItems} />
          </>
        )}
      </td>
    </tr>
  );
}

export default function DirectoriesTab({ settings, onSaved }) {
  const [ref, setRef] = useState(() => buildReferenceData(settings));
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [newStatus, setNewStatus] = useState({ label: "", chip: "neutral", clientVisible: true });
  const [newRole, setNewRole] = useState({ label: "" });
  const [newGroup, setNewGroup] = useState({ label: "" });
  const [newFarmGroup, setNewFarmGroup] = useState({ label: "", icon: "📋" });
  const [statusQuery, setStatusQuery] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [farmGroupQuery, setFarmGroupQuery] = useState("");
  const [stellageGroupQuery, setStellageGroupQuery] = useState("");
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    setRef(buildReferenceData(settings));
    setEditingId(null);
  }, [settings]);

  const baseline = useMemo(() => JSON.stringify(buildReferenceData(settings)), [settings]);
  const dirty = JSON.stringify(ref) !== baseline;

  const patch = (key, value) => setRef((r) => ({ ...r, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(referenceToSettings(ref));
      onSaved?.();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setRef(buildReferenceData(settings));
    setEditingId(null);
  };

  const addPurchaseStatus = () => {
    const label = newStatus.label.trim();
    if (!label) return;
    const id = slugId(label);
    if (ref.purchaseStatuses.some((s) => s.id === id)) return;
    patch("purchaseStatuses", [
      ...ref.purchaseStatuses,
      { id, label, chip: newStatus.chip, clientVisible: newStatus.clientVisible },
    ]);
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
    patch(
      "stellageGroups",
      list.map((g, idx) => ({ ...g, order: idx + 1 }))
    );
  };

  const addFarmSectionGroup = () => {
    const label = newFarmGroup.label.trim();
    if (!label) return;
    const id = slugId(label);
    if (ref.farmSectionGroups.some((g) => g.id === id)) return;
    patch("farmSectionGroups", [
      ...ref.farmSectionGroups,
      { id, label, icon: newFarmGroup.icon || "📋", color: "#116355", order: ref.farmSectionGroups.length },
    ]);
    setNewFarmGroup({ label: "", icon: "📋" });
  };

  const moveFarmSectionGroup = (id, dir) => {
    const list = [...ref.farmSectionGroups];
    const i = list.findIndex((g) => g.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch(
      "farmSectionGroups",
      list.map((g, idx) => ({ ...g, order: idx }))
    );
  };

  const statuses = filterByQuery(ref.purchaseStatuses, statusQuery, (s) => `${s.label} ${s.id}`);
  const roles = filterByQuery(ref.responsibleRoles, roleQuery, (r) => `${r.label} ${r.id}`);
  const farmGroups = filterByQuery(
    ref.farmSectionGroups,
    farmGroupQuery,
    (g) => `${g.label} ${g.id} ${g.icon || ""}`
  );
  const stellageGroups = filterByQuery(ref.stellageGroups, stellageGroupQuery, (g) => `${g.label} ${g.id}`);

  return (
    <div className="content modules-page-panel">
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Общие списки для материалов, клиента и сборки стеллажей. Изменения применяются ко всему сервису.
      </p>

      <div className="card modules-card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Единицы измерения</h3>
        <StringListEditor
          items={ref.units}
          onChange={(units) => patch("units", units)}
          placeholder="шт., м, м²…"
          addLabel="+ Добавить"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => patch("units", [...DEFAULT_UNITS])}
        >
          Стандартный набор
        </button>
      </div>

      <div className="card modules-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="modules-card__head">
          <h3 style={{ margin: 0 }}>Статусы закупки</h3>
          <ModulesSearch value={statusQuery} onChange={setStatusQuery} placeholder="Поиск статусов…" />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Снимите «Клиент» — статус только для админки.
        </p>
        {emptySearchMessage(statusQuery, statuses.length) ? (
          <p className="muted modules-empty">{emptySearchMessage(statusQuery, statuses.length)}</p>
        ) : (
          <div className="modules-table-wrap" style={{ marginBottom: 12 }}>
          <table className="spec modules-compact-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Статус</th>
                <th className="right" style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {statuses.map((s, i) => {
                const chipLabel = STATUS_CHIP_OPTIONS.find((c) => c.id === s.chip)?.label || s.chip;
                const editing = editingId === `status:${s.id}`;
                return (
                  <EditableTextRow
                    key={s.id}
                    index={i + 1}
                    title={s.label}
                    meta={`${chipLabel}${s.clientVisible === false ? " · скрыт у клиента" : ""}`}
                    editing={editing}
                    onStartEdit={() => setEditingId(`status:${s.id}`)}
                    onCancelEdit={() => setEditingId(null)}
                    editFields={
                      <>
                        <input
                          className="spec-cell-input"
                          value={s.label}
                          onChange={(e) =>
                            patch(
                              "purchaseStatuses",
                              ref.purchaseStatuses.map((x) =>
                                x.id === s.id ? { ...x, label: e.target.value } : x
                              )
                            )
                          }
                        />
                        <select
                          className="spec-cell-input"
                          value={s.chip}
                          onChange={(e) =>
                            patch(
                              "purchaseStatuses",
                              ref.purchaseStatuses.map((x) =>
                                x.id === s.id ? { ...x, chip: e.target.value } : x
                              )
                            )
                          }
                        >
                          {STATUS_CHIP_OPTIONS.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <label className="row" style={{ gap: 4, fontSize: 13 }}>
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
                          Клиент
                        </label>
                        <TechDetails>
                          <code>{s.id}</code>
                        </TechDetails>
                      </>
                    }
                    menuItems={[
                      {
                        id: "edit",
                        label: "Редактировать",
                        onClick: () => setEditingId(`status:${s.id}`),
                      },
                      {
                        id: "delete",
                        label: "Удалить",
                        danger: true,
                        onClick: () =>
                          patch(
                            "purchaseStatuses",
                            ref.purchaseStatuses.filter((x) => x.id !== s.id)
                          ),
                      },
                    ]}
                  />
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            placeholder="Новый статус"
            value={newStatus.label}
            onChange={(e) => setNewStatus({ ...newStatus, label: e.target.value })}
          />
          <select
            value={newStatus.chip}
            onChange={(e) => setNewStatus({ ...newStatus, chip: e.target.value })}
          >
            {STATUS_CHIP_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="row" style={{ gap: 4, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={newStatus.clientVisible}
              onChange={(e) => setNewStatus({ ...newStatus, clientVisible: e.target.checked })}
            />
            Клиент
          </label>
          <button type="button" className="btn btn-sm" onClick={addPurchaseStatus}>
            + Новый статус
          </button>
        </div>
      </div>

      <div className="card modules-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="modules-card__head">
          <h3 style={{ margin: 0 }}>Исполнители (роли)</h3>
          <ModulesSearch value={roleQuery} onChange={setRoleQuery} placeholder="Поиск ролей…" />
        </div>
        {emptySearchMessage(roleQuery, roles.length) ? (
          <p className="muted modules-empty">{emptySearchMessage(roleQuery, roles.length)}</p>
        ) : (
          <div className="modules-table-wrap" style={{ marginBottom: 12, marginTop: 10 }}>
          <table className="spec modules-compact-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Роль</th>
                <th className="right" style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {roles.map((r, i) => {
                const editing = editingId === `role:${r.id}`;
                return (
                  <EditableTextRow
                    key={r.id}
                    index={i + 1}
                    title={r.label}
                    editing={editing}
                    onStartEdit={() => setEditingId(`role:${r.id}`)}
                    onCancelEdit={() => setEditingId(null)}
                    editFields={
                      <>
                        <input
                          className="spec-cell-input"
                          value={r.label}
                          onChange={(e) =>
                            patch(
                              "responsibleRoles",
                              ref.responsibleRoles.map((x) =>
                                x.id === r.id ? { ...x, label: e.target.value } : x
                              )
                            )
                          }
                        />
                        <TechDetails>
                          <code>{r.id}</code>
                        </TechDetails>
                      </>
                    }
                    menuItems={[
                      {
                        id: "edit",
                        label: "Редактировать",
                        onClick: () => setEditingId(`role:${r.id}`),
                      },
                      {
                        id: "delete",
                        label: "Удалить",
                        danger: true,
                        onClick: () =>
                          patch(
                            "responsibleRoles",
                            ref.responsibleRoles.filter((x) => x.id !== r.id)
                          ),
                      },
                    ]}
                  />
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="Новая роль"
            value={newRole.label}
            onChange={(e) => setNewRole({ label: e.target.value })}
          />
          <button type="button" className="btn btn-sm" onClick={addRole}>
            + Новая роль
          </button>
        </div>
      </div>

      <div className="card modules-card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Типы фермы</h3>
        <StringListEditor
          items={ref.farmTypes}
          onChange={(farmTypes) => patch("farmTypes", farmTypes)}
          placeholder="NFT, микрозелень…"
          addLabel="+ Добавить тип"
        />
      </div>

      <div className="card modules-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="modules-card__head">
          <h3 style={{ margin: 0 }}>Группы разделов фермы</h3>
          <ModulesSearch
            value={farmGroupQuery}
            onChange={setFarmGroupQuery}
            placeholder="Поиск групп…"
          />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Колонка «Группа» на вкладке «Разделы».
        </p>
        {emptySearchMessage(farmGroupQuery, farmGroups.length) ? (
          <p className="muted modules-empty">{emptySearchMessage(farmGroupQuery, farmGroups.length)}</p>
        ) : (
          <div className="modules-table-wrap" style={{ marginBottom: 12 }}>
          <table className="spec modules-compact-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Группа</th>
                <th className="right" style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {farmGroups.map((g, i) => {
                const fullIndex = ref.farmSectionGroups.findIndex((x) => x.id === g.id);
                const editing = editingId === `fsg:${g.id}`;
                return (
                  <EditableTextRow
                    key={g.id}
                    index={i + 1}
                    title={
                      <span className="row" style={{ gap: 6 }}>
                        <span aria-hidden>{g.icon}</span>
                        {g.label}
                      </span>
                    }
                    editing={editing}
                    onStartEdit={() => setEditingId(`fsg:${g.id}`)}
                    onCancelEdit={() => setEditingId(null)}
                    editFields={
                      <>
                        <input
                          className="spec-cell-input"
                          style={{ width: 48, textAlign: "center" }}
                          value={g.icon || ""}
                          onChange={(e) =>
                            patch(
                              "farmSectionGroups",
                              ref.farmSectionGroups.map((x) =>
                                x.id === g.id ? { ...x, icon: e.target.value } : x
                              )
                            )
                          }
                        />
                        <input
                          className="spec-cell-input"
                          value={g.label}
                          onChange={(e) =>
                            patch(
                              "farmSectionGroups",
                              ref.farmSectionGroups.map((x) =>
                                x.id === g.id ? { ...x, label: e.target.value } : x
                              )
                            )
                          }
                        />
                        <TechDetails>
                          <code>{g.id}</code>
                        </TechDetails>
                      </>
                    }
                    menuItems={[
                      {
                        id: "edit",
                        label: "Редактировать",
                        onClick: () => setEditingId(`fsg:${g.id}`),
                      },
                      {
                        id: "up",
                        label: "Переместить выше",
                        disabled: fullIndex <= 0,
                        onClick: () => moveFarmSectionGroup(g.id, "up"),
                      },
                      {
                        id: "down",
                        label: "Переместить ниже",
                        disabled: fullIndex < 0 || fullIndex >= ref.farmSectionGroups.length - 1,
                        onClick: () => moveFarmSectionGroup(g.id, "down"),
                      },
                      {
                        id: "delete",
                        label: "Удалить",
                        danger: true,
                        onClick: () =>
                          patch(
                            "farmSectionGroups",
                            ref.farmSectionGroups.filter((x) => x.id !== g.id)
                          ),
                      },
                    ]}
                  />
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="Иконка"
            value={newFarmGroup.icon}
            onChange={(e) => setNewFarmGroup({ ...newFarmGroup, icon: e.target.value })}
            style={{ width: 56 }}
          />
          <input
            placeholder="Новая группа"
            value={newFarmGroup.label}
            onChange={(e) => setNewFarmGroup({ ...newFarmGroup, label: e.target.value })}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-sm" onClick={addFarmSectionGroup}>
            + Новая группа
          </button>
        </div>
      </div>

      <div className="card modules-card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="modules-card__head">
          <h3 style={{ margin: 0 }}>Группы состава стеллажа</h3>
          <ModulesSearch
            value={stellageGroupQuery}
            onChange={setStellageGroupQuery}
            placeholder="Поиск групп…"
          />
        </div>
        {emptySearchMessage(stellageGroupQuery, stellageGroups.length) ? (
          <p className="muted modules-empty">
            {emptySearchMessage(stellageGroupQuery, stellageGroups.length)}
          </p>
        ) : (
          <div className="modules-table-wrap" style={{ marginBottom: 12, marginTop: 10 }}>
          <table className="spec modules-compact-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Группа</th>
                <th className="right" style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {stellageGroups.map((g, i) => {
                const fullIndex = ref.stellageGroups.findIndex((x) => x.id === g.id);
                const editing = editingId === `sg:${g.id}`;
                return (
                  <EditableTextRow
                    key={g.id}
                    index={i + 1}
                    title={g.label}
                    editing={editing}
                    onStartEdit={() => setEditingId(`sg:${g.id}`)}
                    onCancelEdit={() => setEditingId(null)}
                    editFields={
                      <>
                        <input
                          className="spec-cell-input stellage-group-name-input"
                          value={g.label}
                          onChange={(e) =>
                            patch(
                              "stellageGroups",
                              ref.stellageGroups.map((x) =>
                                x.id === g.id ? { ...x, label: e.target.value } : x
                              )
                            )
                          }
                        />
                        <TechDetails>
                          <code>{g.id}</code>
                        </TechDetails>
                      </>
                    }
                    menuItems={[
                      {
                        id: "edit",
                        label: "Редактировать",
                        onClick: () => setEditingId(`sg:${g.id}`),
                      },
                      {
                        id: "up",
                        label: "Переместить выше",
                        disabled: fullIndex <= 0,
                        onClick: () => moveGroup(g.id, "up"),
                      },
                      {
                        id: "down",
                        label: "Переместить ниже",
                        disabled: fullIndex < 0 || fullIndex >= ref.stellageGroups.length - 1,
                        onClick: () => moveGroup(g.id, "down"),
                      },
                      {
                        id: "delete",
                        label: "Удалить",
                        danger: true,
                        onClick: () =>
                          patch(
                            "stellageGroups",
                            ref.stellageGroups.filter((x) => x.id !== g.id)
                          ),
                      },
                    ]}
                  />
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="Новая группа"
            value={newGroup.label}
            onChange={(e) => setNewGroup({ label: e.target.value })}
          />
          <button type="button" className="btn btn-sm" onClick={addStellageGroup}>
            + Новая группа
          </button>
        </div>
      </div>

      <div className="card modules-card" style={{ padding: 16, marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Категории материалов</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Тот же список, что в «Настройках».
        </p>
        <StringListEditor
          items={ref.categories}
          onChange={(categories) => patch("categories", categories)}
          placeholder="Новая категория"
          addLabel="+ Новая категория"
        />
      </div>

      <StickySaveBar
        dirty={dirty}
        saving={saving}
        saved={savedFlash}
        onSave={save}
        onCancel={cancel}
        saveLabel="Сохранить справочники"
      />
    </div>
  );
}
