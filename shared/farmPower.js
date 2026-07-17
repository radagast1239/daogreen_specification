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
      dailyKwh: numberOrZero(device?.dailyKwh),
      source: String(device?.source || "manual"),
      roomId: String(device?.roomId || ""),
      details: String(device?.details || ""),
    }));
  const acSchedules = (Array.isArray(raw?.acSchedules) ? raw.acSchedules : []).map((schedule, index) => ({
    roomId: String(schedule?.roomId || `room_${index + 1}`),
    dayKw: numberOrZero(schedule?.dayKw),
    dayHours: numberOrZero(schedule?.dayHours),
    nightKw: numberOrZero(schedule?.nightKw),
    nightHours: numberOrZero(schedule?.nightHours),
  }));
  return { devices, acSchedules };
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

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/** Automatic electrical rows. Cooling capacity is never used as electrical kW. */
export function automaticFarmPowerDevices(raw = {}, rooms = []) {
  const model = normalizeFarmPower(raw);
  const schedules = new Map(model.acSchedules.map((schedule) => [schedule.roomId, schedule]));
  const rows = [];
  for (const room of Array.isArray(rooms) ? rooms : []) {
    const params = room?.cooling?.params || {};
    const lampKw = numberOrZero(params.shelves) * numberOrZero(params.tiers) * numberOrZero(params.lampW) / 1000;
    const lightHours = Math.min(24, numberOrZero(params.lightHours));
    if (lampKw > 0) {
      rows.push({
        id: `auto_light_${room.id}`,
        name: `Освещение — ${room.name || "Комната"}`,
        normalKw: round3(lampKw),
        peakKw: round3(lampKw),
        dailyKwh: round3(lampKw * lightHours),
        source: "cooling_lighting",
        roomId: String(room.id || ""),
        details: `${lightHours} ч/сут`,
      });
    }
    const schedule = schedules.get(String(room.id || ""));
    if (schedule && (schedule.dayKw > 0 || schedule.nightKw > 0)) {
      const dailyKwh = schedule.dayKw * schedule.dayHours + schedule.nightKw * schedule.nightHours;
      rows.push({
        id: `auto_ac_${room.id}`,
        name: `Кондиционер — ${room.name || "Комната"}`,
        normalKw: round3(dailyKwh / 24),
        peakKw: round3(Math.max(schedule.dayKw, schedule.nightKw)),
        dailyKwh: round3(dailyKwh),
        source: "ac_schedule",
        roomId: String(room.id || ""),
        details: `день ${schedule.dayKw} кВт × ${schedule.dayHours} ч; ночь ${schedule.nightKw} кВт × ${schedule.nightHours} ч`,
      });
    }
  }
  return rows;
}

export function buildFarmPowerSnapshot(raw = {}, rooms = []) {
  const model = normalizeFarmPower(raw);
  return normalizeFarmPower({
    devices: [...model.devices.filter((device) => device.source === "manual"), ...automaticFarmPowerDevices(model, rooms)],
    acSchedules: model.acSchedules,
  });
}
