import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { money, formatQty, mergedPurchaseRows } from "../store/helpers.js";
import { lineGross, isBoughtStatus } from "./itemHelpers.js";
import { rowsForResponsibleRole } from "./responsibleResolve.js";
import { getClientSectionLabelMap } from "../../shared/clientSections.js";
import { isCoolingSpecItem } from "../../shared/itemTypes.js";
import { purchasePriorityLabel } from "../../shared/purchasePriority.js";
import { generateProjectPdf } from "./pdfExport.js";
import { setupPdfFonts, pdfTableFontStyles, pdfTableHeadFontStyles } from "./pdfFontSetup.js";
import { buildPdfPhotoMap, pdfPhotoTableHooks, PDF_PHOTO_COL_WIDTH_MM } from "./pdfImageHelpers.js";
import { safePdfText, safePdfPhotoCell } from "./pdfSafeValue.js";
import { buildClientPdfRowLabel } from "../../shared/clientPurchaseRows.js";

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

export function getShortPdfTableHead() {
  return ["№", "Наименование", "Кол", "Ед", "Сумма", "Поставщик"];
}

const COVER_USAGE_LINES = [
  "Этот PDF содержит список материалов для закупки и передачи специалистам.",
  "Позиции сгруппированы по разделам, поставщикам или ответственным.",
  'Если в строке указано "цена уточняется", позиция рассчитана автоматически или требует ручного подбора.',
  "Актуальные статусы закупки лучше проверять по клиентской ссылке.",
];

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
export function pickPriorityPurchaseItems(items, maxLines = 7) {
  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const merged = mergedPurchaseRows(purchaseItems);
  const picked = [];
  const seen = new Set();

  const addRow = (row, tier) => {
    const key = row.mergeKey || `${row.name}|${row.supplier}|${row.qty}`;
    if (seen.has(key) || picked.length >= maxLines) return;
    seen.add(key);
    const meta = rowPurchaseMeta(row);
    let suffix = "";
    if (tier === 1 && meta.purchasePriority) {
      suffix = ` (${purchasePriorityLabel(meta.purchasePriority)})`;
    } else if (tier === 2 && meta.deliveryDays > 7) {
      suffix = ` (поставка ${meta.deliveryDays} дн.)`;
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
  const purchaseItems = (items || []).filter((i) => i.itemRole !== "installation");
  const merged = options.merged || mergedPurchaseRows(purchaseItems);
  const budget = purchaseItems.reduce((s, i) => s + lineGross(i), 0);
  const priorityLines = pickPriorityPurchaseItems(purchaseItems);
  const parts = [branding.contactPhone, branding.contactEmail, branding.contactTelegram].filter(Boolean);

  return {
    title: "Спецификация закупки",
    projectName: project?.name || "—",
    client: project?.client || "—",
    city: project?.city || "—",
    version: project?.version ?? 1,
    generatedDate: new Date().toLocaleDateString("ru-RU"),
    totalAmount: money(budget, project?.currency || "₽"),
    itemCount: merged.length,
    contacts: parts.length ? parts.join(" · ") : branding.companyName || "Daogreen",
    priorityLines,
    priorityFallback:
      priorityLines.length > 0 ? null : "Приоритет закупки уточняется в клиентской ссылке.",
    usageLines: COVER_USAGE_LINES,
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
  doc.text(`Клиент: ${safePdfText(cover.client)}`, 14, y);
  y += 6;
  doc.text(`Город: ${safePdfText(cover.city)}`, 14, y);
  y += 6;
  doc.text(`Версия проекта: v${cover.version}`, 14, y);
  y += 6;
  doc.text(`Дата формирования: ${cover.generatedDate}`, 14, y);
  y += 10;

  doc.setFontSize(11);
  doc.text(`Итоговая сумма: ${cover.totalAmount}`, 14, y);
  y += 6;
  doc.text(`Количество позиций: ${cover.itemCount}`, 14, y);
  y += 12;

  doc.setFontSize(11);
  doc.text("Что купить в первую очередь", 14, y);
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
  doc.text("Как пользоваться документом", 14, y);
  y += 6;
  doc.setFontSize(9);
  for (const line of cover.usageLines) {
    const wrapped = doc.splitTextToSize(line, 182);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 4.5 + 1;
  }
  y += 8;

  doc.setFontSize(11);
  doc.text("Контакты Daogreen", 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.text(safePdfText(cover.contacts), 14, y);
}

async function tableForShort(doc, rows, project, startY, brandRgb) {
  const nameCol = 1;
  const head = [getShortPdfTableHead()];
  const body = rows.map((r, i) => [
    i + 1,
    clientPdfNameCol(r),
    formatQty(r.qty, r.unit),
    r.unit || "шт.",
    clientPdfMoneyOrTbd(r, project.currency),
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

export function clientPdfMoneyOrTbd(row, currency) {
  const rep = row.sourceItems?.[0];
  const coolingSpec = isCoolingSpecItem(rep || row);
  const priceUnset = coolingSpec && !(Number(row.price) > 0) && !(Number(row.sumVat) > 0);
  if (priceUnset) return "цена уточняется";
  return money(row.sumVat ?? lineGross(row), currency);
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

export function clientPdfNameCol(row) {
  const rep = row.sourceItems?.[0];
  const isCooling = isCoolingSpecItem(rep || row);
  if (!isCooling) return safePdfText(buildClientPdfRowLabel(row));

  // Для климата: собираем характеристики из sourceItems, если они есть.
  // Базовое название всегда "Сплит-система / кондиционер" (без суффиксов комнаты или количества)
  const baseName = "Сплит-система / кондиционер";
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
    parts.push(`Комната: ${roomName}`);
  }

  if (kw > 0) parts.push(`Холод: ${kw} кВт`);
  if (btu > 0) parts.push(`BTU: ${btu}`);
  if (elec > 0) parts.push(`Потребление: ~${elec} кВт`);
  if (ex > 0) parts.push(`Вытяжка: ${ex} м³/ч`);

  // Если вообще никаких характеристик не нашли (редкий кейс)
  if (parts.length === 1) {
    parts.push("Характеристики уточняются");
  }

  return safePdfText(parts.join("\n"));
}

async function tableForMerged(doc, rows, project, startY, brandRgb, purchaseStatuses, compact = false, pdfOpts = {}) {
  const photoCol = 1;
  const nameCol = 2;
  // Фото вставляется только если это валидная картинка (см. loadPdfImage), иначе ячейка = «—».
  const photoMap = await buildPdfPhotoMap(rows, undefined, pdfOpts);
  const head = compact
    ? [["№", "Фото", "Наименование", "Кол", "Ед", "Сумма", "Поставщик"]]
    : [["№", "Фото", "Наименование", "Кол", "Ед", "Сумма", "Поставщик", "Откуда"]];
  const body = rows.map((r, i) => {
    const base = [
      i + 1,
      safePdfPhotoCell(),
      clientPdfNameCol(r),
      formatQty(r.qty, r.unit),
      r.unit || "шт.",
      clientPdfMoneyOrTbd(r, project.currency),
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
  return rowsForResponsibleRole(mergedPurchaseRows(items), role);
}

/** Строки без ссылки на товар — «требуют подбора» */
export function rowsWithoutLink(rows) {
  return (rows || []).filter((r) => !(r.link || "").trim());
}

/** Группировка строк по поставщику (без поставщика — отдельным ключом) */
export function groupRowsBySupplier(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = (r.supplier || "").trim() || "— без поставщика —";
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

function purchaseInstruction(doc, y) {
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  const lines = [
    "Покупайте по поставщикам. После оплаты отмечайте статус в онлайн-версии.",
    "Позиции без ссылок требуют подбора — они собраны отдельным блоком.",
  ];
  for (const line of lines) {
    doc.text(line, 14, y);
    y += 5;
  }
  doc.setTextColor(30, 30, 30);
  return y + 4;
}

async function supplierBlocks(doc, rows, project, y, brandRgb, purchaseStatuses, pdfOpts) {
  for (const g of groupRowsBySupplier(rows)) {
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(10);
    doc.text(`${g.supplier} — ${g.count} поз. · ${money(g.sum, project.currency)}`, 14, y);
    y += 4;
    y = await tableForMerged(doc, g.rows, project, y, brandRgb, purchaseStatuses, true, pdfOpts);
  }
  return y;
}

/** «Закупочный PDF для клиента»: итоги + по поставщикам + без ссылок + по разделам. Без специалистов. */
async function renderClientPurchasePdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, "Закупочный лист");
  y = budgetLines(doc, items, project, y);
  y = purchaseInstruction(doc, y);
  const merged = mergedPurchaseRows(items);

  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(`Закупка по поставщикам · ${merged.length} уникальных позиций`, 14, y);
  y += 6;
  y = await supplierBlocks(doc, merged, project, y, brandRgb, purchaseStatuses, pdfOpts);

  const noLink = rowsWithoutLink(merged);
  if (noLink.length) {
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(11);
    doc.text(`Позиции без ссылок / требуют подбора · ${noLink.length}`, 14, y);
    y += 4;
    y = await tableForMerged(doc, noLink, project, y, brandRgb, purchaseStatuses, true, pdfOpts);
  }

  // Раздел — только сводка (раздел / кол-во / сумма / готовность), без повтора товарных строк.
  // Полная детализация по разделам — в «Полном техническом комплекте», Excel и онлайн-версии.
  y = categorySummaryTable(doc, merged, project, y, brandRgb);
  return contactsBlock(doc, branding, y);
}

/** «PDF по поставщикам»: итоги + блоки по поставщикам. */
async function renderSupplierPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, "Закупка по поставщикам");
  y = budgetLines(doc, items, project, y);
  const merged = mergedPurchaseRows(items);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(`По поставщикам · ${merged.length} позиций`, 14, y);
  y += 6;
  y = await supplierBlocks(doc, merged, project, y, brandRgb, purchaseStatuses, pdfOpts);
  return contactsBlock(doc, branding, y);
}

function fullKitWarning(doc, y) {
  y = ensureSpace(doc, y, 24);
  doc.setFillColor(255, 248, 225);
  doc.rect(12, y - 4, 186, 18, "F");
  doc.setFontSize(9);
  doc.setTextColor(150, 90, 0);
  const text =
    "Это полный технический комплект. Одни и те же товары могут повторяться в разных представлениях: " +
    "в общем списке, в разделах и в списках специалистов. Покупать повторно не нужно.";
  const wrapped = doc.splitTextToSize(text, 180);
  doc.text(wrapped, 14, y + 1);
  doc.setTextColor(30, 30, 30);
  return y + 4 + wrapped.length * 4 + 6;
}

async function renderFullPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, "Закупочный лист — полная версия");
  y = fullKitWarning(doc, y);
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
    ["Климат", "climate"],
    ["Клиент", "client"],
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

/** «Короткий список закупки»: компактная таблица без фото и без специалистов. */
async function renderShortPdf(doc, project, items, branding, brandRgb, purchaseStatuses, pdfOpts) {
  let y = drawTitleBlock(doc, project, branding, brandRgb, "Короткий список закупки");
  y = budgetLines(doc, items, project, y);
  const merged = mergedPurchaseRows(items);
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(11);
  doc.text(`Компактный список · ${merged.length} позиций`, 14, y);
  y += 4;
  y = await tableForShort(doc, merged, project, y, brandRgb);
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
    climate: "Список для специалиста по климату",
    consumables: "Расходники",
    client_role: "Список для клиента",
  };
  const roles = {
    plumber: "plumber",
    electric: "electrician",
    installer: "installer",
    climate: "climate",
    consumables: "consumables",
    client_role: "client",
  };

  let y = drawTitleBlock(doc, project, branding, brandRgb, titles[mode] || "Список");
  
  if (mode === "climate") {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const text = "В списке указаны сплит-системы, вентиляция и элементы климатической системы. Характеристики сплит-систем рассчитаны по комнатам.";
    const wrapped = doc.splitTextToSize(text, 180);
    doc.text(wrapped, 14, y);
    doc.setTextColor(30, 30, 30);
    y += wrapped.length * 4 + 4;
  }
  
  y = budgetLines(doc, items, project, y);

  // Та же фильтрация по роли, что в полном PDF и Excel (resolveResponsibleFull),
  // а не старые жёсткие section-наборы — чтобы составы совпадали.
  const source = mergedForRole(items, roles[mode] || mode);

  if (!source.length) {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(11);
    doc.text("Нет позиций для этого специалиста", 14, y);
    return contactsBlock(doc, branding, y);
  }

  // Группировка по клиентскому разделу — только для читаемости вывода, не для фильтрации.
  const labelMap = getClientSectionLabelMap();
  const groups = new Map();
  for (const row of source) {
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

  await addQr(doc, branding, pageUrl);

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    addFooter(doc, branding, p, total);
  }

  const modeSuffix = {
    client_short: "_короткий",
    client_purchase: "_закупка",
    supplier: "_по_поставщикам",
    client_full: "_полный",
    merged: "_общий",
    plumber: "_сантехник",
    electric: "_электрик",
    installer: "_монтажник",
    climate: "_климат",
    consumables: "_расходники",
    client_role: "_клиент",
  };
  const safeName = (project.name || "проект").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const ver = project.version > 1 ? `_v${project.version}` : "";
  const suffix = modeSuffix[resolvedMode] ?? "";
  doc.save(`Daogreen_Закупочный_лист_${safeName}${ver}${suffix}.pdf`);
}
