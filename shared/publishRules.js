/** Правила публикации / отправки клиенту — общая логика front + back */

import { isMiscCategory } from "./clientSections.js";

export const PUBLISH_RULE_OPTIONS = [
  { id: "requirePrice", label: "Цена указана (> 0)" },
  { id: "requirePhoto", label: "Есть фото" },
  { id: "requireLink", label: "Есть ссылка на товар" },
  { id: "requireSupplier", label: "Указан поставщик" },
  { id: "requireQtyPositive", label: "Количество > 0" },
  { id: "requireApproved", label: "Галочка «Утверждено»" },
  { id: "blockMiscCategory", label: "Не «Прочее» — указана клиентская категория" },
];

export const ISSUE_LABELS = {
  no_price: "Нет цены",
  no_photo: "Нет фото",
  no_link: "Нет ссылки",
  no_supplier: "Нет поставщика",
  no_qty: "Количество = 0",
  not_approved: "Не утверждено",
  misc_category: "Категория «Прочее» — укажите клиентский раздел",
  min_client_items: "Мало позиций для клиента",
};

export const DEFAULT_CLIENT_LINK_TEMPLATE = `{greeting}

Список закупки по проекту «{projectName}»:
{url}

Откройте ссылку в браузере — там фото, цены и отметки «куплено».

{company}`;

export const DEFAULT_PUBLISH_RULES = {
  requirePrice: true,
  requirePhoto: true,
  requireLink: true,
  requireSupplier: false,
  requireQtyPositive: true,
  requireApproved: true,
  blockMiscCategory: true,
  requireMinClientItems: true,
  minClientItems: 1,
  allowForcePublish: true,
};

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function parsePublishRulesSettings(settings = {}) {
  const parsed = parseJson(settings.publishRules, null);
  const rules = {
    ...DEFAULT_PUBLISH_RULES,
    ...(parsed && typeof parsed === "object" ? parsed : {}),
  };
  return {
    rules,
    clientLinkTemplate:
      (settings.clientLinkTemplate || "").trim() || DEFAULT_CLIENT_LINK_TEMPLATE,
  };
}

export function publishRulesToSettings({ rules, clientLinkTemplate }) {
  const r = { ...DEFAULT_PUBLISH_RULES, ...(rules || {}) };
  return {
    publishRules: JSON.stringify({
      requirePrice: !!r.requirePrice,
      requirePhoto: !!r.requirePhoto,
      requireLink: !!r.requireLink,
      requireSupplier: !!r.requireSupplier,
      requireQtyPositive: !!r.requireQtyPositive,
      requireApproved: !!r.requireApproved,
      blockMiscCategory: r.blockMiscCategory !== false,
      requireMinClientItems: !!r.requireMinClientItems,
      minClientItems: Math.max(0, Number(r.minClientItems) || 0),
      allowForcePublish: r.allowForcePublish !== false,
    }),
    clientLinkTemplate: clientLinkTemplate || DEFAULT_CLIENT_LINK_TEMPLATE,
  };
}

export function clientLinkFromTemplate(template, { projectName, clientName, url, companyName = "Daogreen" }) {
  const greeting = clientName?.trim() ? `Здравствуйте, ${clientName.trim()}!` : "Здравствуйте!";
  const tpl = (template || DEFAULT_CLIENT_LINK_TEMPLATE).trim();
  return tpl
    .replace(/\{greeting\}/gi, greeting)
    .replace(/\{clientName\}/gi, clientName?.trim() || "")
    .replace(/\{projectName\}/gi, projectName || "проект")
    .replace(/\{url\}/gi, url || "")
    .replace(/\{company\}/gi, companyName || "Daogreen");
}

function clientReadyItems(items) {
  return (items || []).filter(
    (i) => i.approved && i.visible && i.enabled !== false && (Number(i.qty) || 0) > 0
  );
}

function checkItem(it, rules) {
  const problems = [];
  if (rules.requirePrice && !(Number(it.price) > 0)) {
    problems.push("no_price");
  }
  if (rules.requirePhoto && !(it.photoUrl || it.imageUrl)) {
    problems.push("no_photo");
  }
  if (rules.requireLink && !(it.link || "").trim()) {
    problems.push("no_link");
  }
  if (rules.requireSupplier && !(it.supplier || "").trim()) {
    problems.push("no_supplier");
  }
  if (rules.requireQtyPositive && !(Number(it.qty) > 0)) {
    problems.push("no_qty");
  }
  if (rules.requireApproved && !it.approved) {
    problems.push("not_approved");
  }
  if (rules.blockMiscCategory !== false && isMiscCategory(it)) {
    problems.push("misc_category");
  }
  return problems;
}

/** Проверка позиций, которые видит клиент (утверждено + видно + включено) */
export function validateItemsForPublish(items, config) {
  const { rules } =
    config?.rules != null
      ? { rules: config.rules, clientLinkTemplate: config.clientLinkTemplate }
      : parsePublishRulesSettings(config || {});

  const target = (items || []).filter((i) => i.visible && i.enabled !== false);
  const clientItems = clientReadyItems(items);
  const problems = [];
  const byIssue = {};

  for (const it of target) {
    for (const issue of checkItem(it, rules)) {
      problems.push({
        itemId: it.id,
        name: it.name,
        module: it.module,
        issue,
        label: ISSUE_LABELS[issue] || issue,
      });
      byIssue[issue] = (byIssue[issue] || 0) + 1;
    }
  }

  if (rules.requireMinClientItems && clientItems.length < (Number(rules.minClientItems) || 1)) {
    problems.push({
      itemId: null,
      name: "",
      module: "",
      issue: "min_client_items",
      label: `${ISSUE_LABELS.min_client_items}: нужно минимум ${rules.minClientItems}, сейчас ${clientItems.length}`,
    });
    byIssue.min_client_items = 1;
  }

  return {
    ok: problems.length === 0,
    problems,
    counts: {
      totalItems: (items || []).length,
      checkedItems: target.length,
      clientItems: clientItems.length,
      issueCount: problems.length,
      byIssue,
    },
    rules,
    allowForcePublish: rules.allowForcePublish !== false,
  };
}
