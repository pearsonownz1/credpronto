import { after } from "next/server";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import {
  internalTranslationAuthorized,
  parseTranslationAssembleRequest,
} from "@/lib/orders/translation-dispatch";
import { runTranslationAssemble } from "@/lib/orders/translation";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!internalTranslationAuthorized(request.headers.get("authorization"))) {
    return json({ error: "Unauthorized" }, 401);
  }
  const parsed = parseTranslationAssembleRequest(await request.json().catch(() => null));
  if (!parsed) return json({ error: "Expected a translation assemble." }, 400);
  after(async () => {
    try {
      await runTranslationAssemble(serviceDb(), parsed);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "translation assemble failed");
    }
  });
  return run(async () => json({ accepted: true }, 202));
}
