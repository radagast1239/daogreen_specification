import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import { Empty } from "../../components/ui.jsx";

export default function ArchivePage() {
  const [items, setItems] = useState([]);
  const load = () => api.getArchive().then(setItems);
  useEffect(() => {
    load();
  }, []);

  const restore = async (id) => {
    await api.restoreProject(id);
    load();
  };

  return (
    <>
      <PageHeader title="Архив" sub="Архивные проекты не показываются на главной" />
      <div className="content">
        {items.length === 0 ? (
          <Empty title="Архив пуст" />
        ) : (
          items.map((p) => (
            <div key={p.id} className="card between" style={{ padding: 14, marginBottom: 8 }}>
              <div>
                <Link to={`/project/${p.id}`}>{p.name}</Link>
                <div className="muted" style={{ fontSize: 12 }}>{p.client}</div>
              </div>
              <button className="btn btn-sm" onClick={() => restore(p.id)}>
                Восстановить
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
