import {
  parsePublishRulesSettings,
  publishRulesToSettings,
  PUBLISH_RULE_OPTIONS,
  ISSUE_LABELS,
  DEFAULT_CLIENT_LINK_TEMPLATE,
  DEFAULT_PUBLISH_RULES,
  clientLinkFromTemplate,
  validateItemsForPublish,
} from "../../shared/publishRules.js";

export {
  PUBLISH_RULE_OPTIONS,
  ISSUE_LABELS,
  DEFAULT_CLIENT_LINK_TEMPLATE,
  DEFAULT_PUBLISH_RULES,
  parsePublishRulesSettings,
  publishRulesToSettings,
  clientLinkFromTemplate,
  validateItemsForPublish,
};

export function buildPublishRulesForm(settings = {}) {
  const cfg = parsePublishRulesSettings(settings);
  return {
    rules: { ...cfg.rules },
    clientLinkTemplate: cfg.clientLinkTemplate,
  };
}
