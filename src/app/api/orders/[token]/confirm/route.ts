import { after } from "next/server";
import { confirmOrder } from "@/lib/orders/customer";
import { json, run } from "@/lib/orders/http";
import { processOrderInBackground } from "@/lib/orders/pipeline";

export const maxDuration = 300;

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const order = await confirmOrder(token, await request.json());
    after(() => processOrderInBackground(order.orderId, token));
    return json(order);
  });
}
