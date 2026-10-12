import { json, run } from "@/lib/orders/http";
import { getPreview } from "@/lib/orders/preview-read";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const started = performance.now();
    const { token } = await context.params;
    const body = await getPreview(token);
    const response = json(body);
    response.headers.set("Server-Timing", `preview;dur=${Math.round(performance.now() - started)}`);
    return response;
  });
}
