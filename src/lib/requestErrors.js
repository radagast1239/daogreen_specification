export function isUnauthorizedError(error) {
  return error?.status === 401;
}

export function loginErrorMessage(error) {
  if (isUnauthorizedError(error)) return "Неверный ключ доступа.";
  if (error?.status === 429) return "Слишком много запросов, повторите позже.";
  if (error?.status >= 500) return "Сервер временно недоступен. Повторите попытку.";
  return "Не удалось подключиться к API. Проверьте соединение и повторите попытку.";
}
