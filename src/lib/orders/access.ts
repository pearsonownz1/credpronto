const SETTLED = new Set(["paid", "paid_test"]);
const RELEASED = new Set(["approved", "delivered"]);

export function isSettledPayment(status: string | null | undefined): boolean {
  return status != null && SETTLED.has(status);
}

export type DownloadDecision =
  | { ok: true }
  | { ok: false; status: 402 | 403; error: string };

/**
 * Clean files are released only after payment has settled and a staff member
 * has approved the certification (or the delivery email has already gone out).
 */
export function downloadGate(input: {
  paymentStatus: string | null;
  deliveryStatus: string | null;
}): DownloadDecision {
  if (!isSettledPayment(input.paymentStatus)) {
    return { ok: false, status: 402, error: "Payment required" };
  }

  if (!input.deliveryStatus || !RELEASED.has(input.deliveryStatus)) {
    return { ok: false, status: 403, error: "Certification is not approved" };
  }

  return { ok: true };
}
