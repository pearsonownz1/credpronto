import { Suspense } from "react";
import { CorrectionQueue } from "@/components/admin/correction-queue";
import { CORRECTION_PAGE_SIZE, correctionListFilter, correctionOffset, listStaffCorrections } from "@/lib/admin/correction-queue";
import { HttpError } from "@/lib/orders/errors";

export const instant = false;

export default function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading corrections…</p>}>
      <CorrectionsBody searchParams={searchParams} />
    </Suspense>
  );
}

export async function CorrectionsBody({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string }>;
}) {
  const query = await searchParams;
  const filter = correctionListFilter(query.status);
  const offset = correctionOffset(query.offset);
  try {
    const list = await listStaffCorrections(filter, { limit: CORRECTION_PAGE_SIZE, offset });
    return (
      <CorrectionQueue filter={filter} rows={list.rows} page={{ limit: CORRECTION_PAGE_SIZE, offset, total: list.total }} />
    );
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Could not load correction requests.";
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {message}
      </p>
    );
  }
}
