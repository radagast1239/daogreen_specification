import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { money, num, mergedPurchaseList } from "../store/helpers.js";
import { lineGross, itemsByResponsible } from "./itemHelpers.js";
import { groupByClientSection } from "../../shared/clientSections.js";
import { isBoughtStatus } from "../components/client/ClientItemCard.jsx";
import { generateProjectPdf } from "./pdfExport.js";

function hexToRgb(hex) {
  const h = (hex || "#116355").replace("#", "");
  if (h.length !== 6) return [17, 99, 85];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function addFooter(doc, branding, pageNum, totalPages) {
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  const footer = branding.pdfFooter?.trim() || branding.companyName || "Daogreen";
  doc.text(footer, 14, pageH - 8);
  doc.text(`${pageNum} / ${totalPages}`, 196, pageH - 8, { align: "right" });
}

function tableForItems(doc, items, project, startY, brandRgb) {
  autoTable(doc, {
    startY,
    head: [["№", "Наименование", "Кол", "Ед", "Цена", "Сумма", "Поставщик"]],
    body: items.map((it, i) => [
      i + 1,
      it.name,
      num(it.qty),
      it.unit || "шт.",
      money(it.price, project.currency),
      money(lineGross(it), project.currency),
      (it.supplier || "—").slice(0, 24),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: brandRgb },
    columnStyles: { 1: { cellWidth: 70 } },
  });
  return doc.lastAutoTable.finalY + 8;
}

export async function generateClientPurchasePdf({
  project,
  items,
  branding = {},
  purchaseStatuses,
  pageUrl,
  mode = "client",
}) {
  if (mode === "flat") {
    return generateProjectPdf({ project, items, branding, purchaseStatuses, pageUrl });
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const brandRgb = hexToRgb(branding.brandColor);
  const budget = items.reduce((s, i) => s + lineGross(i), 0);
  const spent = items.filter((i) => isBoughtStatus(i.status)).reduce((s, i) => s + lineGross(i), 0);

  let scoped = items;
  if (mode === "plumber") scoped = itemsByResponsible(items, "plumber");
  if (mode === "electric") scoped = itemsByResponsible(items, "electrician");
  if (mode === "installer") scoped = itemsByResponsible(items, "installer");
  if (mode === "consumables") scoped = itemsByResponsible(items, "consumables");
  if (mode === "merged") {
    scoped = mergedPurchaseList({ ...project, items }).map((r) => ({
      name: r.name,
      qty: r.qty,
      unit: r.unit,
      price: r.price,
      supplier: r.supplier,
    }));
  }

  doc.setFillColor(...brandRgb);
  doc.rect(0, 0, 210, 52, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text(branding.companyName || "Daogreen", 14, 18);
  doc.setFontSize(13);
  doc.text("Закупочный лист по проекту", 14, 28);
  doc.setFontSize(11);
  doc.text(project.name, 14, 38);
  doc.setFontSize(9);
  doc.text(
    `${project.client || ""}${project.city ? " · " + project.city : ""} · v${project.version || 1} · ${new Date().toLocaleDateString("ru-RU")}`,
    14,
    46
  );

  doc.setTextColor(30, 30, 30);
  let y = 62;
  doc.setFontSize(10);
  doc.text(`Итого: ${money(budget, project.currency)}`, 14, y);
  doc.text(`Куплено: ${money(spent, project.currency)}`, 80, y);
  doc.text(`Осталось: ${money(budget - spent, project.currency)}`, 140, y);
  y += 12;

  if (mode === "client") {
    doc.setFontSize(11);
    doc.text("Сводка по разделам", 14, y);
    y += 4;
    const sections = groupByClientSection(items);
    autoTable(doc, {
      startY: y,
      head: [["Раздел", "Поз.", "Сумма", "Готово"]],
      body: sections.map(([title, list]) => {
        const sum = list.reduce((s, i) => s + lineGross(i), 0);
        const done = list.filter((i) => isBoughtStatus(i.status)).length;
        return [title, list.length, money(sum, project.currency), list.length ? `${Math.round((done / list.length) * 100)}%` : "0%"];
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: brandRgb },
    });
    y = doc.lastAutoTable.finalY + 10;

    for (const [title, list] of sections) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      const sum = list.reduce((s, i) => s + lineGross(i), 0);
      doc.setFontSize(11);
      doc.text(`${title} — ${money(sum, project.currency)}`, 14, y);
      y += 4;
      y = tableForItems(doc, list, project, y, brandRgb);
    }
  } else {
    const titles = {
      plumber: "Список для сантехника",
      electric: "Список для электрика",
      installer: "Список для монтажника",
      consumables: "Расходники",
      merged: "Общий список",
    };
    doc.setFontSize(12);
    doc.text(titles[mode] || "Список", 14, y);
    y += 8;
    tableForItems(doc, scoped, project, y, brandRgb);
  }

  if (branding.pdfShowQr !== false && pageUrl) {
    try {
      const qr = await QRCode.toDataURL(pageUrl, { width: 120, margin: 0 });
      const pageH = doc.internal.pageSize.getHeight();
      doc.addImage(qr, "PNG", 14, pageH - 36, 22, 22);
      doc.setFontSize(8);
      doc.text("Онлайн-версия со ссылками", 40, pageH - 24);
    } catch {
      /* ignore */
    }
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    addFooter(doc, branding, p, total);
  }

  const safeName = (project.name || "проект").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = project.version > 1 ? `_v${project.version}` : "";
  doc.save(`Daogreen_Закупочный_лист_${safeName}${ver}.pdf`);
}
