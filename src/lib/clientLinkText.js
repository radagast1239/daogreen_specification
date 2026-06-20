import { clientLinkFromTemplate, DEFAULT_CLIENT_LINK_TEMPLATE } from "./publishRulesConfig.js";

/** @deprecated use clientLinkFromTemplate with settings template */
export function clientLinkMessage({ projectName, clientName, url, companyName = "Daogreen", template }) {
  return clientLinkFromTemplate(template || DEFAULT_CLIENT_LINK_TEMPLATE, {
    projectName,
    clientName,
    url,
    companyName,
  });
}
