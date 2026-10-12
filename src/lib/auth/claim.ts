import { claimOrdersByCustomerEmail, insertEvent } from "@/lib/orders/db";
import type { Db } from "@/lib/orders/storage";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type ClaimCandidate = {
  id: string;
  userId: string | null;
  customerEmail: string;
};

/**
 * Unowned orders whose customer email matches a verified account email.
 * Comparison is case-insensitive. Orders already claimed stay with that user.
 */
export function claimableOrderIds(input: {
  emailVerified: boolean;
  email: string | null;
  orders: ClaimCandidate[];
}): string[] {
  if (!input.emailVerified || !input.email) return [];
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) return [];
  const ids: string[] = [];
  for (const order of input.orders) {
    if (order.userId) continue;
    if (normalizeEmail(order.customerEmail) !== email) continue;
    ids.push(order.id);
  }
  return ids;
}

export async function claimOrdersForUser(
  db: Db,
  user: { id: string; email: string | null; emailVerified: boolean },
): Promise<string[]> {
  if (!user.emailVerified || !user.email) return [];
  const email = user.email.trim();
  if (!email) return [];
  const claimed = await claimOrdersByCustomerEmail(db, user.id, email);
  for (const orderId of claimed) {
    await insertEvent(db, orderId, "account_linked", { userId: user.id });
  }
  return claimed;
}
