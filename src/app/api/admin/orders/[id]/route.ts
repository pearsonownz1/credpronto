import { readJson } from "@/lib/auth/body";
import { staffOrder } from "@/lib/orders/admin";
import { json, run } from "@/lib/orders/http";
import { editOrderTranslation } from "@/lib/orders/revise";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await staffOrder(id));
  });
}

export async function PATCH(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await editOrderTranslation(id, await readJson(request)));
  });
}
