import type { StaffDetail, StaffNote } from "@/lib/api/types";

export type ActivityItem = {
  id: string;
  at: string;
  label: string;
};

/** The detail payload has no order_events array. This log is derived from the fields it does return. */
export function activityFor(detail: StaffDetail, notes: StaffNote[]): ActivityItem[] {
  const items: ActivityItem[] = [{ id: `${detail.id}-placed`, at: detail.createdAt, label: "Order placed" }];
  if (detail.payment?.paidAt) {
    items.push({ id: `${detail.id}-paid`, at: detail.payment.paidAt, label: "Payment received" });
  }
  if (detail.delivery?.approvedAt) {
    items.push({ id: `${detail.id}-approved`, at: detail.delivery.approvedAt, label: "Certified files approved" });
  }
  if (detail.delivery?.deliveredAt) {
    items.push({ id: `${detail.id}-delivered`, at: detail.delivery.deliveredAt, label: "Certified files released" });
  }
  for (const correction of detail.corrections) {
    items.push({
      id: correction.id,
      at: correction.createdAt,
      label: "Customer asked for a correction",
    });
  }
  for (const note of notes) {
    items.push({ id: note.id, at: note.createdAt, label: "Internal note" });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
