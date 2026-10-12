import { deliverEvaluationReport } from "@/lib/orders/evaluation-review";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await deliverEvaluationReport(id, request));
  });
}
