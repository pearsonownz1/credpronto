import { listStaffOrders } from "@/lib/orders/admin";
import { json, run } from "@/lib/orders/http";

export async function GET(request: Request) {
  return run(async () => {
    const status = new URL(request.url).searchParams.get("status");
    return json(await listStaffOrders(status));
  });
}
