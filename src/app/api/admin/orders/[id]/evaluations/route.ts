import { regeneratePaidEvaluations } from "@/lib/orders/evaluation-dispatch";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

/** Staff only. Generates missing evaluation reports for a paid order and does not charge. */
export async function POST(_request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await regeneratePaidEvaluations(id));
  });
}
