import { after } from "next/server";
import { createOrder } from "@/lib/orders/create";
import { json, run } from "@/lib/orders/http";
import { processOrderInBackground } from "@/lib/orders/pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  return run(async () => {
    const created = await createOrder(request);
    after(async () => {
      await processOrderInBackground(created.orderId, created.orderToken);
    });
    return json({ orderToken: created.orderToken, orderId: created.orderId });
  });
}
