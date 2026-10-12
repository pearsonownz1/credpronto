import { after } from "next/server";
import { json, run } from "@/lib/orders/http";
import { createV1Order, requireApiKey } from "@/lib/orders/partner";
import { processOrderInBackground } from "@/lib/orders/pipeline";

export const maxDuration = 300;

export async function POST(request: Request) {
  return run(async () => {
    const key = await requireApiKey(request);
    const created = await createV1Order(request, key);
    if (created.startTranslation) {
      after(() => processOrderInBackground(created.orderId, null));
    }
    return json(created.body, created.status);
  });
}
