import { readFinalCorrection } from "@/lib/orders/final-correction";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await readFinalCorrection(id));
  });
}
