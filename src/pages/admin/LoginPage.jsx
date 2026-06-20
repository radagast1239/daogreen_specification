import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setAdminKey, getAdminKey, api } from "../../lib/api.js";

export default function LoginPage() {
  const nav = useNavigate();
  const [key, setKey] = useState(getAdminKey());
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErr("");
    setAdminKey(key.trim());
    try {
      await api.getMaterials();
      nav("/", { replace: true });
      window.location.reload();
    } catch {
      setErr("Неверный ключ или API недоступен. Запусти: npm run dev:api в папке backend");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brandmark" style={{ marginBottom: 20 }}>
          <div className="spine" />
          <div>
            <b>Daogreen</b>
            <span>Spec</span>
          </div>
        </div>
        <h2 style={{ margin: "0 0 8px" }}>Вход администратора</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Ключ API из <code>backend/.env</code> (ADMIN_KEY)
        </p>
        <div className="field">
          <label>Ключ доступа</label>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        </div>
        {err && <p style={{ color: "var(--danger)", fontSize: 13 }}>{err}</p>}
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 12 }} disabled={loading}>
          {loading ? "Проверка…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
