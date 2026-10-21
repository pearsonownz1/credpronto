/** Staff hours for the evaluation reminder. Weekdays only; holidays are ordinary weekdays. */
export const BUSINESS_TIME_ZONE = "America/Los_Angeles";

/** 9:00am local, inclusive. */
export const BUSINESS_OPEN_MS = 9 * 60 * 60 * 1000;

/** 5:00pm local, exclusive. Four hours that end at 5:00pm are complete. */
export const BUSINESS_CLOSE_MS = 17 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
};

/**
 * Instant `hours` of America/Los_Angeles business time after `fromMs`.
 * Business time is Mon–Fri 9:00am–5:00pm. Nights and weekends do not count.
 * A payment at 3:00pm Monday is due at 11:00am Tuesday. A payment on Saturday is due at 1:00pm Monday.
 */
export function addBusinessHours(
  fromMs: number,
  hours: number,
  timeZone: string = BUSINESS_TIME_ZONE,
): number {
  const total = hours * 60 * 60 * 1000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(total) || total <= 0) return fromMs;

  let remaining = total;
  let cursor = fromMs;
  for (let guard = 0; guard < 40 && remaining > 0; guard += 1) {
    const wall = wallFromUtc(cursor, timeZone);
    const elapsed = msOfDay(wall);
    if (!isBusinessDay(wall) || elapsed >= BUSINESS_CLOSE_MS) {
      cursor = openOn(nextBusinessDay(wall, timeZone), timeZone);
      continue;
    }
    if (elapsed < BUSINESS_OPEN_MS) {
      cursor = openOn(wall, timeZone);
      continue;
    }
    const available = BUSINESS_CLOSE_MS - elapsed;
    const take = Math.min(remaining, available);
    cursor += take;
    remaining -= take;
  }
  return cursor;
}

function isBusinessDay(wall: Wall): boolean {
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function msOfDay(wall: Wall): number {
  return ((wall.hour * 60 + wall.minute) * 60 + wall.second) * 1000 + wall.ms;
}

function openOn(wall: Wall, timeZone: string): number {
  return wallToUtc({ ...wall, hour: 9, minute: 0, second: 0, ms: 0 }, timeZone);
}

function nextBusinessDay(wall: Wall, timeZone: string): Wall {
  let current = wall;
  for (let guard = 0; guard < 8; guard += 1) {
    current = addCalendarDay(current, timeZone);
    if (isBusinessDay(current)) return current;
  }
  return current;
}

function addCalendarDay(wall: Wall, timeZone: string): Wall {
  const noon = wallToUtc({ ...wall, hour: 12, minute: 0, second: 0, ms: 0 }, timeZone);
  return wallFromUtc(noon + DAY_MS, timeZone);
}

function wallFromUtc(utcMs: number, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(value("hour"));
  if (hour === 24) hour = 0;
  const ms = ((utcMs % 1000) + 1000) % 1000;
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour,
    minute: Number(value("minute")),
    second: Number(value("second")),
    ms,
  };
}

function wallToUtc(wall: Wall, timeZone: string): number {
  const wanted = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.ms);
  let utc = wanted;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const got = wallFromUtc(utc, timeZone);
    const shown = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second, got.ms);
    const delta = wanted - shown;
    if (delta === 0) return utc;
    utc += delta;
  }
  return utc;
}
