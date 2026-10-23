import { staffNeedsReviewBanner } from "@/lib/orders/review-reason";

/** Yellow staff banner. Delivered orders stay quiet even if review_reason is still set. */
export function NeedsReviewBanner({
  status,
  reviewReason,
  deliveryStatus,
}: {
  status: string;
  reviewReason: string | null;
  deliveryStatus?: string | null;
}) {
  const reason = staffNeedsReviewBanner({ status, reviewReason, deliveryStatus });
  if (!reason) return null;
  return (
    <p className="mt-3 rounded-[var(--cp-radius)] border border-[#f3d7a1] bg-[#fff8ee] px-3 py-2 text-sm">
      Needs review: {reason}
    </p>
  );
}
