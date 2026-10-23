import { privatePreEvalResponse } from "@/lib/pre-evaluation/http";
import { submitPreEvaluationEmail } from "@/lib/pre-evaluation/run";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const response = await run(async () => {
    const { id } = await context.params;
    return json(await submitPreEvaluationEmail(serviceDb(), id, request));
  });
  return privatePreEvalResponse(response);
}
