import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useStore } from "../store/StoreContext.jsx";

export default function AdminGuard() {
  const { state } = useStore();
  if (state.error && !state.ready) return <Navigate to="/login" replace />;
  if (state.loading && !state.ready) {
    return (
      <div className="login-wrap">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }
  return <Outlet />;
}
