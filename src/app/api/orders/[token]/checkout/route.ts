import { json, run } from "@/lib/orders/http";
import { startCheckout } from "@/lib/orders/customer";

// The urgent staff reminder waits about two minutes inside waitUntil / after().
export const maxDuration = 300;

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const body = await request.json().catch(() => ({}));
    return json(await startCheckout(token, body));
  });
}
