function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function normalizeFarmPower(raw = {}) {
  const devices = (Array.isArray(raw?.devices) ? raw.devices : [])
    .map((device, index) => ({
      id: String(device?.id || `device_${index + 1}`),
      name: String(device?.name || "").trim(),
      normalKw: numberOrZero(device?.normalKw),
      peakKw: numberOrZero(device?.peakKw),
    }));
  return { devices };
}

export function farmPowerTotals(raw = {}) {
  const { devices } = normalizeFarmPower(raw);
  return devices.reduce(
    (total, device) => ({
      normalKw: Math.round((total.normalKw + device.normalKw) * 1000) / 1000,
      peakKw: Math.round((total.peakKw + device.peakKw) * 1000) / 1000,
    }),
    { normalKw: 0, peakKw: 0 },
  );
}

export function farmPowerFingerprint(raw = {}) {
  return JSON.stringify(normalizeFarmPower(raw));
}
