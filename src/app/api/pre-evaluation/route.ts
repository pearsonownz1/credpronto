import { privatePreEvalResponse } from "@/lib/pre-evaluation/http";
import { startPreEvaluation } from "@/lib/pre-evaluation/run";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export const maxDuration = 300;

export async function POST(request: Request) {
  const response = await run(async () => json(await startPreEvaluation(serviceDb(), request)));
  return privatePreEvalResponse(response);
}
