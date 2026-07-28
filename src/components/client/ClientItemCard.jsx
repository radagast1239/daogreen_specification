import React from "react";
import PhotoGallery from "../PhotoGallery.jsx";
import { Chip } from "../ui.jsx";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { itemImageUrl, lineGross, lineVat } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import { isBoughtStatus } from "../../lib/itemHelpers.js";
import { isCoolingSpecItem } from "../../../shared/itemTypes.js";
import {
  formatClientLineTotal,
  formatClientUnitPrice,
  resolveClientPurchaseStatusLabel,
} from "../../../shared/clientPurchaseRows.js";
import { getPurchaseStatusTone, isPurchaseStatusNeedsAttention } from "../../../shared/purchaseStatusRules.js";
import ClientStatusActions from "./ClientStatusActions.jsx";
import { DebouncedInput } from "./ClientDebouncedField.jsx";
import { t, tStatus, tUnit } from "../../../shared/clientI18n.js";

export default function ClientItemCard({
  it,
  currency,
  patch,
  bought = false,
  purchaseStatuses = PURCHASE_STATUSES,
  onProposeReplacement,
  compact = false,
  language = "ru",
}) {
  const img = !compact ? itemImageUrl(it) : "";
  const gross = lineGross(it);
  const vat = lineVat(it);
  const coolingSpec = isCoolingSpecItem(it);
  const unitPrice = formatClientUnitPrice(it);
  const lineTotal = formatClientLineTotal(it);
  const localizedPrice = (value) => value === "цена уточняется"
    ? t(language, "client.price.tbd")
    : value === "Без цены" ? t(language, "client.price.missing") : value;
  const unitPriceLabel = typeof unitPrice === "number" ? money(unitPrice, currency) : localizedPrice(unitPrice);
  const lineTotalLabel =
    lineTotal === ""
      ? ""
      : typeof lineTotal === "number"
        ? money(lineTotal, currency)
        : localizedPrice(lineTotal);

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
              {t(language, "client.itemCard.done")}
            </span>
          ) : (
            <Chip
              kind={getPurchaseStatusTone(it.status)}
              dot={isPurchaseStatusNeedsAttention(it.status)}
            >
              {tStatus(language, it.status) === it.status ? resolveClientPurchaseStatusLabel(it) : tStatus(language, it.status)}
            </Chip>
          )}
        </div>
        {!compact && materialSpecLabel(it) && (
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--brand)" }}>{materialSpecLabel(it)}</div>
        )}
        <div className="client-qty-row">
          <span className="client-qty-badge" title={t(language, "client.purchaseTable.qtyTitle")}>
            <span className="num">{num(it.qty)}</span>
            <span className="client-qty-badge__unit">{tUnit(language, it.unit || "шт.")}</span>
          </span>
          {!compact && (it.vatRate || 0) > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              {t(language, "client.itemCard.vat", { rate: it.vatRate })}
            </span>
          )}
          {compact && lineTotalLabel && (
            <span className="muted" style={{ fontSize: 12 }}>
              · <span className="num">{lineTotalLabel}</span>
            </span>
          )}
        </div>
        {!compact && (
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              {t(language, "client.itemCard.priceLabel", { price: unitPriceLabel })}
              {lineTotalLabel ? (
                <>
                  {" "}{t(language, "client.itemCard.sumLabel", { sum: lineTotalLabel })}
                </>
              ) : null}
              {vat > 0 && typeof unitPrice === "number" && (
                <span className="muted"> {t(language, "client.itemCard.vatIncluded", { amount: money(vat, currency) })}</span>
              )}
            </div>
          )}
        {!compact && it.supplier && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>{t(language, "client.itemCard.supplierLabel")}</b> {it.supplier}
          </div>
        )}
        {!compact && it.clientNote && (
          <div className="client-admin-note" style={{ fontSize: 12.5, marginTop: 6 }}>
            <b>{t(language, coolingSpec ? "client.itemCard.specLabel" : "client.itemCard.commentLabel")}</b> {it.clientNote}
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
            {t(language, compact ? "client.itemCard.linkShort" : "client.itemCard.linkLong")}
          </a>
        )}

        {!bought ? (
          <ClientStatusActions
            language={language}
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
            {t(language, "client.itemCard.revert")}
          </button>
        )}
        {it.status === "replacement_check" && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t(language, "client.itemCard.replacementCheckHint")}
          </p>
        )}

        {!compact && !bought && (
          <div className="row no-print" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>{t(language, "client.itemCard.actualPriceLabel")}</label>
              <DebouncedInput
                type="number"
                value={it.actualPrice ?? ""}
                placeholder={String(it.price)}
                onCommit={(val) => patch(it.id, { actualPrice: val })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>{t(language, "client.itemCard.clientCommentLabel")}</label>
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
