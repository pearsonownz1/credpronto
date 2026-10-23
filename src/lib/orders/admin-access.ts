import { cronAuthorized } from "./translation-watch";
import { requireStaff } from "./staff";
import { serviceDb, type Db } from "./storage";

/**
 * Staff session (the same check as the other /api/admin order routes) or the
 * service bearer used by cron and internal workers. A missing or wrong bearer
 * falls through to the staff session and does not authenticate by itself.
 */
export async function requireStaffOrService(request: Request): Promise<{ db: Db; actor: "staff" | "service" }> {
  if (cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return { db: serviceDb(), actor: "service" };
  }
  const staff = await requireStaff();
  return { db: staff.db, actor: "staff" };
}
