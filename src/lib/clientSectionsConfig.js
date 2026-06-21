import {
  configureClientSections,
  parseClientSectionsJson,
  getClientSections,
  DEFAULT_CLIENT_SECTIONS,
} from "../../shared/clientSections.js";

export { parseClientSectionsJson, getClientSections, DEFAULT_CLIENT_SECTIONS, configureClientSections };

export function resolveClientSections(settings = {}) {
  return parseClientSectionsJson(settings.clientSectionsJson);
}

export function applyClientSectionsFromSettings(settings = {}) {
  const sections = resolveClientSections(settings);
  configureClientSections(sections);
  return sections;
}

export function clientSectionsToSettings(sections) {
  return {
    clientSectionsJson: JSON.stringify(
      (sections || []).map((s, i) => ({
        id: s.id,
        label: s.label,
        subsections: s.subsections || [],
        hidden: s.hidden === true,
        order: i,
      }))
    ),
  };
}
