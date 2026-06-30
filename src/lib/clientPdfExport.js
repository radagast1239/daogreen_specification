import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { money, num, mergedPurchaseRows } from "../store/helpers.js";
import { lineGross, resolveResponsible, isBoughtStatus } from "./itemHelpers.js";
import { getClientSectionLabelMap } from "../../shared/clientSections.js";
import { generateProjectPdf } from "./pdfExport.js";
import { setupPdfFonts, pdfTableFontStyles, pdfTableHeadFontStyles } from "./pdfFontSetup.js";
import { buildPdfPhotoMap, pdfPhotoTableHooks, PDF_PHOTO_COL_WIDTH_MM } from "./pdfImageHelpers.js";

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

function ensureSpace(doc, y, need = 40) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - 20) {
    doc.addPage();
    return 20;
  }
  return y;
}

function drawTitleBlock(doc, project, branding, brandRgb, subtitle) {
  doc.setFillColor(...brandRgb);
  doc.rect(0, 0, 210, 52, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text(branding.companyName || "Daogreen", 14, 18);
  doc.setFontSize(12);
  doc.text(subtitle, 14, 28);
  doc.setFontSize(11);
  doc.text(project.name, 14, 38);
  doc.setFontSize(9);
  doc.text(
    `${project.client || ""}${project.city ? " · " + project.city : ""} · v${project.version || 1} · ${new Date().toLocaleDateString("ru-RU")}`,
    14,
    46
  );
  doc.setTextColor(30, 30, 30);
  return 62;
}

function budgetLines(doc, items, project, y) {
  const budget = items.reduce((s, i) => s + lineGross(i), 0);
  const spent = items.filter((i) => isBoughtStatus(i.status)).reduce((s, i) => s + lineGross(i), 0);
  doc.setFontSize(10);
  doc.text(`Итого: ${money(budget, project.currency)}`, 14, y);
  doc.text(`Куплено: ${money(spent, project.currency)}`, 72, y);
  doc.text(`Осталось: ${money(Math.max(budget - spent, 0), project.currency)}`, 130, y);
  const bought = items.filter((i) => isBoughtStatus(i.status)).length;
  const progress = items.length ? Math.round((bought / items.length) * 100) : 0;
  doc.text(`Готовность: ${progress}%`, 14, y + 7);
  return y + 16;
}

async function tableForMerged(doc, rows, project, startY, brandRgb, purchaseStatuses, compact = false, pdfOpts = {}) {
  const photoCol = 1;
  const nameCol = 2;
  const photoMap = await buildPdfPhotoMap(rows, undefined, pdfOpts);
  const head = compact
    ? [["№", "Фото", "Наименование", "Кол", "Ед", "Сумма", "Поставщик"]]
    : [["№", "Фото", "Наименование", "Кол", "Ед", "Сумма", "Поставщик", "Откуда"]];
  const body = rows.map((r, i) => {
    const base = [
      i + 1,
      "",
      r.name,
      num(r.qty),
      r.unit || "шт.",
      money(r.sumVat ?? lineGross(r), project.currency),
      (r.supplier || "—").slice(0, 28),
    ];
    if (!compact) base.push((r.sourceText || "").slice(0, 48));
    return base;
  });
  autoTable(doc, {
    startY,
    head,
    body,
    styles: { fontSize: 7.5, cellPadding: 1.8, ...pdfTableFontStyles() },
    headStyles: { fillColor: brandRgb, ...pdfTableHeadFontStyles() },
    columnStyles: {
      [photoCol]: { cellWidth: PDF_PHOTO_COL_WIDTH_MM },
      [nameCol]: { cellWidth: compact ? 64 : 50 },
    },
    ...pdfPhotoTableHooks(photoMap, photoCol),
  });
  return doc.lastAutoTable.finalY + 8;
}

function mergedForRole(items, role) {
  return mergedPurchaseRows(items).filter((row) =>
    (row.sourceItems || []).some((it) => resolveResponsible(it) === role)
  );
}

const PLUMBER_SECTIONS = new Set(["irrigation", "drainage", "tanks", "water_prep"]);
const ELECTRIC_SECTIONS = new Set(["electrics", "lighting", "automation"]);
const INSTALLER_SECTIONS = new Set(["stellage", "climate", "consumables"]);

function mergedBySections(merged, sectionIds) {
  return merged.filter((r) => sectionIds.has(r.clientSection));
}

async function addQr(doc, branding, pageUrl) {
  if (branding.pdfShowQr === false || !pageUrl) return;
  try {
    const qr = await QRCode.toDataURL(pageUrl, { width: 120, margin: 0 });
    const pageH = doc.internal.pageSize.getHeight();
    const y = pageH - 36;
    doc.addImage(qr, "PNG", 14, y, 22, 22);
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text("Онлайн-версия со ссылками и статусами", 40, y + 12);
  } catch {
    /* ignore */
  }
}

function contactsBlock(doc, branding, y) {
  y = ensureSpace(doc, y, 30);
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text("Контакты", 14, y);
  y += 7;
  doc.setFontSize(9);
  const parts = [branding.contactPhone, branding.contactEmail, branding.contactTelegram].filter(Boolean);
  doc.text(parts.length ? parts.join(" · ") : branding.companyName || "Daogreen", 14, y);
  return y + 12;
}

function instructionBlock(doc, y) {
  doc.setFontSize(11);
  doc.text("Как пользоваться", 14, y);
  y += 6;
  doc.setFontSize(9);
  const lines = [
    "1. «Общий список» — уникальные позиции (одинаковые с разных модулей уже объединены).",
    "2. Ниже — те же позиции по разделам и для специалистов (не новые строки, а другой вид).",
    "3. Отмечайте «заказано» и «куплено» в онлайн-версии по ссылке проекта.",
    "4. Если товара нет — оставьте комментарий в онлайн-версии.",
  ];
  for (const line of lines) {
    doc.text(line, 14, y);
    y += 5;
  }
  return y + 6;
}

function categorySummaryTable(doc, merged, project, y, brandRgb) {
  y = ensureSpace(doc, y, 30);
  doc.setFontSize(11);
  doc.text("Сводка по разделам", 14, y);
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("Уникальные позиции после склейки одинаковых строк", 14, y + 5);
  doc.setTextColor(30, 30, 30);
  y += 10;
  const bySection = new Map();
  for (const row of merged || []) {
    const title = row.clientSectionLabel || "Прочее";
    if (!bySection.has(title)) bySection.set(title, []);
    bySection.get(title).push(row);
  }
  const sections = [...bySection.entries()].sort(([a], [b]) => a.localeCompare(b, "ru"));
  autoTable(doc, {
    startY: y,
    head: [["Раздел", "Поз.", "Сумма", "Готово"]],
    body: sections.map(([title, list]) => {
      const sum = list.reduce((s, r) => s + (r.sumVat || 0), 0);
      const done = list.filter((r) => (r.sourceItems || []).every((i) => isBoughtStatus(i.status))).length;
      return [title, list.length, money(sum, project.currency), list.length ? `${Math.round((done / list.length) * 100)}%` : "0%"];
    }),
    styles: { fontSize: 8, ...pdfTableFontStyles() },
    headStyles: { fillColor: brandRgb, ...pdfTableHeadFontStyles() },
  });
  return doc.lastAutoTable.finalY + 10;
}

async function renderFullPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, "Закупочный лист — полная версия");
  y = budgetLines(doc, items, project, y);
  y = instructionBlock(doc, y);
  const merged = mergedPurchaseRows(items);
  y = categorySummaryTable(doc, merged, project, y, brandRgb);

  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(`Общий список закупки · ${merged.length} уникальных позиций`, 14, y);
  y += 4;
  y = await tableForMerged(doc, merged, project, y, brandRgb, purchaseStatuses, false, pdfOpts);

  const bySection = new Map();
  for (const row of merged) {
    const key = row.clientSectionLabel || "Прочее";
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(row);
  }
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text("Закупка по разделам (те же позиции, другая группировка)", 14, y);
  y += 8;
  for (const [title, list] of bySection) {
    y = ensureSpace(doc, y, 30);
    const sum = list.reduce((s, r) => s + (r.sumVat || 0), 0);
    doc.setFontSize(10);
    doc.text(`${title} — ${money(sum, project.currency)}`, 14, y);
    y += 4;
    y = await tableForMerged(doc, list, project, y, brandRgb, purchaseStatuses, true, pdfOpts);
  }

  for (const [label, role] of [
    ["Сантехник", "plumber"],
    ["Электрик", "electrician"],
    ["Монтажник", "installer"],
  ]) {
    const list = mergedForRole(items, role);
    if (!list.length) continue;
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(11);
    doc.text(`Список для ${label.toLowerCase()}а`, 14, y);
    y += 4;
    y = await tableForMerged(doc, list, project, y, brandRgb, purchaseStatuses, false, pdfOpts);
  }

  return contactsBlock(doc, branding, y);
}

async function renderMergedPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, "Всё к покупке");
  y = budgetLines(doc, items, project, y);
  const merged = mergedPurchaseRows(items);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(`Общий список · ${merged.length} позиций`, 14, y);
  y += 4;
  await tableForMerged(doc, merged, project, y, brandRgb, purchaseStatuses, false, pdfOpts);
}

async function renderSpecialistPdf(doc, project, items, branding, brandRgb, purchaseStatuses, mode, pdfOpts) {
  const titles = {
    plumber: "Список для сантехника",
    electric: "Список для электрика",
    installer: "Список для монтажника",
    consumables: "Расходники",
  };
  const sectionSets = {
    plumber: PLUMBER_SECTIONS,
    electric: ELECTRIC_SECTIONS,
    installer: INSTALLER_SECTIONS,
  };
  const roles = {
    plumber: "plumber",
    electric: "electrician",
    installer: "installer",
    consumables: "consumables",
  };

  let y = drawTitleBlock(doc, project, branding, brandRgb, titles[mode] || "Список");
  y = budgetLines(doc, items, project, y);

  const roleMerged = mergedForRole(items, roles[mode]);
  const sectionIds = sectionSets[mode];
  const merged = sectionIds ? mergedBySections(mergedPurchaseRows(items), sectionIds) : roleMerged;
  const source = merged.length ? merged : roleMerged;

  if (sectionIds && source.length) {
    const groups = new Map();
    for (const row of source) {
      const labelMap = getClientSectionLabelMap();
      const label = labelMap[row.clientSection] || row.clientSectionLabel || "Прочее";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(row);
    }
    for (const [title, list] of groups) {
      y = ensureSpace(doc, y, 30);
      doc.setFontSize(10);
      const sum = list.reduce((s, r) => s + (r.sumVat || 0), 0);
      doc.text(`${title} — ${money(sum, project.currency)}`, 14, y);
      y += 4;
      y = await tableForMerged(doc, list, project, y, brandRgb, purchaseStatuses, false, pdfOpts);
    }
  } else {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(11);
    doc.text(titles[mode] || "Список", 14, y);
    y += 4;
    await tableForMerged(doc, source, project, y, brandRgb, purchaseStatuses, false, pdfOpts);
  }
}

export async function generateClientPurchasePdf({
  project,
  items,
  branding = {},
  purchaseStatuses,
  pageUrl,
  mode = "client_full",
  clientToken,
}) {
  if (mode === "flat") {
    return generateProjectPdf({ project, items, branding, purchaseStatuses, pageUrl });
  }

  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await setupPdfFonts(doc);
  const brandRgb = hexToRgb(branding.brandColor);
  const pdfOpts = clientToken ? { clientToken } : {};

  const resolvedMode = mode === "client" ? "client_full" : mode;

  if (resolvedMode === "client_full") {
    await renderFullPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  } else if (resolvedMode === "merged") {
    await renderMergedPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  } else if (["plumber", "electric", "installer", "consumables"].includes(resolvedMode)) {
    await renderSpecialistPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, resolvedMode, pdfOpts);
  } else {
    await renderMergedPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  }

  await addQr(doc, branding, pageUrl);

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    addFooter(doc, branding, p, total);
  }

  const modeSuffix = {
    client_full: "",
    merged: "_общий",
    plumber: "_сантехник",
    electric: "_электрик",
    installer: "_монтажник",
    consumables: "_расходники",
  };
  const safeName = (project.name || "проект").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = project.version > 1 ? `_v${project.version}` : "";
  const suffix = modeSuffix[resolvedMode] ?? "";
  doc.save(`Daogreen_Закупочный_лист_${safeName}${ver}${suffix}.pdf`);
}
