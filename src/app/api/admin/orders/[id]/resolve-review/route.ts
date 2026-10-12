import { resolveReview } from "@/lib/orders/admin";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await resolveReview(id, await request.json().catch(() => ({}))));
  });
}
