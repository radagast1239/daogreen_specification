import React from "react";
import PhotoGallery from "../PhotoGallery.jsx";
import { StatusChip } from "../ui.jsx";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { itemImageUrl, lineGross, lineVat } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import { isBoughtStatus } from "../../lib/itemHelpers.js";
import ClientStatusActions from "./ClientStatusActions.jsx";
import { DebouncedInput } from "./ClientDebouncedField.jsx";

export default function ClientItemCard({
  it,
  currency,
  patch,
  bought = false,
  purchaseStatuses = PURCHASE_STATUSES,
  onProposeReplacement,
  compact = false,
}) {
  const statuses = purchaseStatuses || PURCHASE_STATUSES;
  const img = !compact ? itemImageUrl(it) : "";
  const gross = lineGross(it);
  const vat = lineVat(it);

  return (
    <div className={"card card-item" + (bought ? " card-item--bought" : "") + (compact ? " card-item--compact" : "")}>
      {!compact && (
        img ? (
          <PhotoGallery src={img} alt={it.name} />
        ) : (
          <div className="thumb">{(it.name || "?").trim().charAt(0).toUpperCase()}</div>
        )
      )}
      <div style={{ minWidth: 0 }}>
        <div className="between">
          <strong style={{ fontSize: compact ? 13 : 14 }}>{it.name}</strong>
          {bought ? (
            <span className="chip chip--ok chip-dot" style={{ fontSize: 11 }}>
              Готово
            </span>
          ) : it.status === "need_help" || it.status === "replacement_check" ? (
            <StatusChip status={it.status} statuses={statuses} />
          ) : null}
        </div>
        {!compact && materialSpecLabel(it) && (
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--brand)" }}>{materialSpecLabel(it)}</div>
        )}
        <div className="muted" style={{ fontSize: compact ? 12 : 12.5, marginTop: 2 }}>
          <span className="num">{num(it.qty)}</span> {it.unit}
          {!compact && (it.vatRate || 0) > 0 && <span> · НДС {it.vatRate}%</span>}
          {compact && it.price > 0 && (
            <span>
              {" "}
              · <span className="num">{money(gross, currency)}</span>
            </span>
          )}
        </div>
        {!compact && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            Цена: <span className="num">{money(it.price, currency)}</span>/ед · Сумма:{" "}
            <b className="num">{money(gross, currency)}</b>
            {vat > 0 && <span className="muted"> (в т.ч. НДС {money(vat, currency)})</span>}
          </div>
        )}
        {!compact && it.supplier && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>Поставщик:</b> {it.supplier}
          </div>
        )}
        {!compact && it.clientNote && (
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
            style={{ marginTop: compact ? 6 : 8, display: "inline-block" }}
          >
            {compact ? "Ссылка ↗" : "Открыть ссылку ↗"}
          </a>
        )}

        {!bought ? (
          <ClientStatusActions
            status={it.status}
            onStatusChange={(next) => patch(it.id, { status: next })}
            onNeedReplacement={onProposeReplacement ? () => onProposeReplacement(it) : undefined}
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
        {it.status === "replacement_check" && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Замена на проверке — Daogreen рассмотрит предложение.
          </p>
        )}

        {!compact && !bought && (
          <div className="row no-print" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>Факт. цена</label>
              <DebouncedInput
                type="number"
                value={it.actualPrice ?? ""}
                placeholder={String(it.price)}
                onCommit={(val) => patch(it.id, { actualPrice: val })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Комментарий</label>
              <DebouncedInput
                value={it.clientComment || ""}
                onCommit={(val) => patch(it.id, { clientComment: val })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { isBoughtStatus };
