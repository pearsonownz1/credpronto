import { insertEvent, getOrderByHash, updateOrder } from "@/lib/orders/db";
import type { Db } from "@/lib/orders/storage";
import { hashOrderToken, isOrderToken } from "@/lib/orders/token";

/**
 * Tie this browser's order, including its uploads, to the account.
 * An order already claimed by someone else stays with that account.
 * The raw token is not stored on the event.
 */
export async function attachOrderToken(db: Db, userId: string, token: string | null | undefined): Promise<string | null> {
  if (!token || !isOrderToken(token)) return null;
  const order = await getOrderByHash(db, hashOrderToken(token));
  if (!order) return null;
  if (order.userId && order.userId !== userId) return null;
  if (!order.userId) {
    await updateOrder(db, order.id, { user_id: userId });
    await insertEvent(db, order.id, "account_linked", { userId });
  }
  return order.id;
}
