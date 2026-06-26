import React, { useState } from "react";

export default function DuplicateProjectModal({ sourceProject, onClose, onSubmit }) {
  const [name, setName] = useState(`${sourceProject.name} (копия)`);
  const [client, setClient] = useState("");
  const [mode, setMode] = useState("new_purchase");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await onSubmit({ name: name.trim(), client: client.trim(), mode });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Создать проект на основе прошлого</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 14px" }}>
          Источник: <b>{sourceProject.name}</b> · {sourceProject.items?.length || sourceProject.itemCount || 0} поз.
        </p>
        <div className="field">
          <label>Название нового проекта</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Клиент (можно оставить пустым)</label>
          <input value={client} onChange={(e) => setClient(e.target.value)} placeholder={sourceProject.client || ""} />
        </div>
        <div className="field">
          <label style={{ marginBottom: 8 }}>Режим копирования</label>
          <label className="publish-rule-row">
            <input type="radio" name="dup-mode" checked={mode === "new_purchase"} onChange={() => setMode("new_purchase")} />
            <span><b>Новая закупка</b> — статусы «Не куплено», без комментариев клиента</span>
          </label>
          <label className="publish-rule-row" style={{ marginTop: 8 }}>
            <input type="radio" name="dup-mode" checked={mode === "copy_as_is"} onChange={() => setMode("copy_as_is")} />
            <span><b>Копировать как есть</b> — сохранить статусы закупки</span>
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Копируются позиции, цены, поставщики, ссылки, разделы, видимость и комментарии. Новый проект не связан с исходным.
        </p>
        <div className="row wrap" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" disabled={!name.trim() || loading} onClick={submit}>
            {loading ? "Создание…" : "Создать проект"}
          </button>
        </div>
      </div>
    </div>
  );
}
