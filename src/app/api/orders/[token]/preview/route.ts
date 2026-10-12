import { json, run } from "@/lib/orders/http";
import { getPreview } from "@/lib/orders/customer";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    return json(await getPreview(token));
  });
}
