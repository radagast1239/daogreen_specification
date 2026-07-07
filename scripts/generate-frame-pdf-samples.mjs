/**
 * Generate local QA samples for frame constructor PDF output.
 *
 * Usage:
 *   npx vite-node scripts/generate-frame-pdf-samples.mjs
 *
 * Note: plain `node` fails — frame PDF modules transitively import Vite `import.meta.env`.
 *
 * Output:
 *   tmp-pdf-samples/
 *
 * Safety:
 *   - local-only
 *   - does not touch backend/data
 *   - does not touch backend/uploads
 *   - does not contact production
 *   - generated files are ignored by git
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateFrameGeometry } from '../src/frameConstructor/frameGeometry.js';
import { generateCutList } from '../src/frameConstructor/frameCutList.js';
import { defaultFrameParams } from '../src/frameConstructor/framePresets.js';
import { canExportFramePdf } from '../src/frameConstructor/framePdfData.js';
import { buildFramePdfDocument } from '../src/frameConstructor/framePdfExport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'tmp-pdf-samples');

const cases = [
  { name: 'nft-6beams', params: { ...defaultFrameParams, lengthMm: 3000, depthMm: 500, crossBeamsPerLevel: 6 } },
  { name: 'nft-8beams', params: { ...defaultFrameParams, lengthMm: 3000, depthMm: 500, crossBeamsPerLevel: 8 } },
  { name: 'custom-1340', params: { ...defaultFrameParams, rackType: 'custom', lengthMm: 1340, depthMm: 500, trayEnabled: false } },
  { name: 'welded', params: { ...defaultFrameParams, connectionType: 'welded' } },
  {
    name: 'seedling-trays',
    params: {
      ...defaultFrameParams,
      rackType: 'seedling',
      postCountX: 2,
      postCountY: 2,
      lengthMm: 1340,
      depthMm: 701,
      crossBeamsPerLevel: 3,
      trayEnabled: true,
      trayLengthMm: 1300,
      trayWidthMm: 641,
    },
  },
];

fs.mkdirSync(outDir, { recursive: true });

for (const c of cases) {
  const geom = calculateFrameGeometry(c.params);
  if (!canExportFramePdf(geom)) {
    console.error('SKIP invalid geometry:', c.name);
    continue;
  }
  const cutList = generateCutList(c.params);
  const { doc, filename } = await buildFramePdfDocument({
    config: c.params,
    geometry: geom,
    cutList,
  });
  const outPath = path.join(outDir, `${c.name}-${filename}`);
  fs.writeFileSync(outPath, Buffer.from(doc.output('arraybuffer')));
  console.log('Wrote', outPath);
}

console.log('Done. Output dir:', outDir);
