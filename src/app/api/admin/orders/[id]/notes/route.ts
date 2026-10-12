import { readJson } from "@/lib/auth/body";
import { json, run } from "@/lib/orders/http";
import { addOrderNote, getOrderNotes } from "@/lib/orders/notes";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await getOrderNotes(id));
  });
}

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await addOrderNote(id, await readJson(request)), 201);
  });
}
