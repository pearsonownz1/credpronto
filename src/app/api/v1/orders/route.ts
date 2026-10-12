import { after } from "next/server";
import { json, run } from "@/lib/orders/http";
import { createV1Order, requireApiKey } from "@/lib/orders/partner";
import { processOrder } from "@/lib/orders/pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  return run(async () => {
    const key = await requireApiKey(request);
    const created = await createV1Order(request, key);
    if (created.startTranslation) {
      after(async () => {
        try {
          await processOrder(created.orderId);
        } catch (error) {
          console.error(error instanceof Error ? error.message : "order processing failed");
        }
      });
    }
    return json(created.body, created.status);
  });
}
