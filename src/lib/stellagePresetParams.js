/** Параметры стеллажа в пресете (SPEC §6) */
export const DEFAULT_STELLAGE_PARAMS = {
  length: "",
  width: "",
  height: "",
  tiers: "",
  traysPerTier: "",
  lightsPerTier: "",
  defaultCount: 1,
  crop: "",
  zone: "",
  comment: "",
};

export function normalizeStellageParams(raw = {}) {
  return {
    ...DEFAULT_STELLAGE_PARAMS,
    ...raw,
    defaultCount: Math.max(1, Number(raw.defaultCount) || 1),
  };
}

export function formatStellageParamsSummary(params) {
  const p = normalizeStellageParams(params);
  const parts = [];
  if (p.length) parts.push(`L ${p.length} м`);
  if (p.width) parts.push(`W ${p.width} м`);
  if (p.height) parts.push(`H ${p.height} м`);
  if (p.tiers) parts.push(`${p.tiers} яр.`);
  if (p.lightsPerTier) parts.push(`${p.lightsPerTier} свет/яр.`);
  if (p.traysPerTier) parts.push(`${p.traysPerTier} подд./яр.`);
  if (p.crop) parts.push(p.crop);
  if (p.defaultCount > 1) parts.push(`× ${p.defaultCount} шт.`);
  return parts.join(" · ");
}
