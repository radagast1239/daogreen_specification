// Экспорт плана в PDF: альбом, клиентский, монтажный, закупочный.
import { jsPDF } from "jspdf";
import { PDF_SHEETS } from "./catalog.js";
import { PDF_LEGEND } from "./farmRules.js";

const BRAND_RGB = [17, 99, 85];
const TEXT_RGB = [47, 52, 49];
const MUTED_RGB = [111, 122, 117];
const CSS_VARS = `<style>svg{--brand:#116355;--muted:#6f7a75;--danger:#a5371f;--amber:#b9741d;--line-strong:#d9e0dc;--mono:'Courier New',monospace;}</style>`;
const EXPORT_W = 2200;
const EXPORT_H = 1500;
const MARGIN = 80;
const FRAME_INSET = 8;

export const PDF_MODES = {
  full: {
    label: "Полный альбом",
    suffix: "альбом",
    sheets: null,
  },
  client: {
    label: "Клиентский",
    suffix: "клиент",
    sheets: [
      { id: "client", sheet: "Клиентский вид" },
      { id: "legend", sheet: "Условные обозначения" },
    ],
  },
  install: {
    label: "Монтажный",
    suffix: "монтаж",
    sheets: [
      { id: "install", sheet: "Монтажный вид" },
      { id: "partitions", sheet: "Перегородки" },
      { id: "racks", sheet: "Стеллажи" },
      { id: "irrigation", sheet: "Полив" },
      { id: "power", sheet: "Электрика" },
      { id: "sockets", sheet: "Розетки" },
      { id: "climate", sheet: "Климат" },
      { id: "vent", sheet: "Вентиляция" },
      { id: "legend", sheet: "Условные обозначения" },
    ],
  },
  purchase: {
    label: "Закупочный",
    suffix: "закупка",
    sheets: [{ id: "spec", sheet: "Спецификация" }],
  },
};

function fitTransform(room) {
  const z = Math.min((EXPORT_W - 2 * MARGIN) / room.w, (EXPORT_H - 2 * MARGIN) / room.h);
  return { z, x: (EXPORT_W - room.w * z) / 2, y: (EXPORT_H - room.h * z) / 2 };
}

function pdfScaleLabel(roomWmm, imgWmm) {
  if (!roomWmm || !imgWmm) return "—";
  const raw = roomWmm / imgWmm;
  const nice = [50, 75, 100, 125, 150, 200, 250, 500, 1000];
  const closest = nice.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
  return `1:${closest}`;
}

/** false | 'major' — клиентский PDF всегда без сетки. */
function gridExportMode(targetLayer, exportOpts = {}) {
  if (targetLayer === "client" || targetLayer === "legend" || targetLayer === "spec") return false;
  const majorOnly = exportOpts.pdfGridMajorOnly !== false;
  if (targetLayer === "install" && exportOpts.pdfGridInstall) return majorOnly ? "major" : "all";
  const technicalLayers = new Set([
    "partitions", "racks", "irrigation", "power", "sockets", "climate", "vent", "drain", "supply", "ac", "light",
  ]);
  if (technicalLayers.has(targetLayer) && exportOpts.pdfGridTechnical) return majorOnly ? "major" : "all";
  return false;
}

function buildLayerSVG(svgEl, room, targetLayer, exportOpts = {}) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("width", EXPORT_W);
  clone.setAttribute("height", EXPORT_H);
  clone.setAttribute("viewBox", `0 0 ${EXPORT_W} ${EXPORT_H}`);
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", 0);
  bg.setAttribute("y", 0);
  bg.setAttribute("width", EXPORT_W);
  bg.setAttribute("height", EXPORT_H);
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);
  clone.insertAdjacentHTML("afterbegin", CSS_VARS);
  const main = clone.querySelector("[data-main]");
  if (main) {
    const t = fitTransform(room);
    main.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.z})`);
  }

  const keepGrid = gridExportMode(targetLayer, exportOpts);
  clone.querySelectorAll("[data-ui]").forEach((n) => {
    const ui = n.getAttribute("data-ui");
    if (keepGrid && (ui === "grid" || ui === "axes")) return;
    if (ui === "selection-handles" || ui === "state-icons") {
      n.remove();
      return;
    }
    n.remove();
  });
  if (keepGrid === "major") {
    clone.querySelectorAll("[data-grid-level]").forEach((n) => {
      const lvl = n.getAttribute("data-grid-level");
      if (lvl !== "xl" && lvl !== "major") n.remove();
    });
  }

  const alwaysShow = new Set(["room", "zones", "partitions"]);
  if (targetLayer === "client") {
    clone.querySelectorAll("[data-layer]").forEach((g) => {
      const id = g.getAttribute("data-layer");
      if (id !== "client" && id !== "room" && id !== "zones") g.setAttribute("display", "none");
    });
    clone.querySelectorAll("[data-layer-muted]").forEach((g) => g.removeAttribute("data-layer-muted"));
  } else if (targetLayer === "install") {
    clone.querySelectorAll("[data-layer]").forEach((g) => {
      const id = g.getAttribute("data-layer");
      if (id === "spec" || id === "client") g.setAttribute("display", "none");
    });
  } else if (targetLayer === "spec") {
    clone.querySelectorAll("[data-layer]").forEach((g) => g.setAttribute("display", "none"));
  } else {
    clone.querySelectorAll("[data-layer]").forEach((g) => {
      const id = g.getAttribute("data-layer");
      if (id !== targetLayer && !alwaysShow.has(id)) g.setAttribute("display", "none");
    });
  }
  return new XMLSerializer().serializeToString(clone);
}

function rasterize(svgStr, scale = 1.6) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = EXPORT_W * scale;
      c.height = EXPORT_H * scale;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/png"));
    };
    img.onerror = rej;
    img.src = url;
  });
}

function hexRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Рамка листа и штамп проектной документации. */
function drawSheetFrame(pdf, meta, { pageNum, sheetTitle, scaleLabel, imgTop = 8, imgH = 0 }) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const date = new Date().toLocaleDateString("ru-RU");
  const tbW = 82;
  const tbH = 34;
  const tbX = pw - FRAME_INSET - tbW;
  const tbY = ph - FRAME_INSET - tbH;

  pdf.setDrawColor(...TEXT_RGB);
  pdf.setLineWidth(0.35);
  pdf.rect(FRAME_INSET, 6, pw - FRAME_INSET * 2, ph - 12);

  pdf.setDrawColor(217, 224, 220);
  pdf.rect(tbX, tbY, tbW, tbH);
  pdf.line(tbX, tbY + 9, tbX + tbW, tbY + 9);
  pdf.line(tbX, tbY + 18, tbX + tbW, tbY + 18);
  pdf.line(tbX, tbY + 27, tbX + tbW, tbY + 27);
  pdf.line(tbX + tbW * 0.52, tbY, tbX + tbW * 0.52, tbY + tbH);

  pdf.setFontSize(8.5);
  pdf.setTextColor(...BRAND_RGB);
  pdf.text("Daogreen Farm Planner", tbX + 2.5, tbY + 6.5);

  pdf.setFontSize(7);
  pdf.setTextColor(...TEXT_RGB);
  pdf.text((meta.projectName || "—").slice(0, 38), tbX + 2.5, tbY + 15);
  pdf.text(`Лист ${pageNum}. ${sheetTitle}`.slice(0, 42), tbX + 2.5, tbY + 24);

  pdf.text(`Масштаб ${scaleLabel}`, tbX + tbW * 0.52 + 2.5, tbY + 15);
  pdf.text(`${date} · v${meta.version || "1"}`, tbX + tbW * 0.52 + 2.5, tbY + 24);
  pdf.setTextColor(...MUTED_RGB);
  pdf.text(`№ ${meta.projectId || "—"}`, tbX + tbW * 0.52 + 2.5, tbY + 31.5);

  if (imgH > 0) {
    const planY = imgTop + imgH + 2;
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED_RGB);
    pdf.text("План в масштабе листа. Размеры на чертеже — в миллиметрах.", FRAME_INSET + 2, planY);
  }
}

function drawLegendPage(pdf, meta, pageNum, sheetTitle) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();

  pdf.setFontSize(15);
  pdf.setTextColor(...BRAND_RGB);
  pdf.text(sheetTitle, FRAME_INSET + 6, 22);
  pdf.setFontSize(10);
  pdf.setTextColor(...MUTED_RGB);
  pdf.text("Условные обозначения объектов на плане", FRAME_INSET + 6, 30);

  let y = 44;
  PDF_LEGEND.forEach((row) => {
    const [r, g, b] = hexRgb(row.color);
    pdf.setFillColor(r, g, b);
    pdf.rect(FRAME_INSET + 8, y - 5, 10, 10, "F");
    pdf.setDrawColor(217, 224, 220);
    pdf.rect(FRAME_INSET + 8, y - 5, 10, 10);
    pdf.setTextColor(...TEXT_RGB);
    pdf.setFontSize(10);
    pdf.text(row.label, FRAME_INSET + 24, y + 2);
    y += 13;
  });

  pdf.setFontSize(9);
  pdf.setTextColor(...MUTED_RGB);
  pdf.text("Линии: сплошная — трубы и воздуховоды; пунктир — кабели и маршруты.", FRAME_INSET + 6, y + 6);
  pdf.text("Зоны: голубая — чистая, коричневая — грязная, серая — техническая.", FRAME_INSET + 6, y + 13);
  pdf.text("Стены: двойная линия — наружные; тонкая — перегородки.", FRAME_INSET + 6, y + 20);

  drawSheetFrame(pdf, meta, { pageNum, sheetTitle, scaleLabel: "—" });
}

function drawSpecPage(pdf, meta, pageNum, sheetTitle) {
  pdf.setFontSize(15);
  pdf.setTextColor(...BRAND_RGB);
  pdf.text(`Лист ${pageNum}. ${sheetTitle}`, FRAME_INSET + 6, 22);
  pdf.setFontSize(10);
  pdf.setTextColor(...MUTED_RGB);
  pdf.text("Спецификация формируется из объектов плана и синхронизируется с проектом.", FRAME_INSET + 6, 32);
  pdf.setTextColor(...TEXT_RGB);
  pdf.text(`Проект: ${meta.projectName || "—"}`, FRAME_INSET + 6, 44);
  pdf.text("Нажмите «В спецификацию» в планировщике для обновления позиций.", FRAME_INSET + 6, 54);
  drawSheetFrame(pdf, meta, { pageNum, sheetTitle, scaleLabel: "—" });
}

export async function exportLayeredPDF(svgEl, room, layers, meta, mode = "full", exportOpts = {}) {
  const modeDef = PDF_MODES[mode] || PDF_MODES.full;
  const sheets = modeDef.sheets?.length
    ? modeDef.sheets
    : (layers?.length ? layers : PDF_SHEETS.map((l) => ({ id: l.id, sheet: l.sheet })));

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const pw = pdf.internal.pageSize.getWidth();
  const imgW = pw - 20;
  const imgH = imgW * (EXPORT_H / EXPORT_W);
  const scaleLabel = pdfScaleLabel(room?.w, imgW);

  for (let i = 0; i < sheets.length; i++) {
    if (i > 0) pdf.addPage();
    const sheet = sheets[i];

    if (sheet.id === "legend") {
      drawLegendPage(pdf, meta, i + 1, sheet.sheet);
      continue;
    }
    if (sheet.id === "spec") {
      drawSpecPage(pdf, meta, i + 1, sheet.sheet);
      continue;
    }

    const png = await rasterize(buildLayerSVG(svgEl, room, sheet.id, exportOpts));
    pdf.addImage(png, "PNG", 10, 8, imgW, imgH);
    drawSheetFrame(pdf, meta, {
      pageNum: i + 1,
      sheetTitle: sheet.sheet,
      scaleLabel,
      imgTop: 8,
      imgH,
    });
  }

  const suffix = modeDef.suffix || "альбом";
  pdf.save(`${meta.projectName || "план"}_${suffix}.pdf`);
}
