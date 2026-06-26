import React from "react";
import { patchLine } from "../../shared/specLineFilters.js";
import { materialSpecSubtitle, hasStructuredSpecEditor } from "../lib/materialDisplay.js";
import StructuredSpecEditor from "./StructuredSpecEditor.jsx";
import PhotoUploadField from "./PhotoUploadField.jsx";
import { photoSrc } from "../lib/api.js";
import { linePhotoSrc } from "../lib/photoHelpers.js";
import { roomLabel } from "../lib/roomHelpers.js";

export default function SpecPickerLineRow({
  ln,
  materials,
  selectedIds,
  toggleSelected,
  toggleLine,
  staticNames,
  resolveLineDisplayName,
  normalizedLines,
  emitLines,
  categories,
  suppliers,
  unitOptions,
  showCompositionGroups,
  stellageGroups,
  showFarmLineGroups,
  farmLineGroups,
  showRoom,
  rooms,
  showQty,
  onSaveMaterial,
  savingId,
  saveLineToBase,
}) {
  return (
    <tr key={ln.id} className={ln.included ? "" : "spec-row-off"}>
      <td className="center">
        <input
          type="checkbox"
          checked={selectedIds.has(ln.id)}
          onChange={(e) => toggleSelected(ln.id, e.target.checked)}
        />
      </td>
      <td className="spec-photo">
        {ln.materialId ? (
          linePhotoSrc(ln, materials) ? (
            <img
              src={photoSrc(linePhotoSrc(ln, materials))}
              alt=""
              className="spec-photo-thumb"
              style={{ maxWidth: 96, maxHeight: 64, objectFit: "contain" }}
            />
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>
              —
            </span>
          )
        ) : (
          <PhotoUploadField
            compact
            showUrlInput={false}
            value={ln.imageUrl || ln.photoUrl || ""}
            onChange={(url) => emitLines(patchLine(normalizedLines, ln.id, { imageUrl: url, photoUrl: url }))}
          />
        )}
      </td>
      <td className="center">
        <input
          type="checkbox"
          checked={!!ln.included}
          onChange={(e) => toggleLine(ln, e.target.checked)}
          title="Включить позицию"
        />
      </td>
      <td className={staticNames || ln.materialId ? "spec-picker-name-cell" : undefined}>
        {staticNames || ln.materialId ? (
          <div className="spec-picker-name-static" title={resolveLineDisplayName(ln, materials)}>
            {resolveLineDisplayName(ln, materials)}
          </div>
        ) : (
          <input
            className="spec-cell-input"
            value={ln.name}
            placeholder="наименование"
            onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { name: e.target.value }))}
          />
        )}
        {!ln.materialId && ln.name?.trim() && (
          <span className="muted" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
            не в базе — сохраните в базу материалов
          </span>
        )}
        <StructuredSpecEditor
          compact
          name={staticNames || ln.materialId ? resolveLineDisplayName(ln, materials) : ln.name}
          values={ln}
          disabled={!ln.included}
          onChange={(patch) => emitLines(patchLine(normalizedLines, ln.id, patch))}
        />
        {!hasStructuredSpecEditor(ln.name) && materialSpecSubtitle(ln) && (
          <span className="muted" style={{ fontSize: 10, display: "block", marginTop: 2 }}>
            {materialSpecSubtitle(ln)}
          </span>
        )}
      </td>
      <td>
        <select
          className="spec-cell-input"
          value={ln.category || "Прочее"}
          disabled={!ln.included || !!ln.materialId}
          onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { category: e.target.value }))}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          className="spec-cell-input"
          value={ln.supplier || ""}
          disabled={!ln.included || !!ln.materialId}
          onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { supplier: e.target.value }))}
        >
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        {unitOptions.length > 1 ? (
          <select
            className="spec-cell-input spec-cell-input--sm"
            value={ln.unit}
            disabled={!ln.included || !!ln.materialId}
            onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { unit: e.target.value }))}
          >
            {unitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="spec-cell-input spec-cell-input--sm"
            value={ln.unit}
            disabled={!!ln.materialId}
            onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { unit: e.target.value }))}
          />
        )}
      </td>
      {showCompositionGroups && (
        <td>
          <select
            className="spec-cell-input"
            value={ln.subcategory || ""}
            onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { subcategory: e.target.value }))}
          >
            <option value="">—</option>
            {stellageGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </td>
      )}
      {showFarmLineGroups && (
        <td>
          <select
            className="spec-cell-input"
            value={ln.farmGroup || ln.subcategory || ""}
            onChange={(e) =>
              emitLines(
                patchLine(normalizedLines, ln.id, {
                  farmGroup: e.target.value,
                  subcategory: e.target.value,
                })
              )
            }
          >
            <option value="">—</option>
            {farmLineGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
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
            onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { roomId: e.target.value }))}
          >
            <option value="">—</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {roomLabel(rooms, r.id) || r.name}
              </option>
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
            onChange={(e) => {
              const qty = Number(e.target.value) || 0;
              emitLines(patchLine(normalizedLines, ln.id, { qty, defaultQty: qty }));
            }}
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
          disabled={!ln.included || !!ln.materialId}
          onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { price: Number(e.target.value) || 0 }))}
        />
      </td>
      <td>
        <input
          className="spec-cell-input"
          value={ln.link || ""}
          placeholder="ссылка"
          disabled={!ln.included || !!ln.materialId}
          onChange={(e) => emitLines(patchLine(normalizedLines, ln.id, { link: e.target.value }))}
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
          onClick={() => emitLines(normalizedLines.filter((x) => x.id !== ln.id))}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
