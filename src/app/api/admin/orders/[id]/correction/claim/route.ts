import { claimFinalCorrectionJob } from "@/lib/orders/final-correction";
import { json, run } from "@/lib/orders/http";

type Context = { params: Promise<{ id: string }> };

/** open -> in_progress. A second caller gets 409. */
export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await claimFinalCorrectionJob(request, id));
  });
}
