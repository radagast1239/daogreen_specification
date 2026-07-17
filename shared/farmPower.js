function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function normalizeFarmPower(raw = {}) {
  const devices = (Array.isArray(raw?.devices) ? raw.devices : [])
    .map((device, index) => {
      const source = String(device?.source || "manual");
      const powerKw = numberOrZero(device?.powerKw ?? device?.normalKw);
      const quantity = numberOrZero(device?.quantity ?? 1);
      const hoursPerDay = numberOrZero(device?.hoursPerDay);
      const peakPowerKw = numberOrZero(device?.peakPowerKw ?? device?.peakKw ?? powerKw);
      const calculated = source === "manual" && (device?.powerKw != null || device?.hoursPerDay != null);
      return ({
      id: String(device?.id || `device_${index + 1}`),
      name: String(device?.name || "").trim(),
      normalKw: calculated ? powerKw * quantity : numberOrZero(device?.normalKw),
      peakKw: calculated ? peakPowerKw * quantity : numberOrZero(device?.peakKw),
      dailyKwh: calculated ? powerKw * quantity * hoursPerDay : numberOrZero(device?.dailyKwh),
      source,
      roomId: String(device?.roomId || ""),
      details: String(device?.details || ""),
      powerKw,
      quantity,
      hoursPerDay,
      peakPowerKw,
    });
    });
  const acSchedules = (Array.isArray(raw?.acSchedules) ? raw.acSchedules : []).map((schedule, index) => ({
    roomId: String(schedule?.roomId || `room_${index + 1}`),
    dayKw: numberOrZero(schedule?.dayKw),
    dayHours: numberOrZero(schedule?.dayHours),
    nightKw: numberOrZero(schedule?.nightKw),
    nightHours: numberOrZero(schedule?.nightHours),
  }));
  return {
    devices,
    acSchedules,
    tariffPerKwh: numberOrZero(raw?.tariffPerKwh),
    daysPerMonth: Math.max(1, numberOrZero(raw?.daysPerMonth) || 30),
  };
}

export function farmPowerTotals(raw = {}) {
  const model = normalizeFarmPower(raw);
  const totals = model.devices.reduce(
    (total, device) => ({
      normalKw: Math.round((total.normalKw + device.normalKw) * 1000) / 1000,
      peakKw: Math.round((total.peakKw + device.peakKw) * 1000) / 1000,
      dailyKwh: Math.round((total.dailyKwh + device.dailyKwh) * 1000) / 1000,
    }),
    { normalKw: 0, peakKw: 0, dailyKwh: 0 },
  );
  totals.monthlyKwh = round3(totals.dailyKwh * model.daysPerMonth);
  totals.monthlyCost = round3(totals.monthlyKwh * model.tariffPerKwh);
  return totals;
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
    const units = Array.isArray(room?.acUnits) ? room.acUnits : [];
    const calculatedDayKw = numberOrZero(room?.cooling?.electricalKw);
    const hasUnitPower = calculatedDayKw > 0 || units.some((unit) => numberOrZero(unit?.dayElectricKw ?? unit?.electricKw) > 0 || numberOrZero(unit?.nightElectricKw) > 0);
    const schedule = schedules.get(String(room.id || ""));
    const dayKw = hasUnitPower
      ? calculatedDayKw || units.reduce((sum, unit) => sum + numberOrZero(unit?.qty || 1) * numberOrZero(unit?.dayElectricKw ?? unit?.electricKw), 0)
      : numberOrZero(schedule?.dayKw);
    const nightKw = hasUnitPower
      ? units.reduce((sum, unit) => sum + numberOrZero(unit?.qty || 1) * numberOrZero(unit?.nightElectricKw), 0)
      : numberOrZero(schedule?.nightKw);
    const dayHours = Math.min(24, numberOrZero(room?.cooling?.params?.dayHours ?? units[0]?.dayHours ?? 16));
    const nightHours = Math.max(0, 24 - dayHours);
    const dailyKwh = hasUnitPower
      ? dayKw * dayHours + nightKw * nightHours
      : dayKw * numberOrZero(schedule?.dayHours) + nightKw * numberOrZero(schedule?.nightHours);
    if (dayKw > 0 || nightKw > 0) {
      rows.push({
        id: `auto_ac_${room.id}`,
        name: `Кондиционер — ${room.name || "Комната"}`,
        normalKw: round3(dailyKwh / 24),
        peakKw: round3(Math.max(dayKw, nightKw)),
        dailyKwh: round3(dailyKwh),
        source: "ac_schedule",
        roomId: String(room.id || ""),
        details: hasUnitPower ? `день ${dayKw} кВт × ${dayHours} ч; ночь ${nightKw} кВт × ${nightHours} ч` : `день ${dayKw} кВт × ${schedule?.dayHours || 0} ч; ночь ${nightKw} кВт × ${schedule?.nightHours || 0} ч`,
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
    tariffPerKwh: model.tariffPerKwh,
    daysPerMonth: model.daysPerMonth,
  });
}
