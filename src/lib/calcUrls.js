/** Базовый origin для калькуляторов (nginx :80). Spec на :3002 — калькуляторы на том же хосте без порта. */
export function calcOrigin() {
  const fromEnv = import.meta.env.VITE_CALC_ORIGIN?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  if (typeof window === "undefined") return "";

  const { protocol, hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return import.meta.env.VITE_CALC_ORIGIN || "http://62.233.35.206";
  }

  if (port === "3002" || port === "5173") {
    return `${protocol}//${hostname}`;
  }

  return window.location.origin;
}

export function berryCalculatorUrl() {
  return `${calcOrigin()}/berry/`;
}

export function economicCalculatorUrl() {
  return `${calcOrigin()}/economic/calculator-110x55_12.html`;
}
