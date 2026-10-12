import { json, run } from "@/lib/orders/http";
import { handleStripeWebhook } from "@/lib/orders/customer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return run(() => handleStripeWebhook(request).then((body) => json(body)));
}
