import { useEffect, useState } from 'react';
import { subscribeCrabPhotos } from './frameCrabPhotos.js';

/** Перерисовка компонентов при смене пользовательских фото крабов. */
export function useCrabPhotoVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeCrabPhotos(() => setVersion((v) => v + 1)), []);
  return version;
}
