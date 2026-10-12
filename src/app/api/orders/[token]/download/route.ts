import { json, run } from "@/lib/orders/http";
import { downloadOrderFile } from "@/lib/orders/customer";

type Context = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const file = new URL(request.url).searchParams.get("file");
    return json(await downloadOrderFile(token, file));
  });
}
