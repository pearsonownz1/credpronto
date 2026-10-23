import { optionalUser } from "@/lib/auth/session";
import { privatePreEvalResponse } from "@/lib/pre-evaluation/http";
import { readOwnedPreEvaluationFile } from "@/lib/pre-evaluation/owned-file";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

type Context = { params: Promise<{ id: string }> };

/** Signed-in owner of this pre-evaluation. Otherwise 404. */
export async function GET(request: Request, context: Context) {
  const response = await run(async () => {
    const { id } = await context.params;
    const user = await optionalUser();
    return json(await readOwnedPreEvaluationFile(serviceDb(), id, user?.email ?? null, request));
  });
  return privatePreEvalResponse(response);
}
