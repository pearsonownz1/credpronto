import { listOrderFinalVersions, saveReviewedFinal } from "@/lib/orders/finals";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await listOrderFinalVersions(id));
  });
}

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await saveReviewedFinal(id, request), 201);
  });
}
