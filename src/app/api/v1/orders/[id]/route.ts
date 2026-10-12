import { json, run } from "@/lib/orders/http";
import { partnerOrder, requireApiKey } from "@/lib/orders/partner";
import { serviceDb } from "@/lib/orders/storage";
import { retryDueWebhooks } from "@/lib/orders/webhook-delivery";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return run(async () => {
    const key = await requireApiKey(request);
    const { id } = await context.params;
    try {
      await retryDueWebhooks(serviceDb());
    } catch (error) {
      console.error(error instanceof Error ? error.message : "webhook retry failed");
    }
    return json(await partnerOrder(key.userId, id, true));
  });
}
