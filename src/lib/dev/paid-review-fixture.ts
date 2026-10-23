import { MOCK_ADMIN_ORDERS } from "@/lib/account/mock-data";
import type { AdminOrder } from "@/lib/api/types";

/** Preview and local builds can open the fixture. Production cannot. */
export function paidReviewFixtureEnabled(env: string | undefined = process.env.VERCEL_ENV): boolean {
  return env !== "production";
}

/** The admin mock row whose status is `needs_review`. */
export function needsReviewFixture(orders: readonly AdminOrder[] = MOCK_ADMIN_ORDERS): AdminOrder | null {
  return orders.find((order) => order.status === "needs_review") ?? null;
}
