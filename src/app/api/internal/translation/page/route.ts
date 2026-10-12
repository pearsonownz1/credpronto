import { after } from "next/server";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import {
  internalTranslationAuthorized,
  parseTranslationPageRequest,
} from "@/lib/orders/translation-dispatch";
import { runTranslationPage } from "@/lib/orders/translation";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!internalTranslationAuthorized(request.headers.get("authorization"))) {
    return json({ error: "Unauthorized" }, 401);
  }
  const parsed = parseTranslationPageRequest(await request.json().catch(() => null));
  if (!parsed) return json({ error: "Expected a translation page." }, 400);
  after(async () => {
    try {
      await runTranslationPage(serviceDb(), parsed);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "page translation failed");
    }
  });
  return run(async () => json({ accepted: true }, 202));
}
