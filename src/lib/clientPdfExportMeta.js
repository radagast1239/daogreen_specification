import { mergedPurchaseRows } from "../store/helpers.js";
import { clientPurchaseItems, itemsByResponsible } from "./itemHelpers.js";

/** Варианты PDF для клиента — подписи и пояснения */
export const CLIENT_PDF_EXPORT_OPTIONS = [
  {
    id: "merged",
    label: "Список к закупке",
    recommended: true,
    summary: "Одна таблица — только уникальные позиции.",
    detail:
      "Одинаковые товары с разных стеллажей и модулей уже объединены в одну строку с суммарным количеством. Без повторов.",
    useWhen: "Печать, закупка, отправка клиенту — обычно достаточно этого.",
  },
  {
    id: "client_full",
    label: "Полный комплект",
    recommended: false,
    summary: "Общий список + разделы + списки для специалистов.",
    detail:
      "Те же позиции показываются несколько раз: сначала общий список, затем по разделам (полив, электрика…), затем срезы для сантехника, электрика и монтажника. Это не дубли закупки — один товар не нужно покупать дважды.",
    useWhen: "Передать бригаде по блокам или раздать специалистам одним файлом.",
    largeFile: true,
  },
  {
    id: "plumber",
    label: "Только сантехник",
    recommended: false,
    summary: "Полив, дренаж, ёмкости, водоподготовка, насосы.",
    detail: "Склеенный список позиций, которые относятся к сантехнику. С указанием, из каких модулей взялось количество.",
    useWhen: "Отдельный лист для сантехника или подрядчика.",
  },
  {
    id: "electric",
    label: "Только электрик",
    recommended: false,
    summary: "Щит, кабель, автоматика, освещение, датчики.",
    detail: "Склеенный список для электромонтажа и автоматики.",
    useWhen: "Отдельный лист для электрика.",
  },
  {
    id: "installer",
    label: "Только монтажник",
    recommended: false,
    summary: "Каркас, стеллажи, климат, расходники монтажа.",
    detail: "Склеенный список для монтажника и сборки стеллажей.",
    useWhen: "Отдельный лист для монтажной бригады.",
  },
];

export function getClientPdfExportStats(items) {
  const purchase = clientPurchaseItems({ items: items || [] });
  const merged = mergedPurchaseRows(purchase);
  const mergedCount = merged.length;
  const rawCount = purchase.length;

  const plumberMerged = mergedPurchaseRows(itemsByResponsible(purchase, "plumber")).length;
  const electricMerged = mergedPurchaseRows(itemsByResponsible(purchase, "electrician")).length;
  const installerMerged = mergedPurchaseRows(itemsByResponsible(purchase, "installer")).length;

  const fullPdfTableRows =
    mergedCount * 2 + plumberMerged + electricMerged + installerMerged;

  return {
    rawCount,
    mergedCount,
    plumberMerged,
    electricMerged,
    installerMerged,
    fullPdfTableRows,
    savedByMerge: Math.max(0, rawCount - mergedCount),
  };
}

export function pdfExportOptionStats(optionId, stats) {
  switch (optionId) {
    case "merged":
      return `${stats.mergedCount} строк в PDF`;
    case "client_full":
      return `~${stats.fullPdfTableRows} строк в файле · ${stats.mergedCount} уникальных позиций`;
    case "plumber":
      return stats.plumberMerged ? `${stats.plumberMerged} строк` : "нет позиций";
    case "electric":
      return stats.electricMerged ? `${stats.electricMerged} строк` : "нет позиций";
    case "installer":
      return stats.installerMerged ? `${stats.installerMerged} строк` : "нет позиций";
    default:
      return "";
  }
}
