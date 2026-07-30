import { mergedPurchaseRows } from "../store/helpers.js";
import { clientPurchaseItems, itemsByResponsible } from "./itemHelpers.js";
import { t } from "../../shared/clientI18n.js";

/** Вариант PDF для клиента, выбранный по умолчанию */
export const DEFAULT_CLIENT_PDF_OPTION = "client_purchase";

/** Варианты PDF для клиента — подписи и пояснения. group: "primary" | "specialist" */
export const CLIENT_PDF_EXPORT_OPTIONS = [
  {
    id: "client_short",
    label: "Короткий список закупки",
    group: "primary",
    recommended: false,
    summary: "Компактный список без фото.",
    description: "Компактный список без фото для быстрой печати или отправки.",
    detail: "Один общий список: №, наименование, количество, сумма и поставщик. Без фото и без блоков специалистов.",
    useWhen: "Быстро распечатать или отправить закупщику короткий перечень.",
  },
  {
    id: "supplier",
    label: "PDF по поставщикам",
    group: "primary",
    recommended: false,
    summary: "Каждый поставщик — отдельным блоком.",
    detail: "Удобно закупать по магазинам: позиции сгруппированы по поставщикам, с количеством и суммой по каждому.",
    useWhen: "Когда закупка идёт магазин за магазином.",
  },
  {
    id: "client_full",
    label: "Полный технический комплект",
    group: "primary",
    recommended: false,
    summary: "Общий список + разделы + специалисты.",
    detail:
      "Те же позиции показываются несколько раз: общий список, затем по разделам, затем срезы для специалистов. Это не дубли закупки — один товар не нужно покупать повторно.",
    useWhen: "Передать бригаде по блокам или раздать специалистам одним файлом.",
    largeFile: true,
  },
  {
    id: "client_purchase",
    label: "Закупочный PDF для клиента",
    group: "primary",
    recommended: true,
    summary: "Без дублей. Для закупки и контроля.",
    detail:
      "Итоги, закупка по поставщикам, сводка по разделам и QR на онлайн-версию. Позиции без ссылок остаются в обычных блоках поставщиков — без отдельной секции-дубля. Без списков специалистов, чтобы не было ощущения повторов.",
    useWhen: "Обычный вариант для клиента — покупка по одному списку без дублей.",
  },
  {
    id: "plumber",
    label: "Сантехник",
    group: "specialist",
    recommended: false,
    summary: "Полив, дренаж, ёмкости, водоподготовка, насосы.",
    detail: "Склеенный список позиций, которые относятся к сантехнику. С указанием, из каких модулей взялось количество.",
    useWhen: "Отдельный лист для сантехника или подрядчика.",
  },
  {
    id: "electric",
    label: "Электрик",
    group: "specialist",
    recommended: false,
    summary: "Щит, кабель, автоматика, освещение, датчики.",
    detail: "Склеенный список для электромонтажа и автоматики.",
    useWhen: "Отдельный лист для электрика.",
  },
  {
    id: "installer",
    label: "Монтажник",
    group: "specialist",
    recommended: false,
    summary: "Каркас, стеллажи, расходники монтажа.",
    detail: "Склеенный список для монтажника и сборки стеллажей.",
    useWhen: "Отдельный лист для монтажной бригады.",
  },
  {
    id: "climate",
    label: "Климат",
    group: "specialist",
    recommended: false,
    summary: "Сплит-системы, вентиляторы, трубы кондиционирования.",
    detail: "Склеенный список позиций, которые относятся к климату и вентиляции.",
    useWhen: "Отдельный лист для подрядчика по климату.",
  },
  {
    id: "client_role",
    label: "Список для клиента",
    group: "specialist",
    recommended: false,
    summary: "Позиции с ответственным «Клиент».",
    detail: "Склеенный список позиций, которые клиент закупает или обеспечивает сам.",
    useWhen: "Отдельный лист для клиента.",
  },
];

export function getClientPdfExportStats(items, project = null) {
  const opts = { stellageConfigs: project?.stellageConfigs || project?.stellageCounts || [] };
  const purchase = clientPurchaseItems({ items: items || [] });
  const merged = mergedPurchaseRows(purchase, opts);
  const mergedCount = merged.length;
  const rawCount = purchase.length;

  const plumberMerged = mergedPurchaseRows(itemsByResponsible(purchase, "plumber"), opts).length;
  const electricMerged = mergedPurchaseRows(itemsByResponsible(purchase, "electrician"), opts).length;
  const installerMerged = mergedPurchaseRows(itemsByResponsible(purchase, "installer"), opts).length;
  const climateMerged = mergedPurchaseRows(itemsByResponsible(purchase, "climate"), opts).length;
  const clientMerged = mergedPurchaseRows(itemsByResponsible(purchase, "client"), opts).length;

  const fullPdfTableRows =
    mergedCount * 2 + plumberMerged + electricMerged + installerMerged + climateMerged;

  return {
    rawCount,
    mergedCount,
    plumberMerged,
    electricMerged,
    installerMerged,
    climateMerged,
    clientMerged,
    fullPdfTableRows,
    savedByMerge: Math.max(0, rawCount - mergedCount),
  };
}

export function pdfExportOptionStats(optionId, stats, language = "ru") {
  switch (optionId) {
    case "client_short":
      return t(language, "client.pdfExport.stats.countNoPhoto", { n: stats.mergedCount });
    case "client_purchase":
      return t(language, "client.pdfExport.stats.countUnique", { n: stats.mergedCount });
    case "supplier":
      return t(language, "client.pdfExport.stats.countBySupplier", { n: stats.mergedCount });
    case "merged":
      return t(language, "client.pdfExport.stats.countRows", { n: stats.mergedCount });
    case "client_full":
      return t(language, "client.pdfExport.stats.countFull", { n: stats.mergedCount });
    case "plumber":
      return stats.plumberMerged ? t(language, "client.pdfExport.stats.countRows", { n: stats.plumberMerged }) : t(language, "client.pdfExport.stats.none");
    case "electric":
      return stats.electricMerged ? t(language, "client.pdfExport.stats.countRows", { n: stats.electricMerged }) : t(language, "client.pdfExport.stats.none");
    case "installer":
      return stats.installerMerged ? t(language, "client.pdfExport.stats.countRows", { n: stats.installerMerged }) : t(language, "client.pdfExport.stats.none");
    case "climate":
      return stats.climateMerged ? t(language, "client.pdfExport.stats.countRows", { n: stats.climateMerged }) : t(language, "client.pdfExport.stats.none");
    case "client_role":
      return stats.clientMerged ? t(language, "client.pdfExport.stats.countRows", { n: stats.clientMerged }) : t(language, "client.pdfExport.stats.none");
    default:
      return "";
  }
}
