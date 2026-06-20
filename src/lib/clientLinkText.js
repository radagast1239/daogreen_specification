export function clientLinkMessage({ projectName, clientName, url, companyName = "Daogreen" }) {
  const greeting = clientName?.trim() ? `Здравствуйте, ${clientName.trim()}!` : "Здравствуйте!";
  return `${greeting}

Список закупки по проекту «${projectName}»:
${url}

Откройте ссылку в браузере — там фото, цены и отметки «куплено».

${companyName}`;
}
