import { json, run } from "@/lib/orders/http";
import { getOrder } from "@/lib/orders/customer";
import { processOrder } from "@/lib/orders/pipeline";

export const maxDuration = 300;

type Context = { params: Promise<{ token: string }> };

export async function POST(_request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const order = await getOrder(token);
    await processOrder(order.orderId, token);
    return json(await getOrder(token));
  });
}
