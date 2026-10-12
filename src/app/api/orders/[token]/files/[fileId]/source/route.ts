import { getSourceFile } from "@/lib/orders/customer";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ token: string; fileId: string }> };

export async function GET(_request: Request, context: Context) {
  const response = await run(async () => {
    const { token, fileId } = await context.params;
    return json(await getSourceFile(token, fileId));
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
