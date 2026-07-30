import React, { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api.js";
import { clearClientScope } from "./ClientGuard.jsx";
import { isUnauthorizedError, loginErrorMessage } from "../lib/requestErrors.js";

export default function AdminGuard() {
  const loc = useLocation();
  const [ok, setOk] = useState(null);
  const [checkError, setCheckError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCheckError("");
    api
      .getSettings()
      .then(() => {
        if (cancelled) return;
        clearClientScope();
        setOk(true);
      })
      .catch((error) => {
        if (cancelled) return;
        if (isUnauthorizedError(error)) {
          setOk(false);
          return;
        }
        setCheckError(loginErrorMessage(error));
        setOk(null);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

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
