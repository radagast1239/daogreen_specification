import React from "react";
import PhotoGallery from "../PhotoGallery.jsx";
import { StatusChip } from "../ui.jsx";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { itemImageUrl, lineGross, lineVat } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import { isBoughtStatus } from "../../lib/itemHelpers.js";
import ClientStatusActions from "./ClientStatusActions.jsx";

export default function ClientItemCard({
  it,
  currency,
  patch,
  bought = false,
  purchaseStatuses = PURCHASE_STATUSES,
}) {
  const statuses = purchaseStatuses || PURCHASE_STATUSES;
  const img = itemImageUrl(it);
  const gross = lineGross(it);
  const vat = lineVat(it);

  return (
    <div className={"card card-item" + (bought ? " card-item--bought" : "")}>
      {img ? (
        <PhotoGallery src={img} alt={it.name} />
      ) : (
        <div className="thumb">{(it.name || "?").trim().charAt(0).toUpperCase()}</div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="between">
          <strong style={{ fontSize: 14 }}>{it.name}</strong>
          {bought ? (
            <span className="chip chip--ok chip-dot" style={{ fontSize: 11 }}>
              Куплено
            </span>
          ) : it.status === "need_help" ? (
            <StatusChip status={it.status} statuses={statuses} />
          ) : null}
        </div>
        {materialSpecLabel(it) && (
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--brand)" }}>{materialSpecLabel(it)}</div>
        )}
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          Кол-во: <span className="num">{num(it.qty)}</span> {it.unit}
          {(it.vatRate || 0) > 0 && <span> · НДС {it.vatRate}%</span>}
        </div>
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          Цена: <span className="num">{money(it.price, currency)}</span>/ед · Сумма:{" "}
          <b className="num">{money(gross, currency)}</b>
          {vat > 0 && <span className="muted"> (в т.ч. НДС {money(vat, currency)})</span>}
        </div>
        {it.supplier && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>Поставщик:</b> {it.supplier}
          </div>
        )}
        {it.clientNote && (
          <div className="client-admin-note" style={{ fontSize: 12.5, marginTop: 6 }}>
            <b>Комментарий Daogreen:</b> {it.clientNote}
          </div>
        )}
        {it.link && (
          <a
            href={it.link}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
            style={{ marginTop: 8, display: "inline-block" }}
          >
            Открыть ссылку ↗
          </a>
        )}

        {!bought ? (
          <ClientStatusActions
            status={it.status}
            onStatusChange={(next) => patch(it.id, { status: next })}
            purchaseStatuses={statuses}
          />
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost no-print"
            style={{ marginTop: 10 }}
            onClick={() => patch(it.id, { status: "not_bought" })}
          >
            Вернуть в список
          </button>
        )}

        {!bought && (
          <div className="row no-print" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>Факт. цена</label>
              <input
                type="number"
                value={it.actualPrice ?? ""}
                placeholder={String(it.price)}
                onChange={(e) =>
                  patch(it.id, { actualPrice: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Комментарий</label>
              <input
                value={it.clientComment || ""}
                onChange={(e) => patch(it.id, { clientComment: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { isBoughtStatus };
