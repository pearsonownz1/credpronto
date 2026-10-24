import {
  ensurePendingDelivery,
  hasEvent,
  insertEvent,
  markOrderPaidAt,
  updateDelivery,
  updateOrder,
  type Db,
} from "./db";
import { gcsFreePricePatch } from "./gcs";
import type { OrderProgress } from "./reading-progress";

/** After the quote is saved, a GCS order skips the paywall and keeps translating. */
export async function confirmFreeGcsQuote(
  db: Db,
  orderId: string,
  input: { sourceLanguage: string | null; quoted: boolean; pagesRead: number; pagesTotal: number },
): Promise<void> {
  const patch: Record<string, unknown> = { ...gcsFreePricePatch() };
  if (input.quoted && input.sourceLanguage) {
    patch.source_language = input.sourceLanguage;
    patch.language_confirmed = true;
    patch.status = "confirmed";
    patch.progress = {
      step: "translating",
      pagesRead: input.pagesRead,
      pagesTotal: input.pagesTotal,
      retries: 0,
    } satisfies OrderProgress;
  }
  await updateOrder(db, orderId, patch);
}

/**
 * The certified file is already stored. Release it without a Stripe payment
 * so the download endpoint can sign the unwatermarked PDF.
 */
export async function releaseFreeGcsOrder(
  db: Db,
  orderId: string,
  paths: { finalPath: string; certificationPath: string },
  progress?: OrderProgress,
): Promise<void> {
  const now = new Date().toISOString();
  await ensurePendingDelivery(db, orderId);
  await updateDelivery(db, orderId, {
    status: "delivered",
    approved_by: null,
    approved_at: now,
    delivered_at: now,
    final_path: paths.finalPath,
    certification_path: paths.certificationPath,
  });
  await markOrderPaidAt(db, orderId, now);
  await updateOrder(db, orderId, {
    status: "delivered",
    ...gcsFreePricePatch(),
    final_translation_path: paths.finalPath,
    certification_path: paths.certificationPath,
    review_reason: null,
    ...(progress ? { progress } : {}),
  });
  if (!(await hasEvent(db, orderId, "approved"))) {
    await insertEvent(db, orderId, "approved", { auto: true, brand: "gcs" });
  }
}
