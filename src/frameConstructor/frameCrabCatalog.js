/** Каталог типов краб-системы для UI и PDF. Файлы: public/frame-crabs/{file}.svg|.jpg|.png */

export const FRAME_CRAB_CATALOG = [
  {
    key: 'G',
    connectorId: 'connector-g',
    file: 'g',
    label: 'Краб-система Г-образная',
    shortLabel: 'Г',
    description: 'Угол 90°, два направления',
  },
  {
    key: 'T',
    connectorId: 'connector-t',
    file: 't',
    label: 'Краб-система T-образная',
    shortLabel: 'T',
    description: 'Тройник, три направления',
  },
  {
    key: 'X',
    connectorId: 'connector-x',
    file: 'x',
    label: 'Краб-система X-образная',
    shortLabel: 'X',
    description: 'Крест, четыре направления в плоскости',
  },
  {
    key: 'A4',
    connectorId: 'connector-a4',
    file: 'a4',
    label: 'Краб система угол на 4 стороны',
    shortLabel: '4×',
    description: 'Угловой узел на четыре стороны',
  },
  {
    key: 'A6',
    connectorId: 'connector-a6',
    file: 'a6',
    label: 'Краб система угол на 6 сторон',
    shortLabel: '6×',
    description: 'Угловой узел на шесть сторон',
  },
];

const BY_CONNECTOR_ID = Object.fromEntries(
  FRAME_CRAB_CATALOG.map((item) => [item.connectorId, item]),
);

const BY_KEY = Object.fromEntries(
  FRAME_CRAB_CATALOG.map((item) => [item.key, item]),
);

/** @param {string} connectorId */
export function crabCatalogByConnectorId(connectorId) {
  return BY_CONNECTOR_ID[connectorId] ?? null;
}

/** @param {string} key */
export function crabCatalogByKey(key) {
  return BY_KEY[key] ?? null;
}

/** @param {string} file */
export function crabImagePublicPath(file, ext = 'svg') {
  const base = import.meta.env.BASE_URL || '/';
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}frame-crabs/${file}.${ext}`;
}

/** @param {{ file: string }} entry */
export function crabImageSrc(entry) {
  return crabImagePublicPath(entry.file, 'svg');
}
