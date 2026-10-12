import { after } from "next/server";
import { addCorrection, getOrder } from "@/lib/orders/customer";
import { json, run } from "@/lib/orders/http";
import { processOrderInBackground } from "@/lib/orders/pipeline";

export const maxDuration = 300;

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const correction = await addCorrection(token, await request.json());
    const order = await getOrder(token);
    after(() => processOrderInBackground(order.orderId, token));
    return json(correction);
  });
}
