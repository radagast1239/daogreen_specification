import React, { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getAdminKey, api } from "../lib/api.js";
import { clearClientScope } from "./ClientGuard.jsx";

export default function AdminGuard() {
  const loc = useLocation();
  const key = getAdminKey();
  const [ok, setOk] = useState(!!key ? null : false);

  useEffect(() => {
    if (!key) {
      setOk(false);
      return;
    }
    api
      .getMaterials()
      .then(() => {
        clearClientScope();
        setOk(true);
      })
      .catch(() => setOk(false));
  }, [key]);

  if (ok === false) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  if (ok !== true) {
    return (
      <div className="login-wrap">
        <div className="muted">Проверка доступа…</div>
      </div>
    );
  }

  return <Outlet />;
}
