import { setEvaluationStatus } from "@/lib/orders/evaluation-status";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    return json(await setEvaluationStatus(id, body));
  });
}
