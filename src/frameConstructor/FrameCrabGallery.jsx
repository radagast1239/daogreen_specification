import React, { useCallback, useRef, useState } from 'react';
import { FRAME_CRAB_CATALOG } from './frameCrabCatalog.js';
import { crabDisplayQty } from './frameCrabRules.js';
import {
  clearCrabPhotoOverride,
  getCrabPhotoOverride,
  resolveCrabImageSrc,
  uploadCrabPhoto,
} from './frameCrabPhotos.js';
import { useCrabPhotoVersion } from './useCrabPhotoVersion.js';

/**
 * Справочник краб-системы с фото для конструктора каркаса.
 * @param {{ counts?: Record<string, number>|null }} props
 */
export default function FrameCrabGallery({ counts = null }) {
  useCrabPhotoVersion();
  const inputRefs = useRef({});
  const [uploadingKey, setUploadingKey] = useState(null);
  const [uploadError, setUploadError] = useState('');

  const handlePickFile = useCallback((item) => {
    setUploadError('');
    inputRefs.current[item.key]?.click();
  }, []);

  const handleFileChange = useCallback(async (item, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploadingKey(item.key);
    setUploadError('');
    try {
      await uploadCrabPhoto(item.file, file);
    } catch (err) {
      setUploadError(err?.message || 'Не удалось загрузить фото.');
    } finally {
      setUploadingKey(null);
    }
  }, []);

  const handleReset = useCallback((item) => {
    clearCrabPhotoOverride(item.file);
    setUploadError('');
  }, []);

  return (
    <section className="fc-crab-gallery" aria-label="Типы краб-системы">
      <h3 className="fc-crab-gallery__title">Краб-система — типы соединений</h3>
      {uploadError && (
        <p className="fc-crab-gallery__error" role="alert">{uploadError}</p>
      )}
      <div className="fc-crab-gallery__grid">
        {FRAME_CRAB_CATALOG.map((item) => {
          const qtySets = counts?.[item.key] ?? 0;
          const inUse = qtySets > 0;
          const display = inUse ? crabDisplayQty(qtySets, item.key) : null;
          const hasCustom = Boolean(getCrabPhotoOverride(item.file));
          const isUploading = uploadingKey === item.key;

          return (
            <article
              key={item.key}
              className={`fc-crab-card${inUse ? ' is-active' : ''}${hasCustom ? ' has-custom-photo' : ''}`}
            >
              <div className="fc-crab-card__photo-wrap">
                <img
                  className="fc-crab-card__photo"
                  src={resolveCrabImageSrc(item)}
                  alt={item.label}
                  loading="lazy"
                />
                <div className="fc-crab-card__photo-actions">
                  <button
                    type="button"
                    className="fc-crab-card__upload"
                    onClick={() => handlePickFile(item)}
                    disabled={isUploading}
                    title={`Загрузить фото: ${item.label}`}
                  >
                    {isUploading ? 'Загрузка…' : 'Загрузить фото'}
                  </button>
                  {hasCustom && (
                    <button
                      type="button"
                      className="fc-crab-card__reset"
                      onClick={() => handleReset(item)}
                      disabled={isUploading}
                      title="Вернуть стандартное изображение"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
                <input
                  ref={(el) => { inputRefs.current[item.key] = el; }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="fc-crab-card__file-input"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => handleFileChange(item, e)}
                />
              </div>
              <div className="fc-crab-card__body">
                <div className="fc-crab-card__badge">{item.shortLabel}</div>
                <div className="fc-crab-card__name">{item.label}</div>
                <div className="fc-crab-card__desc">{item.description}</div>
                {counts && (
                  <div className={`fc-crab-card__qty${inUse ? ' is-used' : ''}`}>
                    {inUse ? `В каркасе: ${display.qty} ${display.unit}` : 'Не используется'}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
