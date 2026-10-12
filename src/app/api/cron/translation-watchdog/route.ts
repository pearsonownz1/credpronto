import { json, run } from "@/lib/orders/http";
import { runStaffAlertBackstop } from "@/lib/orders/paid-release";
import { cronAuthorized } from "@/lib/orders/translation-watch";
import { runTranslationWatchdog } from "@/lib/orders/translation-watchdog";
import { serviceDb } from "@/lib/orders/storage";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return run(async () => {
    const db = serviceDb();
    const watch = await runTranslationWatchdog(db);
    const staffAlerts = await runStaffAlertBackstop(db);
    return json({ ...watch, staffAlerts });
  });
}
