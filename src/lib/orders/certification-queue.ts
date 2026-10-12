/** Paid orders still waiting on a person. The badge turns red at this age. */
export const CERTIFICATION_LATE_MINUTES = 2;

const CLOSED = new Set(["approved", "delivered", "cancelled", "failed"]);

export type CertificationOrder = {
  id: string;
  status: string;
  createdAt: string;
  expedited?: boolean;
  paidAt?: string | null;
  fulfillment?: "released" | "awaiting_review" | null;
};

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `fulfillment` is the switch: `awaiting_review` waits, `released` does not.
 * When that field is missing, a paid or unapproved order with `paidAt` still waits.
 */
export function onCertificationQueue(order: CertificationOrder): boolean {
  if (order.fulfillment === "released") return false;
  if (order.fulfillment === "awaiting_review") return true;
  if (CLOSED.has(order.status)) return false;
  if (order.status === "paid") return true;
  return (
    instant(order.paidAt) != null &&
    (order.status === "needs_review" || order.status === "correction_requested")
  );
}

/**
 * Oldest paid_at first. Orders with no usable paid_at follow, oldest created_at first.
 * Expedited only breaks a remaining tie.
 */
export function certificationQueue<T extends CertificationOrder>(orders: T[]): T[] {
  const seen = new Set<string>();
  const waiting = orders.filter((order) => {
    if (!onCertificationQueue(order) || seen.has(order.id)) return false;
    seen.add(order.id);
    return true;
  });
  return waiting.sort((a, b) => {
    const aPaid = instant(a.paidAt);
    const bPaid = instant(b.paidAt);
    if (aPaid != null && bPaid != null && aPaid !== bPaid) return aPaid - bPaid;
    if ((aPaid != null) !== (bPaid != null)) return aPaid != null ? -1 : 1;
    const aCreated = instant(a.createdAt) ?? Number.POSITIVE_INFINITY;
    const bCreated = instant(b.createdAt) ?? Number.POSITIVE_INFINITY;
    if (aCreated !== bCreated) return aCreated - bCreated;
    if (Boolean(a.expedited) !== Boolean(b.expedited)) return a.expedited ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** Whole minutes since paid_at, or since created_at when paid_at is missing or unusable. */
export function waitingMinutes(
  order: { paidAt?: string | null; createdAt?: string | null },
  now: number,
): number | null {
  if (!Number.isFinite(now)) return null;
  const start = instant(order.paidAt) ?? instant(order.createdAt);
  if (start == null) return null;
  return Math.max(0, Math.floor((now - start) / 60_000));
}

export function waitingLabel(minutes: number): string {
  return `Waiting ${minutes} min`;
}

export function waitingIsLate(minutes: number): boolean {
  return minutes >= CERTIFICATION_LATE_MINUTES;
}
