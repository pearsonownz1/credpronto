import { json, run } from "@/lib/orders/http";
import { handleStripeWebhook } from "@/lib/orders/customer";

// Node.js runtime. `cacheComponents` rejects `export const runtime` and does not allow Edge.
export async function POST(request: Request) {
  return run(() => handleStripeWebhook(request).then((body) => json(body)));
}
