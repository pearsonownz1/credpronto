import { parseAdminListQuery } from "@/lib/orders/admin-query";
import { listStaffOrders } from "@/lib/orders/admin";
import { listEvaluationReviewQueue } from "@/lib/orders/evaluation-review";
import { json, run } from "@/lib/orders/http";

export async function GET(request: Request) {
  return run(async () => {
    const query = parseAdminListQuery(new URL(request.url).searchParams);
    if (query.queue === "evaluation") {
      return json(await listEvaluationReviewQueue({ limit: query.limit, offset: query.offset }));
    }
    return json(await listStaffOrders(query.status, { limit: query.limit, offset: query.offset }, query.reviewReason));
  });
}
