import React from "react";
import { Link, useParams } from "react-router-dom";
import { Empty } from "./ui.jsx";
import { clientLink, clientRoutePath } from "../lib/api.js";

const CLIENT_SCOPE_KEY = "daogreen-client-scope";

export function setClientScope(token) {
  if (token) sessionStorage.setItem(CLIENT_SCOPE_KEY, token);
}

export function getClientScope() {
  return sessionStorage.getItem(CLIENT_SCOPE_KEY) || "";
}

export function clearClientScope() {
  sessionStorage.removeItem(CLIENT_SCOPE_KEY);
}

export function isClientRoutePath(pathname = "") {
  return /\/client(\/p)?\//.test(pathname);
}

/** Блокировка: клиент попал не на свою страницу */
export function ClientAccessDenied() {
  const token = getClientScope();
  return (
    <div className="client-page" style={{ minHeight: "100vh", paddingTop: 48 }}>
      <div className="client-wrap">
        <Empty title="Доступ только к вашему списку закупки" hint="Эта ссылка открывает только ваш проект — без доступа к расчётам и админке.">
          {token && (
            <Link className="btn btn-primary" to={clientRoutePath(token)} style={{ marginTop: 16 }}>
              Вернуться к моему списку
            </Link>
          )}
        </Empty>
      </div>
    </div>
  );
}

/** Обёртка клиентской страницы — фиксирует scope по токену */
export function ClientScope({ children }) {
  const { token } = useParams();
  React.useEffect(() => {
    if (token) setClientScope(token);
  }, [token]);
  return <div className="client-isolated">{children}</div>;
}
