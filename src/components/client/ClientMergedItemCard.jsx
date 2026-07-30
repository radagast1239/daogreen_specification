import React, { useState } from "react";
import PhotoGallery from "../PhotoGallery.jsx";
import { Chip } from "../ui.jsx";
import { PURCHASE_STATUSES } from "../../data/modules.js";
import { materialSpecLabel } from "../../lib/materialSpecs.js";
import { isPurchaseClosed } from "../../lib/itemHelpers.js";
import { money, num } from "../../store/helpers.js";
import { isCoolingSpecItem } from "../../../shared/itemTypes.js";
import {
  formatClientLineTotal,
  formatClientUnitPrice,
  resolveClientPurchaseStatusLabel,
} from "../../../shared/clientPurchaseRows.js";
import { getPurchaseStatusTone, isPurchaseStatusNeedsAttention } from "../../../shared/purchaseStatusRules.js";
import { clientMergedPhotoSrc } from "../../lib/photoHelpers.js";
import ClientStatusActions from "./ClientStatusActions.jsx";
import { patchMergedRow } from "../../lib/clientMergedPatch.js";
import { DebouncedInput } from "./ClientDebouncedField.jsx";
import { t, tStatus, tUnit } from "../../../shared/clientI18n.js";

function mergedRowStatus(row) {
  if (row.statusSummary?.status) return row.statusSummary.status;
  const items = row?.sourceItems || [];
  if (!items.length) return "not_bought";
  const unique = [...new Set(items.map((i) => i.status))];
  if (unique.length === 1) return unique[0];
  if (items.every((i) => isPurchaseClosed(i))) return items[0].status;
  const open = items.find((i) => !isPurchaseClosed(i));
  return open?.status || "not_bought";
}

function patchMerged(patchFn, patchBulkFn, row, payload) {
  return patchMergedRow(patchFn, patchBulkFn, row, payload);
}

export default function ClientMergedItemCard({
  row,
  currency,
  patch,
  patchBulk,
  bought = false,
  purchaseStatuses = PURCHASE_STATUSES,
  onProposeReplacement,
  compact = false,
  language = "ru",
  clientToken = "",
}) {
  const [showPhoto, setShowPhoto] = useState(false);
  const rep = row.sourceItems?.[0];
  const photoUrl = clientMergedPhotoSrc(row, clientToken);
  const hasPhoto = !!photoUrl;
  const showImage = !compact || showPhoto;
  const img = showImage ? photoUrl : "";
  const status = mergedRowStatus(row);
  const multi = (row.sourceCount || row.sources?.length || 0) > 1;
  const sourcesLine = compact ? "" : row.sourceText || "";

  const onStatus = (next) => patchMerged(patch, patchBulk, row, { status: next });

  const patchRowField = (payload) => patchMerged(patch, patchBulk, row, payload);

  const onReplacement = rep && onProposeReplacement ? () => onProposeReplacement(rep) : undefined;
  const coolingSpec = isCoolingSpecItem(rep || row);
  const unitPrice = formatClientUnitPrice(row);
  const lineTotal = formatClientLineTotal(row);
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
      {showImage && (
        img ? (
          <PhotoGallery src={img} alt={row.name} />
        ) : (
          <div className="thumb">{(row.name || "?").trim().charAt(0).toUpperCase()}</div>
        )
      )}
      <div style={{ minWidth: 0 }}>
        <div className="between">
          <strong style={{ fontSize: compact ? 13 : 14 }}>{row.name}</strong>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            {compact && hasPhoto && !showPhoto && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowPhoto(true)}>
                {t(language, "client.purchaseTable.showPhoto")}
              </button>
            )}
            {compact && showPhoto && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowPhoto(false)}>
                {t(language, "client.purchaseTable.hidePhoto")}
              </button>
            )}
          {bought ? (
            <span className="chip chip--ok chip-dot" style={{ fontSize: 11 }}>
              {t(language, "client.itemCard.done")}
            </span>
          ) : (
            <Chip
              kind={getPurchaseStatusTone(status)}
              dot={isPurchaseStatusNeedsAttention(status)}
            >
              {tStatus(language, status) === status ? resolveClientPurchaseStatusLabel(row) : tStatus(language, status)}
            </Chip>
          )}
          {multi && !bought && (
            <span
              className="chip chip--brand chip-dot"
              style={{ fontSize: 11, marginLeft: 6 }}
              title={t(language, "client.itemCard.mergeChipTitle")}
            >
              ×{row.sourceCount || row.sources?.length}
            </span>
          )}
          </div>
        </div>
        {!compact && rep && materialSpecLabel(rep) && (
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--brand)" }}>{materialSpecLabel(rep)}</div>
        )}
        <div className="client-qty-row">
          <span className="client-qty-badge" title={t(language, "client.purchaseTable.qtyTitle")}>
            <span className="num">{num(row.qty)}</span>
            <span className="client-qty-badge__unit">{tUnit(language, row.unit || "шт.")}</span>
          </span>
          {!compact && (row.vatRate || 0) > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>
              {t(language, "client.itemCard.vat", { rate: row.vatRate })}
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
            </div>
          )}
        {!compact && row.supplier && (
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>{t(language, "client.itemCard.supplierLabel")}</b> {row.supplier}
          </div>
        )}
        {sourcesLine && (
          <div className="muted client-merged-sources" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
            {t(language, "client.purchaseTable.fromSource", { sourceText: sourcesLine })}
          </div>
        )}
        {!compact && row.clientNote && (
          <div className="client-admin-note" style={{ fontSize: 12.5, marginTop: 6 }}>
            <b>{t(language, coolingSpec ? "client.itemCard.specLabel" : "client.itemCard.commentLabel")}</b> {row.clientNote}
          </div>
        )}
        {row.link && (
          <a
            href={row.link}
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
            status={status}
            onStatusChange={onStatus}
            onNeedReplacement={onReplacement}
          />
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost no-print"
            style={{ marginTop: 10 }}
            onClick={() => onStatus("not_bought")}
          >
            {t(language, "client.itemCard.revert")}
          </button>
        )}

        {!compact && !bought && (
          <div className="row no-print" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "0 0 150px" }}>
              <label>{t(language, "client.itemCard.actualPriceLabel")}</label>
              <DebouncedInput
                type="number"
                value={rep?.actualPrice ?? ""}
                placeholder={String(row.price)}
                onCommit={(val) => patchRowField({ actualPrice: val })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>{t(language, "client.itemCard.clientCommentLabel")}</label>
              <DebouncedInput
                value={rep?.clientComment || ""}
                onCommit={(val) => patchRowField({ clientComment: val })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
