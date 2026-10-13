/** A stored timestamp, or null when it is missing or not a real instant. */
export function storedTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** Earliest upload time. The order's created time is used only when no upload time is stored. */
export function uploadOrCreatedAt(
  documents: Array<{ createdAt?: string | null }>,
  createdAt: string | null | undefined,
): string | null {
  let earliest: { value: string; time: number } | null = null;
  for (const document of documents) {
    const value = storedTimestamp(document.createdAt);
    if (!value) continue;
    const time = Date.parse(value);
    if (!earliest || time < earliest.time) earliest = { value, time };
  }
  return earliest?.value ?? storedTimestamp(createdAt);
}

function elapsedMs(start: string | null | undefined, end: string | null | undefined): number | null {
  const from = storedTimestamp(start);
  const to = storedTimestamp(end);
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms;
}

function minuteLabel(minutes: number): string {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** Seconds with one decimal under 60s. Longer durations round to whole minutes. */
export function translationSpeedLine(
  startedAt: string | null | undefined,
  readyAt: string | null | undefined,
): string | null {
  const ms = elapsedMs(startedAt, readyAt);
  if (ms == null) return null;
  const seconds = ms / 1000;
  const tenths = Math.round(seconds * 10) / 10;
  if (tenths < 60) {
    const shown = tenths.toFixed(1);
    return `Translated in ${shown} ${shown === "1.0" ? "second" : "seconds"}`;
  }
  return `Translated in ${minuteLabel(Math.round(seconds / 60))}`;
}

/** Whole minutes from payment to delivery. */
export function evaluationSpeedLine(
  paidAt: string | null | undefined,
  deliveredAt: string | null | undefined,
): string | null {
  const ms = elapsedMs(paidAt, deliveredAt);
  if (ms == null) return null;
  return `Evaluated in ${minuteLabel(Math.round(ms / 60_000))}`;
}
