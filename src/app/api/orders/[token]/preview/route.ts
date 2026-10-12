import { json, run } from "@/lib/orders/http";
import { getPreview, previewResponseHeaders } from "@/lib/orders/preview-read";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const preview = await getPreview(token);
    const response = json(preview.body);
    for (const [name, value] of Object.entries(previewResponseHeaders(token, preview.serverTiming))) {
      response.headers.set(name, value);
    }
    return response;
  });
}
