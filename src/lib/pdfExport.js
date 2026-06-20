import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { money, num } from "../store/helpers.js";
import { lineGross } from "./itemHelpers.js";

export async function generateProjectPdf({ project, items, branding = {} }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const brand = branding.brandColor || "#116355";
  doc.setFillColor(brand);
  doc.rect(0, 0, 210, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(branding.companyName || "Daogreen", 14, 12);
  doc.setFontSize(11);
  doc.text(project.name, 14, 20);
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.text(`${project.client || ""} · ${new Date().toLocaleDateString("ru-RU")}`, 14, 36);

  autoTable(doc, {
    startY: 42,
    head: [["Наименование", "Кол", "Ед", "Цена", "Сумма", "Поставщик"]],
    body: items.map((it) => [
      it.name,
      num(it.qty),
      it.unit,
      money(it.price, project.currency),
      money(lineGross(it), project.currency),
      it.supplier || "—",
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [17, 99, 85] },
  });

  doc.save(`${project.name}_закупка.pdf`);
}
