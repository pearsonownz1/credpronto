import { requireUser } from "@/lib/auth/session";
import { listApiOrders } from "@/lib/orders/api-orders";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export async function GET() {
  return run(async () => {
    const user = await requireUser();
    return json({ orders: await listApiOrders(serviceDb(), user.id) });
  });
}
