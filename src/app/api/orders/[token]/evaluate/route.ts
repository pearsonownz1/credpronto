import { evaluateGcsOrder } from "@/lib/orders/gcs-evaluate";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ token: string }> };

export async function POST(_request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    return json(await evaluateGcsOrder(token));
  });
}
