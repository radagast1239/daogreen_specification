/** Client project load error classification (pure). */

export const CLIENT_LOAD_ERROR = {
  NOT_PUBLISHED: "NOT_PUBLISHED",
  EXPIRED: "EXPIRED",
  NOT_FOUND: "NOT_FOUND",
  NETWORK: "NETWORK",
};

export function classifyClientProjectLoadError(error) {
  if (!error) return null;
  if (error.code === "NOT_PUBLISHED" || error.code === "PUBLISHED_SNAPSHOT_MISSING") {
    return CLIENT_LOAD_ERROR.NOT_PUBLISHED;
  }
  if (error.status === 410) return CLIENT_LOAD_ERROR.EXPIRED;
  if (error.status === 403 && error.code === "NOT_PUBLISHED") return CLIENT_LOAD_ERROR.NOT_PUBLISHED;
  if (error.status === 404) return CLIENT_LOAD_ERROR.NOT_FOUND;
  return CLIENT_LOAD_ERROR.NETWORK;
}

export function clientProjectLoadMessage(kind) {
  switch (kind) {
    case CLIENT_LOAD_ERROR.NOT_PUBLISHED:
      return {
        title: "Проект пока не опубликован",
        hint: "Обратитесь к менеджеру за актуальной версией.",
      };
    case CLIENT_LOAD_ERROR.EXPIRED:
      return {
        title: "Ссылка устарела",
        hint: "Попросите Daogreen прислать новую ссылку на проект.",
      };
    case CLIENT_LOAD_ERROR.NOT_FOUND:
      return {
        title: "Проект не найден",
        hint: "Проверьте ссылку — она должна начинаться с /spec/client/p/…",
      };
    default:
      return {
        title: "Не удалось загрузить проект",
        hint: "Проверьте подключение к интернету и попробуйте позже.",
      };
  }
}

export function clientLinkActiveState(project) {
  const hasToken = Boolean(String(project?.clientToken || "").trim());
  const published = Boolean(project?.publishedRelease?.versionId);
  return {
    hasClientToken: hasToken,
    hasPublishedRelease: published,
    clientLinkActive: hasToken && published,
    needsPublishBeforeClientLink: hasToken && !published,
  };
}
