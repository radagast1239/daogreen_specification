import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { money, num } from "../store/helpers.js";
import { lineGross } from "./itemHelpers.js";
import { absolutePhotoUrl } from "./photoHelpers.js";
import { PDF_COLUMN_OPTIONS } from "./clientBrandConfig.js";
import { PURCHASE_STATUSES } from "../data/modules.js";

const COLUMN_LABELS = Object.fromEntries(PDF_COLUMN_OPTIONS.map((c) => [c.id, c.label]));

function hexToRgb(hex) {
  const h = (hex || "#116355").replace("#", "");
  if (h.length !== 6) return [17, 99, 85];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

async function loadImageDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function cellValue(col, it, project, purchaseStatuses) {
  switch (col) {
    case "name":
      return it.name;
    case "qty":
      return num(it.qty);
    case "unit":
      return it.unit || "шт.";
    case "price":
      return money(it.price, project.currency);
    case "sum":
      return money(lineGross(it), project.currency);
    case "supplier":
      return it.supplier || "—";
    case "category":
      return it.category || "—";
    case "module":
      return it.module || "—";
    case "link":
      return it.link || "—";
    case "status":
      return (purchaseStatuses || PURCHASE_STATUSES).find((s) => s.id === it.status)?.label || it.status || "—";
    case "vat":
      return String(it.vatRate ?? 0);
    default:
      return "";
  }
}

export async function generateProjectPdf({ project, items, branding = {}, purchaseStatuses, pageUrl }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const brand = branding.brandColor || "#116355";
  const [r, g, b] = hexToRgb(brand);
  const cols = branding.pdfColumns?.length ? branding.pdfColumns : ["name", "qty", "unit", "price", "sum", "supplier"];
  const head = cols.map((c) => COLUMN_LABELS[c] || c);
  const body = items.map((it) => cols.map((c) => cellValue(c, it, project, purchaseStatuses)));

  let headerY = 28;
  const logoUrl = absolutePhotoUrl(branding.logoUrl);
  if (logoUrl) {
    const dataUrl = await loadImageDataUrl(logoUrl);
    if (dataUrl) {
      try {
        doc.addImage(dataUrl, "PNG", 14, 6, 24, 16, undefined, "FAST");
        headerY = 30;
      } catch {
        /* ignore broken logo */
      }
    }
  }

  doc.setFillColor(r, g, b);
  doc.rect(0, 0, 210, headerY, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(branding.companyName || "Daogreen", logoUrl ? 42 : 14, 12);
  doc.setFontSize(11);
  doc.text(project.name, logoUrl ? 42 : 14, 20);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.text(`${project.client || ""} · ${new Date().toLocaleDateString("ru-RU")}`, 14, headerY + 8);

  autoTable(doc, {
    startY: headerY + 14,
    head: [head],
    body,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [r, g, b] },
  });

  const footer = branding.pdfFooter?.trim();
  const pageH = doc.internal.pageSize.getHeight();
  let footY = pageH - 12;

  if (branding.pdfShowQr !== false && pageUrl) {
    try {
      const qr = await QRCode.toDataURL(pageUrl, { width: 120, margin: 0 });
      doc.addImage(qr, "PNG", 170, pageH - 32, 24, 24);
    } catch {
      /* ignore */
    }
  }

  if (footer) {
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(footer, 14, footY, { maxWidth: branding.pdfShowQr !== false ? 150 : 180 });
  }

  doc.save(`${project.name}_закупка.pdf`);
}
