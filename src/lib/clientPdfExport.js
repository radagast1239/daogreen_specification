import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { formatQty, buildClientPurchaseMergedRows } from "../store/helpers.js";
import { lineGross, isBoughtStatus } from "./itemHelpers.js";
import { rowsForResponsibleRole } from "./responsibleResolve.js";
import { getClientSectionLabelMap } from "../../shared/clientSections.js";
import { isCoolingSpecItem } from "../../shared/itemTypes.js";
import {
  CLIENT_PRICE_TBD,
  formatClientLineTotal,
  resolveClientItemNote,
  resolveClientPurchaseStatusLabel,
} from "../../shared/clientPurchaseRows.js";
import { purchasePriorityLabel } from "../../shared/purchasePriority.js";
import { generateProjectPdf } from "./pdfExport.js";
import { setupPdfFonts, pdfTableFontStyles, pdfTableHeadFontStyles } from "./pdfFontSetup.js";
import { buildPdfPhotoMap, pdfPhotoTableHooks, PDF_PHOTO_COL_WIDTH_MM } from "./pdfImageHelpers.js";
import { safePdfText, safePdfPhotoCell } from "./pdfSafeValue.js";
import { formatMoneyForPdf, normalizeProjectCurrency } from "../../shared/projectCurrency.js";
import { t, tSection, tStatus, tUnit } from "../../shared/clientI18n.js";
import { projectClientLanguage } from "../../shared/projectClientLanguage.js";

const pt = (project, key, params) => t(projectClientLanguage(project), key, params);

function pdfMoney(amount, projectOrCurrency) {
  if (projectOrCurrency && typeof projectOrCurrency === "object" && !Array.isArray(projectOrCurrency)) {
    return formatMoneyForPdf(amount, normalizeProjectCurrency(projectOrCurrency));
  }
  return formatMoneyForPdf(amount, normalizeProjectCurrency({ currency: projectOrCurrency }));
}

function mergeOpts(project) {
  return { stellageConfigs: project?.stellageConfigs || project?.stellageCounts || [] };
}

function mergedRowsForProject(project, items) {
  return buildClientPurchaseMergedRows(items, mergeOpts(project));
}

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

export function getShortPdfTableHead(language = "ru") {
  return [
    t(language, "client.pdf.header.num"),
    t(language, "client.pdf.header.name"),
    t(language, "client.pdf.header.qtyShort"),
    t(language, "client.pdf.header.unitShort"),
    t(language, "client.pdf.header.sum"),
    t(language, "client.pdf.header.supplier"),
  ];
}

const coverUsageLines = (language) => [1, 2, 3, 4]
  .map((n) => t(language, `client.pdf.cover.usageLine${n}`));

const PRIORITY_SPECIALIST_ROLES = new Set(["climate", "electrician", "plumber"]);

function rowPurchaseMeta(row) {
  const src = row.sourceItems?.[0] || row;
  return {
    name: row.name || src.name || "—",
    supplier: (row.supplier || src.supplier || "").trim(),
    purchasePriority: (
      src.purchasePriority ||
      src.purchase_priority ||
      row.purchasePriority ||
      row.purchase_priority ||
      ""
    ).trim(),
    deliveryDays: Number(
      src.deliveryDays ?? src.delivery_days ?? row.deliveryDays ?? row.delivery_days ?? 0
    ),
    responsible: src.responsible || row.responsible || "",
  };
}

/** Позиции «что купить в первую очередь» — pure helper для обложки и тестов. */
export function pickPriorityPurchaseItems(items, maxLines = 7, project = null) {
  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const merged = buildClientPurchaseMergedRows(purchaseItems, mergeOpts(project));
  const picked = [];
  const seen = new Set();

  const addRow = (row, tier) => {
    const key = row.mergeKey || `${row.name}|${row.supplier}|${row.qty}`;
    if (seen.has(key) || picked.length >= maxLines) return;
    seen.add(key);
    const meta = rowPurchaseMeta(row);
    let suffix = "";
    if (tier === 1 && meta.purchasePriority) {
      const priorityKey = `client.priority.${meta.purchasePriority}`;
      const localizedPriority = t(language, priorityKey);
      suffix = ` (${localizedPriority === priorityKey ? purchasePriorityLabel(meta.purchasePriority) : localizedPriority})`;
    } else if (tier === 2 && meta.deliveryDays > 7) {
      suffix = t(language, "client.pdf.cover.deliverySuffix", { days: meta.deliveryDays });
    }
    const line = meta.supplier ? `${meta.name} — ${meta.supplier}${suffix}` : `${meta.name}${suffix}`;
    picked.push(line);
  };

  for (const row of merged) {
    if (rowPurchaseMeta(row).purchasePriority) addRow(row, 1);
  }
  if (picked.length < maxLines) {
    for (const row of merged) {
      if (rowPurchaseMeta(row).deliveryDays > 7) addRow(row, 2);
    }
  }
  if (picked.length < maxLines) {
    for (const row of merged) {
      if (PRIORITY_SPECIALIST_ROLES.has(rowPurchaseMeta(row).responsible)) addRow(row, 3);
    }
  }
  return picked;
}

/** Данные для титульной страницы PDF — pure helper для тестов. */
export function buildPdfCoverData(project = {}, items = [], branding = {}, options = {}) {
  const language = projectClientLanguage(project);
  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const merged = options.merged || mergedRowsForProject(project, purchaseItems);
  const budget = purchaseItems.reduce((s, i) => s + lineGross(i), 0);
  const priorityLines = pickPriorityPurchaseItems(purchaseItems, 7, language);
  const parts = [branding.contactPhone, branding.contactEmail, branding.contactTelegram].filter(Boolean);

  return {
    title: t(language, "client.pdf.cover.title"),
    projectName: project?.name || "—",
    client: project?.client || "—",
    city: project?.city || "—",
    version: project?.version ?? 1,
    generatedDate: new Date().toLocaleDateString(t(language, "client.pdf.dateLocale")),
    totalAmount: pdfMoney(budget, project),
    itemCount: merged.length,
    contacts: parts.length ? parts.join(" · ") : branding.companyName || "Daogreen",
    priorityLines,
    priorityFallback:
      priorityLines.length > 0 ? null : t(language, "client.pdf.cover.priorityFallback"),
    usageLines: coverUsageLines(language),
  };
}

/** Титульная страница PDF перед основным содержимым. */
export function drawCoverPage(doc, project, items, branding, options = {}) {
  const cover = buildPdfCoverData(project, items, branding, options);
  const brandRgb = hexToRgb(branding.brandColor);
  let y = 24;

  doc.setFillColor(...brandRgb);
  doc.rect(0, 0, 210, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text(cover.title, 14, 18);
  doc.setFontSize(10);
  doc.text(branding.companyName || "Daogreen", 14, 28);
  doc.setTextColor(30, 30, 30);

  y = 48;
  doc.setFontSize(14);
  doc.text(safePdfText(cover.projectName), 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(`${pt(project, "client.pdf.cover.client")} ${safePdfText(cover.client)}`, 14, y);
  y += 6;
  doc.text(`${pt(project, "client.pdf.cover.city")} ${safePdfText(cover.city)}`, 14, y);
  y += 6;
  doc.text(pt(project, "client.pdf.cover.version", { n: cover.version }), 14, y);
  y += 6;
  doc.text(pt(project, "client.pdf.cover.date", { date: cover.generatedDate }), 14, y);
  y += 10;

  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.cover.totalAmount", { amount: cover.totalAmount }), 14, y);
  y += 6;
  doc.text(pt(project, "client.pdf.cover.itemCount", { n: cover.itemCount }), 14, y);
  y += 12;

  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.cover.priorityTitle"), 14, y);
  y += 6;
  doc.setFontSize(9);
  if (cover.priorityLines.length) {
    for (const line of cover.priorityLines) {
      const wrapped = doc.splitTextToSize(`• ${line}`, 182);
      doc.text(wrapped, 16, y);
      y += wrapped.length * 4.5 + 1;
    }
  } else {
    const fb = doc.splitTextToSize(cover.priorityFallback, 182);
    doc.text(fb, 14, y);
    y += fb.length * 4.5 + 2;
  }
  y += 6;

  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.cover.usageTitle"), 14, y);
  y += 6;
  doc.setFontSize(9);
  for (const line of cover.usageLines) {
    const wrapped = doc.splitTextToSize(line, 182);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 4.5 + 1;
  }
  y += 8;

  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.cover.contactsTitle"), 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.text(safePdfText(cover.contacts), 14, y);
}

async function tableForShort(doc, rows, project, startY, brandRgb) {
  const language = projectClientLanguage(project);
  const nameCol = 1;
  const head = [getShortPdfTableHead(language)];
  const body = rows.map((r, i) => [
    i + 1,
    clientPdfNameCol(r, language),
    formatQty(r.qty, r.unit),
    tUnit(language, r.unit || "шт."),
    clientPdfMoneyOrTbd(r, project.currency, language),
    (r.supplier || "—").slice(0, 28),
  ]);
  autoTable(doc, {
    startY,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 2, ...pdfTableFontStyles() },
    headStyles: { fillColor: brandRgb, ...pdfTableHeadFontStyles() },
    columnStyles: {
      [nameCol]: { cellWidth: 72 },
    },
  });
  return doc.lastAutoTable.finalY + 8;
}

export function clientPdfMoneyOrTbd(row, currency, language = "ru") {
  const total = formatClientLineTotal(row);
  if (total === CLIENT_PRICE_TBD) return t(language, "client.price.tbd");
  if (total === "") return pdfMoney(0, currency);
  return pdfMoney(total, currency);
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
    `${project.client || ""}${project.city ? " · " + project.city : ""} · v${project.version || 1} · ${new Date().toLocaleDateString(pt(project, "client.pdf.dateLocale"))}`,
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
  doc.text(`${pt(project, "client.total")}: ${pdfMoney(budget, project)}`, 14, y);
  doc.text(`${pt(project, "client.purchased")}: ${pdfMoney(spent, project)}`, 72, y);
  doc.text(`${pt(project, "client.remaining")}: ${pdfMoney(Math.max(budget - spent, 0), project)}`, 130, y);
  const bought = items.filter((i) => isBoughtStatus(i.status)).length;
  const progress = items.length ? Math.round((bought / items.length) * 100) : 0;
  doc.text(`${pt(project, "client.overview.readiness")}: ${progress}%`, 14, y + 7);
  return y + 16;
}

export function clientPdfNameCol(row, language = "ru") {
  const rep = row.sourceItems?.[0];
  const isCooling = isCoolingSpecItem(rep || row);
  if (!isCooling) {
    const name = String(row?.name || rep?.name || "").trim();
    const note = String(row?.clientNote || resolveClientItemNote(rep) || "").trim();
    const statusId = row?.statusSummary?.status || row?.status || rep?.status || "not_bought";
    const translated = tStatus(language, statusId);
    const statusLabel = translated === statusId ? resolveClientPurchaseStatusLabel(row) : translated;
    const parts = [name];
    if (note && !name.includes(note)) parts.push(note);
    if (statusLabel) parts.push(t(language, "client.status.linePrefix", { label: statusLabel }));
    return safePdfText(parts.filter(Boolean).join("\n"));
  }

  // Для климата: собираем характеристики из sourceItems, если они есть.
  // Базовое название всегда "Сплит-система / кондиционер" (без суффиксов комнаты или количества)
  const baseName = t(language, "client.pdf.cooling.baseName");
  const src = rep || row;

  // Если уже есть готовая красивая заметка с характеристиками — используем её
  const note = (row.clientNote || src.clientNote || "").trim();
  if (note && note.includes("холод") && note.includes("BTU")) {
    return safePdfText([baseName, note].join("\n"));
  }

  // Иначе собираем вручную по полям
  const kw = Number(src.coolingKw) || 0;
  const btu = Number(src.coolingBtu) || 0;
  const ex = Number(src.exhaustM3) || 0;
  const cop = 3.2; // default
  const elec = kw > 0 ? Math.round((kw / cop) * 100) / 100 : 0;

  const parts = [baseName];
  
  // Достаём имя комнаты (если есть), очищая от лишних префиксов и секций
  // Ожидаемое значение "Комната: Манипуляционная", но не "Комната: Климат и вентиляция"
  let roomName = "";
  if (src.roomId && src.roomName) {
    roomName = src.roomName;
  } else if (row.sourceText) {
    // sourceText может содержать "Помещение: Манипуляционная"
    const fromText = row.sourceText.replace(/Помещение:|Из:/gi, "").trim();
    // Исключаем случаи когда в sourceText попал раздел каталога
    if (fromText && fromText.toLowerCase() !== "климат и вентиляция" && fromText.toLowerCase() !== "охлаждение") {
      roomName = fromText;
    }
  }

  if (roomName) {
    parts.push(t(language, "client.pdf.cooling.room", { name: roomName }));
  }

  if (kw > 0) parts.push(t(language, "client.pdf.cooling.coolingKw", { kw }));
  if (btu > 0) parts.push(t(language, "client.pdf.cooling.btu", { btu }));
  if (elec > 0) parts.push(t(language, "client.pdf.cooling.consumption", { kw: elec }));
  if (ex > 0) parts.push(t(language, "client.pdf.cooling.exhaust", { m3: ex }));

  // Если вообще никаких характеристик не нашли (редкий кейс)
  if (parts.length === 1) {
    parts.push(t(language, "client.pdf.cooling.specsTbd"));
  }

  return safePdfText(parts.join("\n"));
}

async function tableForMerged(doc, rows, project, startY, brandRgb, purchaseStatuses, compact = false, pdfOpts = {}) {
  const language = projectClientLanguage(project);
  const photoCol = 1;
  const nameCol = 2;
  // Фото вставляется только если это валидная картинка (см. loadPdfImage), иначе ячейка = «—».
  const photoMap = await buildPdfPhotoMap(rows, undefined, pdfOpts);
  const head = [[
    t(language, "client.pdf.header.num"),
    t(language, "client.pdf.header.photo"),
    t(language, "client.pdf.header.name"),
    t(language, "client.pdf.header.qtyShort"),
    t(language, "client.pdf.header.unitShort"),
    t(language, "client.pdf.header.sum"),
    t(language, "client.pdf.header.supplier"),
    ...(!compact ? [t(language, "client.pdf.header.source")] : []),
  ]];
  const body = rows.map((r, i) => {
    const base = [
      i + 1,
      safePdfPhotoCell(),
      clientPdfNameCol(r, language),
      formatQty(r.qty, r.unit),
      tUnit(language, r.unit || "шт."),
      clientPdfMoneyOrTbd(r, project.currency, language),
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

function mergedForRole(items, role, project = null) {
  return rowsForResponsibleRole(buildClientPurchaseMergedRows(items, mergeOpts(project)), role);
}

/** Строки без ссылки (helper для фильтров/тестов; отдельной PDF-секцией не выводятся). */
export function rowsWithoutLink(rows) {
  return (rows || []).filter((r) => !(r.link || "").trim());
}

/** Инструкции закупочного PDF — без отдельного блока «без ссылок». */
export function getClientPurchasePdfInstructionLines(language = "ru") {
  return [1, 2].map((n) => t(language, `client.pdf.instructions.${n}`));
}

/** Закупочный PDF больше не дублирует no_link отдельной секцией. */
export function clientPurchasePdfIncludesNoLinkSection() {
  return false;
}

/**
 * Структура закупочного PDF: поставщики + сводка.
 * no_link позиции остаются только внутри обычных групп поставщиков.
 */
export function buildClientPurchasePdfOutline(mergedRows, language = "ru") {
  const merged = mergedRows || [];
  const supplierGroups = groupRowsBySupplier(merged, language);
  const noLinkInSuppliers = supplierGroups.flatMap((g) => rowsWithoutLink(g.rows));
  const totalSum = merged.reduce((s, r) => s + (Number(r.sumVat) || 0), 0);
  return {
    uniqueCount: merged.length,
    totalSum,
    supplierGroups,
    noLinkCount: rowsWithoutLink(merged).length,
    noLinkInSupplierGroups: noLinkInSuppliers,
    includeNoLinkSection: clientPurchasePdfIncludesNoLinkSection(),
    instructionLines: getClientPurchasePdfInstructionLines(language),
  };
}

/** Группировка строк по поставщику (без поставщика — отдельным ключом) */
export function groupRowsBySupplier(rows, language = "ru") {
  const map = new Map();
  for (const r of rows || []) {
    const key = (r.supplier || "").trim() || t(language, "client.pdf.noSupplier");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ru"))
    .map(([supplier, list]) => ({
      supplier,
      rows: list,
      count: list.length,
      sum: list.reduce((s, r) => s + (r.sumVat || 0), 0),
    }));
}

async function addQr(doc, branding, pageUrl, project) {
  if (branding.pdfShowQr === false || !pageUrl) return;
  try {
    const qr = await QRCode.toDataURL(pageUrl, { width: 120, margin: 0 });
    const pageH = doc.internal.pageSize.getHeight();
    const y = pageH - 36;
    doc.addImage(qr, "PNG", 14, y, 22, 22);
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(pt(project, "client.pdf.qrCaption"), 40, y + 12);
  } catch {
    /* ignore */
  }
}

function contactsBlock(doc, branding, y, project) {
  y = ensureSpace(doc, y, 30);
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(pt(project, "client.pdf.contactsTitle"), 14, y);
  y += 7;
  doc.setFontSize(9);
  const parts = [branding.contactPhone, branding.contactEmail, branding.contactTelegram].filter(Boolean);
  doc.text(parts.length ? parts.join(" · ") : branding.companyName || "Daogreen", 14, y);
  return y + 12;
}

function instructionBlock(doc, y, project) {
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.usageTitle"), 14, y);
  y += 6;
  doc.setFontSize(9);
  const lines = [1, 2, 3, 4].map((n) => pt(project, `client.pdf.instructionList.${n}`));
  for (const line of lines) {
    doc.text(line, 14, y);
    y += 5;
  }
  return y + 6;
}

function categorySummaryTable(doc, merged, project, y, brandRgb) {
  y = ensureSpace(doc, y, 30);
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.sectionSummary.title"), 14, y);
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(pt(project, "client.pdf.sectionSummary.subtitle"), 14, y + 5);
  doc.setTextColor(30, 30, 30);
  y += 10;
  const bySection = new Map();
  for (const row of merged || []) {
    const title = tSection(projectClientLanguage(project), row.clientSection, row.clientSectionLabel || pt(project, "client.pdf.section.misc"));
    if (!bySection.has(title)) bySection.set(title, []);
    bySection.get(title).push(row);
  }
  const sections = [...bySection.entries()].sort(([a], [b]) => a.localeCompare(b, "ru"));
  autoTable(doc, {
    startY: y,
    head: [[
      pt(project, "client.pdf.header.section"),
      pt(project, "client.pdf.header.positions"),
      pt(project, "client.pdf.header.sum"),
      pt(project, "client.pdf.header.done"),
    ]],
    body: sections.map(([title, list]) => {
      const sum = list.reduce((s, r) => s + (r.sumVat || 0), 0);
      const done = list.filter((r) => (r.sourceItems || []).every((i) => isBoughtStatus(i.status))).length;
      return [title, list.length, pdfMoney(sum, project), list.length ? `${Math.round((done / list.length) * 100)}%` : "0%"];
    }),
    styles: { fontSize: 8, ...pdfTableFontStyles() },
    headStyles: { fillColor: brandRgb, ...pdfTableHeadFontStyles() },
  });
  return doc.lastAutoTable.finalY + 10;
}

function purchaseInstruction(doc, y, project) {
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  for (const line of getClientPurchasePdfInstructionLines(projectClientLanguage(project))) {
    doc.text(line, 14, y);
    y += 5;
  }
  doc.setTextColor(30, 30, 30);
  return y + 4;
}

async function supplierBlocks(doc, rows, project, y, brandRgb, purchaseStatuses, pdfOpts) {
  for (const g of groupRowsBySupplier(rows, projectClientLanguage(project))) {
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(10);
    doc.text(pt(project, "client.pdf.supplierBlock.title", {
      supplier: g.supplier,
      count: g.count,
      sum: pdfMoney(g.sum, project),
    }), 14, y);
    y += 4;
    y = await tableForMerged(doc, g.rows, project, y, brandRgb, purchaseStatuses, true, pdfOpts);
  }
  return y;
}

/** «Закупочный PDF для клиента»: итоги + по поставщикам + сводка по разделам. Без специалистов. */
async function renderClientPurchasePdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, pt(project, "client.pdf.subtitle.clientPurchase"));
  y = budgetLines(doc, items, project, y);
  y = purchaseInstruction(doc, y, project);
  const merged = mergedRowsForProject(project, items);

  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.sectionTitle.supplier", { n: merged.length }), 14, y);
  y += 6;
  y = await supplierBlocks(doc, merged, project, y, brandRgb, purchaseStatuses, pdfOpts);

  // no_link позиции остаются только в обычных блоках поставщиков — без отдельной секции-дубля.

  // Раздел — только сводка (раздел / кол-во / сумма / готовность), без повтора товарных строк.
  // Полная детализация по разделам — в «Полном техническом комплекте», Excel и онлайн-версии.
  y = categorySummaryTable(doc, merged, project, y, brandRgb);
  return contactsBlock(doc, branding, y, project);
}

/** «PDF по поставщикам»: итоги + блоки по поставщикам. */
async function renderSupplierPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, pt(project, "client.pdf.subtitle.supplier"));
  y = budgetLines(doc, items, project, y);
  const merged = mergedRowsForProject(project, items);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.sectionTitle.supplierSimple", { n: merged.length }), 14, y);
  y += 6;
  y = await supplierBlocks(doc, merged, project, y, brandRgb, purchaseStatuses, pdfOpts);
  return contactsBlock(doc, branding, y, project);
}

function fullKitWarning(doc, y, project) {
  y = ensureSpace(doc, y, 24);
  doc.setFillColor(255, 248, 225);
  doc.rect(12, y - 4, 186, 18, "F");
  doc.setFontSize(9);
  doc.setTextColor(150, 90, 0);
  const text = pt(project, "client.pdf.fullKitWarning");
  const wrapped = doc.splitTextToSize(text, 180);
  doc.text(wrapped, 14, y + 1);
  doc.setTextColor(30, 30, 30);
  return y + 4 + wrapped.length * 4 + 6;
}

async function renderFullPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, pt(project, "client.pdf.subtitle.clientFull"));
  y = fullKitWarning(doc, y, project);
  y = budgetLines(doc, items, project, y);
  y = instructionBlock(doc, y, project);
  const merged = mergedRowsForProject(project, items);
  y = categorySummaryTable(doc, merged, project, y, brandRgb);

  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.sectionTitle.merged", { n: merged.length }), 14, y);
  y += 4;
  y = await tableForMerged(doc, merged, project, y, brandRgb, purchaseStatuses, false, pdfOpts);

  const bySection = new Map();
  for (const row of merged) {
    const key = tSection(projectClientLanguage(project), row.clientSection, row.clientSectionLabel || pt(project, "client.pdf.section.misc"));
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(row);
  }
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.sectionTitle.bySection"), 14, y);
  y += 8;
  for (const [title, list] of bySection) {
    y = ensureSpace(doc, y, 30);
    const sum = list.reduce((s, r) => s + (r.sumVat || 0), 0);
    doc.setFontSize(10);
    doc.text(`${title} — ${pdfMoney(sum, project)}`, 14, y);
    y += 4;
    y = await tableForMerged(doc, list, project, y, brandRgb, purchaseStatuses, true, pdfOpts);
  }

  for (const [label, role] of [
    [pt(project, "client.role.plumber"), "plumber"],
    [pt(project, "client.role.electrician"), "electrician"],
    [pt(project, "client.role.installer"), "installer"],
    [pt(project, "client.role.climate"), "climate"],
    [pt(project, "client.role.client"), "client"],
  ]) {
    const list = mergedForRole(items, role, project);
    if (!list.length) continue;
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(11);
    doc.text(pt(project, "client.pdf.specialistListTitle", { specialist: label }), 14, y);
    y += 4;
    y = await tableForMerged(doc, list, project, y, brandRgb, purchaseStatuses, false, pdfOpts);
  }

  return contactsBlock(doc, branding, y, project);
}

/** «Короткий список закупки»: компактная таблица без фото и без специалистов. */
async function renderShortPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, pt(project, "client.pdf.subtitle.clientShort"));
  y = budgetLines(doc, items, project, y);
  const merged = mergedRowsForProject(project, items);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.sectionTitle.compact", { n: merged.length }), 14, y);
  y += 4;
  y = await tableForShort(doc, merged, project, y, brandRgb);
  return contactsBlock(doc, branding, y, project);
}

async function renderMergedPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, pt(project, "client.pdf.subtitle.merged"));
  y = budgetLines(doc, items, project, y);
  const merged = mergedRowsForProject(project, items);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(pt(project, "client.pdf.sectionTitle.mergedSimple", { n: merged.length }), 14, y);
  y += 4;
  await tableForMerged(doc, merged, project, y, brandRgb, purchaseStatuses, false, pdfOpts);
}

async function renderSpecialistPdf(doc, project, items, branding, brandRgb, purchaseStatuses, mode, pdfOpts) {
  const titles = {
    plumber: pt(project, "client.pdf.subtitle.plumber"),
    electric: pt(project, "client.pdf.subtitle.electric"),
    installer: pt(project, "client.pdf.subtitle.installer"),
    climate: pt(project, "client.pdf.subtitle.climate"),
    consumables: pt(project, "client.pdf.subtitle.consumables"),
    client_role: pt(project, "client.pdf.subtitle.clientRole"),
  };
  const roles = {
    plumber: "plumber",
    electric: "electrician",
    installer: "installer",
    climate: "climate",
    consumables: "consumables",
    client_role: "client",
  };

  let y = drawTitleBlock(doc, project, branding, brandRgb, titles[mode] || pt(project, "client.pdf.subtitle.merged"));
  
  if (mode === "climate") {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const text = pt(project, "client.pdf.climateHint");
    const wrapped = doc.splitTextToSize(text, 180);
    doc.text(wrapped, 14, y);
    doc.setTextColor(30, 30, 30);
    y += wrapped.length * 4 + 4;
  }
  
  y = budgetLines(doc, items, project, y);

  // Та же фильтрация по роли, что в полном PDF и Excel (resolveResponsibleFull),
  // а не старые жёсткие section-наборы — чтобы составы совпадали.
  const source = mergedForRole(items, roles[mode] || mode, project);

  if (!source.length) {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(11);
    doc.text(pt(project, "client.pdf.emptySpecialist"), 14, y);
    return contactsBlock(doc, branding, y, project);
  }

  // Группировка по клиентскому разделу — только для читаемости вывода, не для фильтрации.
  const labelMap = getClientSectionLabelMap();
  const groups = new Map();
  for (const row of source) {
    const fallback = labelMap[row.clientSection] || row.clientSectionLabel || pt(project, "client.pdf.section.misc");
    const label = tSection(projectClientLanguage(project), row.clientSection, fallback);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }
  for (const [title, list] of groups) {
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(10);
    const sum = list.reduce((s, r) => s + (r.sumVat || 0), 0);
    doc.text(`${title} — ${pdfMoney(sum, project)}`, 14, y);
    y += 4;
    y = await tableForMerged(doc, list, project, y, brandRgb, purchaseStatuses, false, pdfOpts);
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
  const language = projectClientLanguage(project);
  if (mode === "flat") {
    return generateProjectPdf({ project, items, branding, purchaseStatuses, pageUrl });
  }

  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await setupPdfFonts(doc);
  const brandRgb = hexToRgb(branding.brandColor);
  const pdfOpts = clientToken ? { clientToken } : {};

  const resolvedMode = mode === "client" ? "client_full" : mode;

  drawCoverPage(doc, project, purchaseItems, branding, pdfOpts);
  doc.addPage();

  if (resolvedMode === "client_short") {
    await renderShortPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  } else if (resolvedMode === "client_purchase") {
    await renderClientPurchasePdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  } else if (resolvedMode === "supplier") {
    await renderSupplierPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  } else if (resolvedMode === "client_full") {
    await renderFullPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  } else if (resolvedMode === "merged") {
    await renderMergedPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  } else if (["plumber", "electric", "installer", "climate", "consumables", "client_role"].includes(resolvedMode)) {
    await renderSpecialistPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, resolvedMode, pdfOpts);
  } else {
    await renderMergedPdf(doc, project, purchaseItems, branding, brandRgb, purchaseStatuses, pdfOpts);
  }

  await addQr(doc, branding, pageUrl, project);

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    addFooter(doc, branding, p, total);
  }

  const modeSuffix = {
    client_short: t(language, "client.pdf.filenameSuffix.clientShort"),
    client_purchase: t(language, "client.pdf.filenameSuffix.clientPurchase"),
    supplier: t(language, "client.pdf.filenameSuffix.supplier"),
    client_full: t(language, "client.pdf.filenameSuffix.clientFull"),
    merged: t(language, "client.pdf.filenameSuffix.merged"),
    plumber: t(language, "client.pdf.filenameSuffix.plumber"),
    electric: t(language, "client.pdf.filenameSuffix.electric"),
    installer: t(language, "client.pdf.filenameSuffix.installer"),
    climate: t(language, "client.pdf.filenameSuffix.climate"),
    consumables: t(language, "client.pdf.filenameSuffix.consumables"),
    client_role: t(language, "client.pdf.filenameSuffix.clientRole"),
  };
  const safeName = (project.name || t(language, "client.pdf.filenameProject")).replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = project.version > 1 ? `_v${project.version}` : "";
  const suffix = modeSuffix[resolvedMode] ?? "";
  doc.save(`${t(language, "client.pdf.filenameTemplate", {
    name: safeName,
    version: ver,
    suffix,
  })}.pdf`);
}
