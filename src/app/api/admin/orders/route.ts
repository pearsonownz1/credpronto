import { parseAdminListQuery } from "@/lib/orders/admin-query";
import { listStaffOrders } from "@/lib/orders/admin";
import { json, run } from "@/lib/orders/http";

export async function GET(request: Request) {
  return run(async () => {
    const query = parseAdminListQuery(new URL(request.url).searchParams);
    return json(await listStaffOrders(query.status, { limit: query.limit, offset: query.offset }, query.reviewReason));
  });
}
