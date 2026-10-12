import { after } from "next/server";
import { replaceOrderDocument } from "@/lib/orders/customer";
import { json, run } from "@/lib/orders/http";
import { processOrderInBackground } from "@/lib/orders/pipeline";

export const maxDuration = 300;

type Context = { params: Promise<{ token: string; documentId: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { token, documentId } = await context.params;
    const order = await replaceOrderDocument(token, documentId, request);
    after(() => processOrderInBackground(order.orderId, token));
    return json(order);
  });
}
