import { listFinalCorrectionJobs } from "@/lib/orders/final-correction";
import { json, run } from "@/lib/orders/http";

/** Staff session or service bearer. Lists correction jobs for the sweep. */
export async function GET(request: Request) {
  return run(async () => {
    const status = new URL(request.url).searchParams.get("status");
    return json(await listFinalCorrectionJobs(request, status));
  });
}
