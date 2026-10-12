import { json, run } from "@/lib/orders/http";
import { getOrder, patchOrderQuote } from "@/lib/orders/customer";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    return json(await getOrder(token));
  });
}

export async function PATCH(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const body = await request.json().catch(() => null);
    return json(await patchOrderQuote(token, body));
  });
}
