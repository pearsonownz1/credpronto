import { after } from "next/server";
import { createOrder } from "@/lib/orders/create";
import { sendOrderReceived } from "@/lib/orders/email";
import { json, run } from "@/lib/orders/http";
import { processOrderInBackground } from "@/lib/orders/pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  return run(async () => {
    const created = await createOrder(request);
    after(async () => {
      try {
        await sendOrderReceived(created.email, {
          token: created.orderToken,
          customerName: null,
          orderId: created.orderId,
          sourceLanguage: created.sourceLanguage,
          targetLanguage: created.targetLanguage,
          documentCount: created.documentCount,
          pageCount: null,
          estimatedCents: created.estimatedCents,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : "order email failed");
      }
      await processOrderInBackground(created.orderId, created.orderToken);
    });
    return json({ orderToken: created.orderToken, orderId: created.orderId });
  });
}
