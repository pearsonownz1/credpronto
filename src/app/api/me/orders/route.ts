import { requireUser } from "@/lib/auth/session";
import { listMyOrders } from "@/lib/orders/account";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export async function GET() {
  return run(async () => {
    const user = await requireUser();
    return json(await listMyOrders(serviceDb(), user));
  });
}
