import { json, run } from "@/lib/orders/http";
import { publicVerification } from "@/lib/orders/verification";

type Context = { params: Promise<{ token: string }> };

/**
 * Public verify read. The handler uses the request, so Cache Components does not
 * prerender a signed document URL. The response is also marked uncacheable.
 */
export async function GET(request: Request, context: Context) {
  return run(async () => {
    // Read the request here so this GET stays per-request under Cache Components.
    request.headers.get("x-forwarded-for");
    const { token } = await context.params;
    const response = json(await publicVerification(request, token));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
