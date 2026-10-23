import { readNotarization, updateNotarization } from "@/lib/orders/admin-fulfillment";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await readNotarization(id));
  });
}

export async function PATCH(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    return json(await updateNotarization(id, body));
  });
}
