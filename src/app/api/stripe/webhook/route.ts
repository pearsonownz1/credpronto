import { json, run } from "@/lib/orders/http";
import { handleStripeWebhook } from "@/lib/orders/customer";

// The urgent staff reminder waits about two minutes inside waitUntil / after().
export const maxDuration = 300;

// Node.js runtime. `cacheComponents` rejects `export const runtime` and does not allow Edge.
export async function POST(request: Request) {
  return run(() => handleStripeWebhook(request).then((body) => json(body)));
}
