import React, { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";

export default function ModulesPage() {
  const [mods, setMods] = useState([]);
  useEffect(() => {
    api.getModulesAdmin().then(setMods);
  }, []);

  return (
    <>
      <PageHeader title="Шаблоны / модули" sub="Из них собирается спецификация фермы" />
      <div className="content">
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="spec">
            <thead>
              <tr>
                <th>Модуль</th>
                <th>Тип</th>
                <th>Технология</th>
                <th className="right">Позиций в базе</th>
              </tr>
            </thead>
            <tbody>
              {mods.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong></td>
                  <td className="muted">{m.type}</td>
                  <td className="muted">{m.tech}</td>
                  <td className="right num">{m.materialCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
