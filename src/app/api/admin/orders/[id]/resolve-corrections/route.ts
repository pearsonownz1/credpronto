import { resolveCorrections } from "@/lib/orders/admin";
import { json, run } from "@/lib/orders/http";

export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await resolveCorrections(id, await request.json()));
  });
}
