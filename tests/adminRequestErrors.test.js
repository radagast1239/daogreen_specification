import { describe, expect, it } from "vitest";
import { isUnauthorizedError, loginErrorMessage } from "../src/lib/requestErrors.js";

describe("admin authentication error handling", () => {
  it("treats only HTTP 401 as an authentication loss", () => {
    expect(isUnauthorizedError({ status: 401 })).toBe(true);
    expect(isUnauthorizedError({ status: 429 })).toBe(false);
    expect(isUnauthorizedError({ status: 500 })).toBe(false);
    expect(isUnauthorizedError(new Error("network"))).toBe(false);
  });

  it("distinguishes login errors without treating temporary failures as a bad key", () => {
    expect(loginErrorMessage({ status: 401 })).toBe("Неверный ключ доступа.");
    expect(loginErrorMessage({ status: 429 })).toBe("Слишком много запросов, повторите позже.");
    expect(loginErrorMessage({ status: 503 })).toBe("Сервер временно недоступен. Повторите попытку.");
    expect(loginErrorMessage(new Error("network"))).toContain("Не удалось подключиться");
  });
});
