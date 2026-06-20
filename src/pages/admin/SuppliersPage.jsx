import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";

export default function SuppliersPage() {
  const [list, setList] = useState([]);
  useEffect(() => {
    api.getSuppliers().then(setList);
  }, []);

  return (
    <>
      <PageHeader title="Поставщики" sub="Из базы материалов" />
      <div className="content">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {list.map((s) => (
            <div key={s.name} className="card" style={{ padding: 14 }}>
              <strong>{s.name}</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {s.materialCount} позиций
              </div>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
          Редактируй поставщика в <Link to="/materials">базе материалов</Link>.
        </p>
      </div>
    </>
  );
}
