import { requireUser } from "@/lib/auth/session";
import { getOrderById, requireOrderByHash } from "./db";
import { HttpError } from "./errors";
import { serviceDb } from "./storage";
import { assertOrderTokenShape, hashOrderToken, isOrderId } from "./token";

/** Email-link token, or the order id when the signed-in owner opens it from the dashboard. */
export async function orderForToken(token: string) {
  const db = serviceDb();
  if (isOrderId(token)) {
    const user = await requireUser();
    const owned = await getOrderById(db, token);
    if (!owned || owned.userId !== user.id) throw new HttpError("Order not found", 404);
    return { db, order: owned, token };
  }
  assertOrderTokenShape(token);
  const order = await requireOrderByHash(db, hashOrderToken(token));
  return { db, order, token };
}
