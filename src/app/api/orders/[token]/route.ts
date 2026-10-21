import { json, run } from "@/lib/orders/http";
import { getOrder, patchOrderQuote } from "@/lib/orders/customer";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  const response = await run(async () => {
    const started = performance.now();
    const { token } = await context.params;
    const body = await getOrder(token);
    const response = json(body);
    response.headers.set("Server-Timing", `order;dur=${Math.round(performance.now() - started)}`);
    return response;
  });
  // The quote screen polls this URL. A stored GET kept the first reading snapshot.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function PATCH(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const body = await request.json().catch(() => null);
    return json(await patchOrderQuote(token, body));
  });
}
