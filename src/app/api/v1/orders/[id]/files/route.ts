import { json, run } from "@/lib/orders/http";
import { partnerFiles, requireApiKey } from "@/lib/orders/partner";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return run(async () => {
    const key = await requireApiKey(request);
    const { id } = await context.params;
    return json(await partnerFiles(key.userId, id));
  });
}
