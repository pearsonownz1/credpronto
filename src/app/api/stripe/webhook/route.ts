import { json, run } from "@/lib/orders/http";
import { handleStripeWebhook } from "@/lib/orders/customer";

export async function POST(request: Request) {
  return run(() => handleStripeWebhook(request).then((body) => json(body)));
}
