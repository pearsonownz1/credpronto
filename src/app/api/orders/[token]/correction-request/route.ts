import { submitFinalCorrection } from "@/lib/orders/final-correction";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ token: string }> };

/** One correction request for the customer's own order. A second request is rejected. */
export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const body = await request.json().catch(() => null);
    return json(await submitFinalCorrection(token, body), 201);
  });
}
