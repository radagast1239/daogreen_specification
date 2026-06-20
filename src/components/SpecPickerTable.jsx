import React, { useMemo, useState } from "react";
import { groupLabel, STELLAGE_GROUPS } from "../../shared/stellageComposition.js";
import { CATEGORIES } from "../data/modules.js";
import { isExhaustFanName, isSplitSystemName } from "../lib/materialSpecs.js";
import { roomLabel } from "../lib/roomHelpers.js";
import {
  blankLine,
  lineFromMaterial,
  lineToMaterialPayload,
  syncLineFromMaterial,
} from "../lib/projectBuilder.js";
import { photoSrc, api } from "../lib/api.js";
import { linePhotoSrc, resolveLinePhoto } from "../lib/photoHelpers.js";
import { Modal } from "./ui.jsx";

function patchLine(lines, id, patch) {
  return lines.map((ln) => (ln.id === id ? { ...ln, ...patch } : ln));
}

export function countIncluded(lines) {
  return lines.filter((ln) => ln.included && ln.name?.trim()).length;
}

const emptyNew = () => ({
  name: "",
  unit: "шт.",
  price: 0,
  link: "",
  category: "Прочее",
  supplier: "",
});

function SpecFields({ ln, disabled, onPatch }) {
  const split = isSplitSystemName(ln.name);
  const exhaust = isExhaustFanName(ln.name);
  if (!split && !exhaust) return null;
  return (
    <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
      {split && (
        <>
          <label className="row" style={{ fontSize: 11, gap: 4 }}>
            кВт
            <input
              className="spec-cell-input spec-cell-input--sm"
              type="number"
              min={0}
              step="any"
              style={{ width: 56 }}
              disabled={disabled}
              value={ln.coolingKw || ""}
              onChange={(e) => onPatch({ coolingKw: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="row" style={{ fontSize: 11, gap: 4 }}>
            BTU
            <input
              className="spec-cell-input spec-cell-input--sm"
              type="number"
              min={0}
              step="any"
              style={{ width: 72 }}
              disabled={disabled}
              value={ln.coolingBtu || ""}
              onChange={(e) => onPatch({ coolingBtu: Number(e.target.value) || 0 })}
            />
          </label>
        </>
      )}
      {exhaust && (
        <label className="row" style={{ fontSize: 11, gap: 4 }}>
          м³/ч
          <input
            className="spec-cell-input spec-cell-input--sm"
            type="number"
            min={0}
            step="any"
            style={{ width: 72 }}
            disabled={disabled}
            value={ln.exhaustM3 || ""}
            onChange={(e) => onPatch({ exhaustM3: Number(e.target.value) || 0 })}
          />
        </label>
      )}
    </div>
  );
}

export default function SpecPickerTable({
  lines,
  onChange,
  materials = [],
  catalogModule = "",
  farmSectionId = "",
  catalogLabel = "из базы",
  emptyHint = "Выберите тип стеллажа — позиции появятся в таблице.",
  onSaveMaterial,
  categories: categoriesProp,
  suppliers = [],
  showQty = false,
  qtyLabel = "Кол-во",
  showCompositionGroups = false,
  stellageGroups = STELLAGE_GROUPS,
  units: unitsProp,
  rooms = [],
  showRoom = false,
}) {
  const categories = categoriesProp?.length ? categoriesProp : CATEGORIES;
  const unitOptions = unitsProp?.length ? unitsProp : ["шт.", "м", "м²", "м³", "кг", "л"];
  const groupTitle = (id) => stellageGroups.find((g) => g.id === id)?.label || groupLabel(id);
  const [picker, setPicker] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState(emptyNew);
  const [q, setQ] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [savingNew, setSavingNew] = useState(false);

  const catalog = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return materials.filter(
      (m) =>
        m.status === "active" &&
        (!catalogModule || m.module === catalogModule) &&
        (!farmSectionId || m.farmSectionId === farmSectionId) &&
        (!ql || m.name.toLowerCase().includes(ql))
    );
  }, [materials, catalogModule, farmSectionId, q]);

  const visibleLines = useMemo(() => {
    const sq = search.trim().toLowerCase();
    return lines.filter((ln) => {
      if (onlyOn && !ln.included) return false;
      if (sq && !ln.name.toLowerCase().includes(sq)) return false;
      return true;
    });
  }, [lines, onlyOn, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const ln of visibleLines) {
      const g = ln.subcategory || "other";
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(ln);
    }
    if (!showCompositionGroups) return map;
    const ordered = new Map();
    for (const sg of stellageGroups) {
      if (map.has(sg.id)) ordered.set(sg.id, map.get(sg.id));
    }
    if (map.has("other")) ordered.set("other", map.get("other"));
    for (const [g, arr] of map) {
      if (!ordered.has(g)) ordered.set(g, arr);
    }
    return ordered;
  }, [visibleLines, showCompositionGroups, stellageGroups]);

  const setAll = (included) => onChange(lines.map((ln) => ({ ...ln, included })));

  const toggleLine = (ln, included) => {
    const patch = { included };
    if (showQty && included && !ln.qty) patch.qty = 1;
    if (included && !ln.imageUrl && !ln.photoUrl && ln.materialId) {
      const img = resolveLinePhoto(ln, materials);
      if (img) {
        patch.imageUrl = img;
        patch.photoUrl = img;
      }
    }
    onChange(patchLine(lines, ln.id, patch));
  };

  const addFromCatalog = (mat) => {
    if (lines.some((ln) => ln.materialId === mat.id)) return;
    onChange([...lines, lineFromMaterial(mat, { included: true })]);
    setPicker(false);
    setQ("");
  };

  const saveLineToBase = async (ln) => {
    if (!onSaveMaterial || !ln.name?.trim()) return;
    const mod = catalogModule || ln.module || "Общая закупка на ферму";
    setSavingId(ln.id);
    try {
      const mat = await onSaveMaterial(lineToMaterialPayload(ln, mod, farmSectionId));
      onChange(patchLine(lines, ln.id, syncLineFromMaterial(ln, mat)));
    } catch (e) {
      alert(e.message || "Не удалось сохранить в базу");
    } finally {
      setSavingId(null);
    }
  };

  const createNewInBase = async () => {
    if (!onSaveMaterial) {
      onChange([...lines, blankLine({ ...newForm, included: true })]);
      setNewOpen(false);
      setNewForm(emptyNew());
      return;
    }
    if (!newForm.name.trim()) {
      alert("Укажите название позиции.");
      return;
    }
    const mod = catalogModule || newForm.module || "Общая закупка на ферму";
    setSavingNew(true);
    try {
      const mat = await onSaveMaterial(
        lineToMaterialPayload(
          { ...newForm, category: newForm.category },
          mod,
          farmSectionId
        )
      );
      onChange([
        ...lines,
        lineFromMaterial(mat, {
          included: true,
          price: newForm.price,
          ...(showQty ? { qty: 1 } : {}),
        }),
      ]);
      setNewOpen(false);
      setNewForm(emptyNew());
    } catch (e) {
      alert(e.message || "Не удалось сохранить в базу");
    } finally {
      setSavingNew(false);
    }
  };

  const colSpan = (showQty ? 10 : 9) + (showRoom ? 1 : 0) + (showCompositionGroups ? 1 : 0);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <input
          placeholder="Поиск по позициям…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 180, flex: "1 1 160px" }}
        />
        <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>
          Все ✓
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAll(false)}>
          Снять все
        </button>
        <label className="row" style={{ fontSize: 13, gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} />
          Только отмеченные
        </label>
        <button type="button" className="btn btn-sm" onClick={() => setPicker(true)}>
          ＋ {catalogLabel}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
          ＋ новая позиция в базу
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {countIncluded(lines)} / {lines.length} {showQty ? "в спецификации" : "отмечено"}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, padding: "12px 0" }}>
          {emptyHint}
        </p>
      ) : (
        <div className="card spec-picker-wrap" style={{ overflowX: "auto", padding: 0 }}>
          <table className="spec spec-picker">
            <thead>
              <tr>
                <th style={{ width: 112 }}>Фото</th>
                <th style={{ width: 40 }} title="Включить в спецификацию">✓</th>
                <th style={{ minWidth: 200 }}>Наименование</th>
                <th style={{ width: 120 }}>Категория</th>
                <th style={{ width: 110 }}>Поставщик</th>
                <th style={{ width: 72 }}>Ед.</th>
                {showCompositionGroups && <th style={{ width: 130 }}>Группа</th>}
                {showRoom && <th style={{ width: 130 }}>Комната</th>}
                {showQty && <th className="right" style={{ width: 96 }}>{qtyLabel}</th>}
                <th className="right" style={{ width: 110 }}>Цена, ₽</th>
                <th style={{ minWidth: 120 }}>Ссылка</th>
                <th style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {[...grouped.entries()].map(([g, grpLines]) => (
                <React.Fragment key={g}>
                  {g !== "other" && (
                    <tr>
                      <td colSpan={colSpan} className="spec-group-head">
                        {groupTitle(g)}
                      </td>
                    </tr>
                  )}
                  {grpLines.map((ln) => {
                    const src = linePhotoSrc(ln, materials);
                    return (
                    <tr key={ln.id} className={ln.included ? "" : "spec-row-off"}>
                      <td className="spec-photo">
                        {src ? (
                          <img src={src} alt="" className="thumb-img" />
                        ) : (
                          <div className="thumb" style={{ fontSize: 22 }}>
                            {(ln.name || "?").trim().charAt(0).toUpperCase()}
                          </div>
                        )}
                        <label className="btn btn-ghost btn-sm" style={{ marginTop: 4, fontSize: 11, padding: "2px 6px" }} title="Загрузить фото">
                          📷
                          <input
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const { url } = await api.uploadPhoto(file);
                                onChange(patchLine(lines, ln.id, { imageUrl: url, photoUrl: url }));
                              } catch (err) {
                                alert(err.message || "Ошибка загрузки");
                              }
                            }}
                          />
                        </label>
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          checked={!!ln.included}
                          onChange={(e) => toggleLine(ln, e.target.checked)}
                          title="Включить позицию"
                        />
                      </td>
                      <td>
                        <input
                          className="spec-cell-input"
                          value={ln.name}
                          placeholder="наименование"
                          onChange={(e) => onChange(patchLine(lines, ln.id, { name: e.target.value }))}
                        />
                        <SpecFields
                          ln={ln}
                          disabled={!ln.included}
                          onPatch={(patch) => onChange(patchLine(lines, ln.id, patch))}
                        />
                        {!ln.materialId && ln.name?.trim() && (
                          <span className="muted" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
                            не в базе
                          </span>
                        )}
                      </td>
                      <td>
                        <select
                          className="spec-cell-input"
                          value={ln.category || "Прочее"}
                          disabled={!ln.included}
                          onChange={(e) => onChange(patchLine(lines, ln.id, { category: e.target.value }))}
                        >
                          {categories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="spec-cell-input"
                          value={ln.supplier || ""}
                          disabled={!ln.included}
                          onChange={(e) => onChange(patchLine(lines, ln.id, { supplier: e.target.value }))}
                        >
                          <option value="">—</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {unitOptions.length > 1 ? (
                          <select
                            className="spec-cell-input spec-cell-input--sm"
                            value={ln.unit}
                            disabled={!ln.included}
                            onChange={(e) => onChange(patchLine(lines, ln.id, { unit: e.target.value }))}
                          >
                            {unitOptions.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="spec-cell-input spec-cell-input--sm"
                            value={ln.unit}
                            onChange={(e) => onChange(patchLine(lines, ln.id, { unit: e.target.value }))}
                          />
                        )}
                      </td>
                      {showCompositionGroups && (
                        <td>
                          <select
                            className="spec-cell-input"
                            value={ln.subcategory || ""}
                            disabled={!ln.included}
                            onChange={(e) =>
                              onChange(patchLine(lines, ln.id, { subcategory: e.target.value }))
                            }
                          >
                            <option value="">—</option>
                            {stellageGroups.map((g) => (
                              <option key={g.id} value={g.id}>{g.label}</option>
                            ))}
                          </select>
                        </td>
                      )}
                      {showRoom && (
                        <td>
                          <select
                            className="spec-cell-input"
                            value={ln.roomId || ""}
                            disabled={!ln.included}
                            onChange={(e) => onChange(patchLine(lines, ln.id, { roomId: e.target.value }))}
                          >
                            <option value="">—</option>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>{roomLabel(rooms, r.id) || r.name}</option>
                            ))}
                          </select>
                        </td>
                      )}
                      {showQty && (
                      <td>
                        <input
                          className="spec-cell-input spec-cell-input--num"
                          type="number"
                          min={0}
                          step="any"
                          value={ln.qty}
                          disabled={!ln.included}
                          onChange={(e) => onChange(patchLine(lines, ln.id, { qty: Number(e.target.value) || 0 }))}
                        />
                      </td>
                      )}
                      <td>
                        <input
                          className="spec-cell-input spec-cell-input--num"
                          type="number"
                          min={0}
                          step="any"
                          value={ln.price}
                          disabled={!ln.included}
                          onChange={(e) => onChange(patchLine(lines, ln.id, { price: Number(e.target.value) || 0 }))}
                        />
                      </td>
                      <td>
                        <input
                          className="spec-cell-input"
                          value={ln.link || ""}
                          placeholder="ссылка"
                          disabled={!ln.included}
                          onChange={(e) => onChange(patchLine(lines, ln.id, { link: e.target.value }))}
                        />
                      </td>
                      <td className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                        {!ln.materialId && onSaveMaterial && ln.name?.trim() && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="Сохранить в базу материалов"
                            disabled={savingId === ln.id}
                            onClick={() => saveLineToBase(ln)}
                          >
                            {savingId === ln.id ? "…" : "💾"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Удалить строку"
                          onClick={() => onChange(lines.filter((x) => x.id !== ln.id))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newOpen && (
        <Modal
          title="Новая позиция — сохранится в базу"
          onClose={() => !savingNew && setNewOpen(false)}
          footer={
            <>
              <button type="button" className="btn" disabled={savingNew} onClick={() => setNewOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" disabled={savingNew} onClick={createNewInBase}>
                {savingNew ? "Сохранение…" : "Сохранить и добавить"}
              </button>
            </>
          }
        >
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Позиция попадёт в базу материалов ({catalogModule || "модуль"}) и сразу в эту спецификацию.
          </p>
          <div className="form-grid">
            <label className="full">
              Наименование *
              <input
                value={newForm.name}
                onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </label>
            <label>
              Ед.
              <input value={newForm.unit} onChange={(e) => setNewForm((f) => ({ ...f, unit: e.target.value }))} />
            </label>
            <label>
              Цена, ₽
              <input
                type="number"
                min={0}
                value={newForm.price}
                onChange={(e) => setNewForm((f) => ({ ...f, price: Number(e.target.value) || 0 }))}
              />
            </label>
            <label>
              Категория
              <select value={newForm.category} onChange={(e) => setNewForm((f) => ({ ...f, category: e.target.value }))}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Поставщик
              <select value={newForm.supplier || ""} onChange={(e) => setNewForm((f) => ({ ...f, supplier: e.target.value }))}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Ссылка
              <input value={newForm.link} onChange={(e) => setNewForm((f) => ({ ...f, link: e.target.value }))} />
            </label>
          </div>
        </Modal>
      )}

      {picker && (
        <Modal title={`Добавить ${catalogLabel}`} onClose={() => setPicker(false)}>
          <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 12 }} />
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {catalog.slice(0, 80).map((m) => (
              <button
                key={m.id}
                type="button"
                className="panel"
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: 10, marginBottom: 6, cursor: "pointer" }}
                onClick={() => addFromCatalog(m)}
              >
                {(m.imageUrl || m.photoUrl) && (
                  <img src={photoSrc(m.imageUrl || m.photoUrl)} alt="" className="thumb-img" />
                )}
                <span style={{ flex: 1, fontSize: 13 }}>{m.name}</span>
                <span className="muted num" style={{ fontSize: 12 }}>
                  {m.unit}
                </span>
              </button>
            ))}
            {catalog.length === 0 && <p className="muted">Ничего не найдено</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
