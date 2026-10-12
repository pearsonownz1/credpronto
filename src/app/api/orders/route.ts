import { after } from "next/server";
import { createOrder } from "@/lib/orders/create";
import { sendOrderReceived } from "@/lib/orders/email";
import { json, run } from "@/lib/orders/http";
import { processOrder } from "@/lib/orders/pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  return run(async () => {
    const created = await createOrder(request);
    after(async () => {
      try {
        await sendOrderReceived(created.email, created.orderToken);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "order email failed");
      }
      try {
        await processOrder(created.orderId);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "order processing failed");
      }
    });
    return json({ orderToken: created.orderToken, orderId: created.orderId });
  });
}
