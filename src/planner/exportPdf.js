// Экспорт плана в многослойный PDF: одна страница на лист, рамка + штамп.
import { jsPDF } from "jspdf";
import { PDF_SHEETS } from "./catalog.js";

const CSS_VARS = `<style>svg{--brand:#116355;--muted:#6b7d74;--danger:#a5371f;--amber:#b9741d;--line-strong:#c3d4cb;--mono:'Courier New',monospace;}</style>`;
const EXPORT_W = 2200, EXPORT_H = 1500, MARGIN = 80;

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

// layers: [{id, sheet}] — порядок страниц; meta: {projectName, projectId, version}
export async function exportLayeredPDF(svgEl, room, layers, meta) {
  const sheets = layers?.length ? layers : PDF_SHEETS.map((l) => ({ id: l.id, sheet: l.sheet }));
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const imgW = pw - 20, imgH = imgW * (EXPORT_H / EXPORT_W);
  const date = new Date().toLocaleDateString("ru-RU");

  for (let i = 0; i < sheets.length; i++) {
    if (i > 0) pdf.addPage();
    if (sheets[i].id === "spec") {
      pdf.setFontSize(16); pdf.setTextColor(17, 99, 85);
      pdf.text(`Лист ${i + 1}. ${sheets[i].sheet}`, 14, 20);
      pdf.setFontSize(11); pdf.setTextColor(60);
      pdf.text("Спецификация формируется из объектов плана и синхронизируется с проектом.", 14, 32);
      pdf.text(`Проект: ${meta.projectName || "—"}`, 14, 44);
    } else {
      const png = await rasterize(buildLayerSVG(svgEl, room, sheets[i].id));
      pdf.addImage(png, "PNG", 10, 8, imgW, imgH);
    }
    pdf.setDrawColor(180); pdf.rect(8, 6, pw - 16, ph - 14);
    pdf.setFontSize(13); pdf.setTextColor(17, 99, 85);
    pdf.text(`Лист ${i + 1}. ${sheets[i].sheet}`, 14, ph - 10);
    pdf.setFontSize(9); pdf.setTextColor(90);
    pdf.text(`№${meta.projectId || "—"} · ${meta.projectName || ""} · ${date} · v${meta.version || "1"}`, pw - 14, ph - 10, { align: "right" });
    pdf.text("Daogreen Planner", pw - 14, ph - 16, { align: "right" });
  }
  pdf.save(`${meta.projectName || "план"}_альбом.pdf`);
}
