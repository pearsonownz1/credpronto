import { optionalUser } from "@/lib/auth/session";
import { getOrderById } from "./db";
import { serviceDb } from "./storage";
import { isOrderId } from "./token";

/** The signed-in owner may open /order and /preview with the order id from the dashboard. */
export async function viewerOwnsOrder(orderId: string): Promise<boolean> {
  if (!isOrderId(orderId)) return false;
  const user = await optionalUser();
  if (!user) return false;
  try {
    const order = await getOrderById(serviceDb(), orderId);
    return order?.userId === user.id;
  } catch {
    return false;
  }
}
