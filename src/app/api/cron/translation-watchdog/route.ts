import { json, run } from "@/lib/orders/http";
import { cronAuthorized } from "@/lib/orders/translation-watch";
import { runTranslationWatchdog } from "@/lib/orders/translation-watchdog";
import { serviceDb } from "@/lib/orders/storage";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return run(async () => json(await runTranslationWatchdog(serviceDb())));
}
