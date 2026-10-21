import type { Db } from "./storage";
import { TRANSLATION_TIMEOUT_REASON } from "./translation-failure";
import {
  OPEN_TRANSLATION_STATUSES,
  TRANSLATION_STALE_MS,
  applyTranslationWatch,
  type WatchOrder,
  type WatchPatch,
} from "./translation-watch";

type Row = Record<string, unknown>;

const COLUMNS = "id, status, progress, updated_at, review_reason, service, order_type, include_translation";

function mapWatchOrder(row: Row): WatchOrder {
  return {
    id: String(row.id),
    status: String(row.status),
    progress: row.progress,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    reviewReason: typeof row.review_reason === "string" ? row.review_reason : null,
    service: typeof row.service === "string" ? row.service : null,
    orderType:
      row.order_type === "evaluation" || row.order_type === "expert_letter" ? row.order_type : "translation",
    includeTranslation: row.include_translation === true,
  };
}

async function rowsOf(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<WatchOrder[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(mapWatchOrder);
}

/** Stale translation orders: still pre-preview, or `progress.step` is `translating`. */
export async function listTranslationWatchOrders(db: Db, now: number): Promise<WatchOrder[]> {
  const cutoff = new Date(now - TRANSLATION_STALE_MS).toISOString();
  const [byStatus, byStep] = await Promise.all([
    rowsOf(
      db
        .from("orders")
        .select(COLUMNS)
        .lt("updated_at", cutoff)
        .in("status", ["confirmed", "processing"])
        .limit(50),
    ),
    rowsOf(
      db
        .from("orders")
        .select(COLUMNS)
        .lt("updated_at", cutoff)
        .contains("progress", { step: "translating" })
        .in("status", [...OPEN_TRANSLATION_STATUSES])
        .limit(50),
    ),
  ]);
  const merged = new Map<string, WatchOrder>();
  for (const order of [...byStatus, ...byStep]) merged.set(order.id, order);
  return [...merged.values()];
}

async function claimWatchUpdate(db: Db, orderId: string, cutoff: string, patch: WatchPatch): Promise<boolean> {
  const update =
    patch.kind === "flag"
      ? {
          status: "needs_review",
          review_reason: TRANSLATION_TIMEOUT_REASON,
          progress: patch.progress,
        }
      : { progress: patch.progress };
  const { data, error } = await db
    .from("orders")
    .update(update)
    .eq("id", orderId)
    .lt("updated_at", cutoff)
    .in("status", [...OPEN_TRANSLATION_STATUSES])
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function runTranslationWatchdog(
  db: Db,
  now = Date.now(),
): Promise<{ retried: string[]; flagged: string[] }> {
  const orders = await listTranslationWatchOrders(db, now);
  const cutoff = new Date(now - TRANSLATION_STALE_MS).toISOString();
  return applyTranslationWatch({
    orders,
    now,
    save: (order, patch) => claimWatchUpdate(db, order.id, cutoff, patch),
    translate: async (orderId) => {
      const { translateOrder } = await import("./translation");
      await translateOrder(db, orderId, null);
    },
  });
}
