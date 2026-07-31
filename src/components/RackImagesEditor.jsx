import React, { useState } from "react";
import { api, photoSrc } from "../lib/api.js";
import AuthMediaImg from "./AuthMediaImg.jsx";
import FloorPlanViewer from "./FloorPlanViewer.jsx";
import { addRackImage, moveRackImage, normalizeRackImages, updateRackImage } from "../lib/rackImages.js";

export default function RackImagesEditor({ rackId, images, onChange, onConfirmRemove }) {
  const list = normalizeRackImages(images);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [viewerIndex, setViewerIndex] = useState(null);

  const upload = async (file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/") || /\.pdf$/i.test(file.name || "")) {
      setUploadError("Разрешены только изображения PNG, JPG/JPEG, WEBP и другие безопасные image-форматы. PDF не поддерживается.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const { url } = await api.uploadPhoto(file);
      onChange(addRackImage(list, file, url, rackId));
    } catch (e) {
      setUploadError(e.message || "Не удалось загрузить изображение");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (image) => {
    const ok = onConfirmRemove ? await onConfirmRemove(image) : window.confirm(`Удалить «${image.title}»?`);
    if (ok) onChange(list.filter((item) => item.id !== image.id));
  };

  return (
    <section className="card rack-images-editor">
      <h4>Дополнительные схемы и изображения</h4>
      <p className="muted">Внутренние материалы выбранного стеллажа. Они не публикуются клиенту и не входят в Frame BOM.</p>
      {uploadError && <p className="rack-images-editor__error" role="alert">{uploadError}</p>}
      {list.length ? (
        <div className="rack-images-editor__grid">
          {list.map((image, index) => (
            <article key={image.id} className="rack-image-card">
              <button type="button" className="rack-image-card__thumb" onClick={() => setViewerIndex(index)}>
                <AuthMediaImg src={photoSrc(image.url)} alt={image.title} />
              </button>
              <input aria-label="Название изображения" value={image.title} onChange={(e) => onChange(updateRackImage(list, image.id, { title: e.target.value }))} />
              <label className="rack-image-card__visibility">
                <input type="checkbox" checked={image.clientVisible === true} onChange={(e) => onChange(updateRackImage(list, image.id, { clientVisible: e.target.checked }))} />
                Показывать клиенту
              </label>
              <span className="muted rack-image-card__status">{image.clientVisible === true ? "Будет показано клиенту после публикации" : "Только для меня"}</span>
              <div className="row wrap" style={{ gap: 4 }}>
                <button type="button" className="btn btn-sm" onClick={() => setViewerIndex(index)}>Открыть</button>
                <button type="button" className="btn btn-sm" disabled={index === 0} onClick={() => onChange(moveRackImage(list, image.id, "up"))}>↑</button>
                <button type="button" className="btn btn-sm" disabled={index === list.length - 1} onClick={() => onChange(moveRackImage(list, image.id, "down"))}>↓</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(image)}>Удалить</button>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="muted rack-images-editor__empty">Дополнительных изображений пока нет.</p>}
      <label className="btn btn-sm btn-outline rack-images-editor__add">
        {uploading ? "Загрузка…" : "Добавить изображение"}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden disabled={uploading} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {viewerIndex != null && list[viewerIndex] && (
        <FloorPlanViewer schemes={list} activeIndex={viewerIndex} onActiveIndexChange={setViewerIndex} open onClose={() => setViewerIndex(null)} title="Дополнительное изображение" />
      )}
    </section>
  );
}
