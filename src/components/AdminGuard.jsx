import React, { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getAdminKey, api } from "../lib/api.js";
import { clearClientScope } from "./ClientGuard.jsx";
import { isUnauthorizedError, loginErrorMessage } from "../lib/requestErrors.js";

export default function AdminGuard() {
  const loc = useLocation();
  const key = getAdminKey();
  const [ok, setOk] = useState(!!key ? null : false);
  const [checkError, setCheckError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!key) {
      setOk(false);
      return;
    }
    setCheckError("");
    api
      .getSettings()
      .then(() => {
        clearClientScope();
        setOk(true);
      })
      .catch((error) => {
        if (isUnauthorizedError(error)) {
          setOk(false);
          return;
        }
        setCheckError(loginErrorMessage(error));
        setOk(null);
      });
  }, [key, retry]);

  if (ok === false) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  if (ok !== true) {
    return (
      <div className="login-wrap">
        {checkError && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ color: "var(--danger)", fontSize: 13 }}>{checkError}</p>
            <button type="button" className="btn btn-primary" onClick={() => setRetry((n) => n + 1)}>
              Повторить
            </button>
          </div>
        )}
        <div className="muted">Проверка доступа…</div>
      </div>
    );
  }

  return <Outlet />;
}
