/** Базовый origin для калькуляторов (nginx :80). Spec на :3002 — калькуляторы на том же хосте без порта. */
const VPS_CALC_ORIGIN = "http://62.233.35.206";

const HOSTS_WITHOUT_CALC_PROXY = new Set([
  "localhost",
  "127.0.0.1",
  "nikita-daogreen.ru",
  "www.nikita-daogreen.ru",
]);

export function calcOrigin() {
  const fromEnv = import.meta.env.VITE_CALC_ORIGIN?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  if (typeof window === "undefined") return VPS_CALC_ORIGIN;

  const { protocol, hostname, port } = window.location;

  if (HOSTS_WITHOUT_CALC_PROXY.has(hostname)) {
    return import.meta.env.VITE_CALC_ORIGIN || VPS_CALC_ORIGIN;
  }

  if (port === "3002" || port === "5173") {
    return `${protocol}//${hostname}`;
  }

  return window.location.origin;
}

export function berryCalculatorUrl() {
  return `${calcOrigin()}/berry/`;
}

/** Калькулятор салатов (посадка, каналы, поддоны). */
export function economicCalculatorUrl() {
  return `${calcOrigin()}/salad/calculator-110x55_12.html`;
}

/** Только финмодель (вкладка «Экономика»). */
export function saladEconomicsUrl() {
  return `${calcOrigin()}/finmodel/calculator-110x55_12.html`;
}
