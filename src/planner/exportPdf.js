// Экспорт плана в PDF: альбом, клиентский, монтажный, закупочный.
import { jsPDF } from "jspdf";
import { PDF_SHEETS } from "./catalog.js";
import { PDF_LEGEND } from "./farmRules.js";

const CSS_VARS = `<style>svg{--brand:#116355;--muted:#6b7d74;--danger:#a5371f;--amber:#b9741d;--line-strong:#c3d4cb;--mono:'Courier New',monospace;}</style>`;
const EXPORT_W = 2200, EXPORT_H = 1500, MARGIN = 80;

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

function buildLayerSVG(svgEl, room, targetLayer) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("width", EXPORT_W);
  clone.setAttribute("height", EXPORT_H);
  clone.setAttribute("viewBox", `0 0 ${EXPORT_W} ${EXPORT_H}`);
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", 0); bg.setAttribute("y", 0); bg.setAttribute("width", EXPORT_W); bg.setAttribute("height", EXPORT_H); bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);
  clone.insertAdjacentHTML("afterbegin", CSS_VARS);
  const main = clone.querySelector("[data-main]");
  if (main) { const t = fitTransform(room); main.setAttribute("transform", `translate(${t.x},${t.y}) scale(${t.z})`); }
  clone.querySelectorAll("[data-ui]").forEach((n) => n.remove());

  const alwaysShow = new Set(["room", "zones", "partitions"]);
  if (targetLayer === "client") {
    clone.querySelectorAll("[data-layer]").forEach((g) => {
      const id = g.getAttribute("data-layer");
      if (id !== "client" && id !== "room" && id !== "zones") g.setAttribute("display", "none");
    });
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
      c.width = EXPORT_W * scale; c.height = EXPORT_H * scale;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
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

function drawLegendPage(pdf, meta, pageNum, sheetTitle) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const date = new Date().toLocaleDateString("ru-RU");

  pdf.setFontSize(16); pdf.setTextColor(17, 99, 85);
  pdf.text(sheetTitle, 14, 22);
  pdf.setFontSize(11); pdf.setTextColor(60);
  pdf.text("Условные обозначения объектов на плане", 14, 32);

  let y = 48;
  PDF_LEGEND.forEach((row) => {
    const [r, g, b] = hexRgb(row.color);
    pdf.setFillColor(r, g, b);
    pdf.rect(16, y - 5, 10, 10, "F");
    pdf.setDrawColor(120); pdf.rect(16, y - 5, 10, 10);
    pdf.setTextColor(30);
    pdf.setFontSize(11);
    pdf.text(row.label, 32, y + 2);
    y += 14;
  });

  pdf.setFontSize(10); pdf.setTextColor(90);
  pdf.text("Линии трасс: сплошная — трубы, пунктир — кабели. Связи объектов — пунктир со стрелкой.", 14, y + 8);
  pdf.text("Зоны: зелёный — чистая, коричневый — грязная, фиолетовый — буфер.", 14, y + 16);

  pdf.setDrawColor(180); pdf.rect(8, 6, pw - 16, ph - 14);
  pdf.setFontSize(9); pdf.setTextColor(90);
  pdf.text(`№${meta.projectId || "—"} · ${meta.projectName || ""} · ${date} · v${meta.version || "1"}`, pw - 14, ph - 10, { align: "right" });
  pdf.text(`Лист ${pageNum}. ${sheetTitle}`, 14, ph - 10);
}

function drawSpecPage(pdf, meta, pageNum, sheetTitle) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const date = new Date().toLocaleDateString("ru-RU");
  pdf.setFontSize(16); pdf.setTextColor(17, 99, 85);
  pdf.text(`Лист ${pageNum}. ${sheetTitle}`, 14, 20);
  pdf.setFontSize(11); pdf.setTextColor(60);
  pdf.text("Спецификация формируется из объектов плана и синхронизируется с проектом.", 14, 32);
  pdf.text(`Проект: ${meta.projectName || "—"}`, 14, 44);
  pdf.text("Нажмите «В спецификацию» в планировщике для обновления позиций.", 14, 56);
  pdf.setDrawColor(180); pdf.rect(8, 6, pw - 16, ph - 14);
  pdf.setFontSize(9); pdf.setTextColor(90);
  pdf.text(`№${meta.projectId || "—"} · ${date}`, pw - 14, ph - 10, { align: "right" });
}

export async function exportLayeredPDF(svgEl, room, layers, meta, mode = "full") {
  const modeDef = PDF_MODES[mode] || PDF_MODES.full;
  const sheets = modeDef.sheets?.length
    ? modeDef.sheets
    : (layers?.length ? layers : PDF_SHEETS.map((l) => ({ id: l.id, sheet: l.sheet })));

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const imgW = pw - 20, imgH = imgW * (EXPORT_H / EXPORT_W);
  const date = new Date().toLocaleDateString("ru-RU");

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

    const png = await rasterize(buildLayerSVG(svgEl, room, sheet.id));
    pdf.addImage(png, "PNG", 10, 8, imgW, imgH);
    pdf.setDrawColor(180); pdf.rect(8, 6, pw - 16, ph - 14);
    pdf.setFontSize(13); pdf.setTextColor(17, 99, 85);
    pdf.text(`Лист ${i + 1}. ${sheet.sheet}`, 14, ph - 10);
    pdf.setFontSize(9); pdf.setTextColor(90);
    pdf.text(`№${meta.projectId || "—"} · ${meta.projectName || ""} · ${date} · v${meta.version || "1"}`, pw - 14, ph - 10, { align: "right" });
    pdf.text("Daogreen Planner", pw - 14, ph - 16, { align: "right" });
  }

  const suffix = modeDef.suffix || "альбом";
  pdf.save(`${meta.projectName || "план"}_${suffix}.pdf`);
}
