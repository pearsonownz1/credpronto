import { uploadFixedFinal } from "@/lib/orders/final-correction";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

/** Stores a new finals-bucket object, points the current final at it, and marks the request fixed. */
export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await uploadFixedFinal(request, id));
  });
}
