import React from "react";
import { formatMaterialModulesLabel } from "../../shared/materialModules.js";
import { materialSpecSubtitle } from "../lib/materialDisplay.js";
import { photoSrc } from "../lib/api.js";

export default function CatalogPickerMaterialRow({
  m,
  added,
  picked,
  onTogglePick,
  onAddOne,
}) {
  const src = photoSrc(m.imageUrl || m.photoUrl);
  return (
    <tr
      className={
        (added ? "material-picker-row--added " : "") + (picked ? "material-picker-row--picked" : "")
      }
    >
      <td style={{ width: 36 }}>
        <input
          type="checkbox"
          checked={added || picked}
          disabled={added}
          onChange={() => onTogglePick(m.id)}
        />
      </td>
      <td style={{ width: 52 }}>
        {src ? (
          <img src={src} alt="" className="thumb-img" style={{ width: 48, height: 32, objectFit: "cover" }} />
        ) : (
          <div className="thumb" style={{ width: 40, height: 40, fontSize: 16 }}>
            {(m.name || "?").charAt(0)}
          </div>
        )}
      </td>
      <td>
        <strong style={{ fontSize: 13 }}>{m.name}</strong>
        <div className="muted" style={{ fontSize: 11 }}>
          {formatMaterialModulesLabel(m) || "—"}
          {m.supplier ? ` · ${m.supplier}` : ""}
        </div>
        {materialSpecSubtitle(m) && (
          <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
            {materialSpecSubtitle(m)}
          </div>
        )}
      </td>
      <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {m.unit}
        {m.basePrice ? ` · ${m.basePrice} ₽` : ""}
      </td>
      <td style={{ width: 88 }}>
        {added ? (
          <span className="chip chip--neutral" style={{ fontSize: 10 }}>
            в списке
          </span>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAddOne(m)}>
            ＋ один
          </button>
        )}
      </td>
    </tr>
  );
}
