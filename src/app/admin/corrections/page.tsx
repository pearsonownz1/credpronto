import { Suspense } from "react";
import { CorrectionQueue } from "@/components/admin/correction-queue";
import { correctionListFilter, listStaffCorrections } from "@/lib/admin/correction-queue";
import { HttpError } from "@/lib/orders/errors";

export const instant = false;

export default function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
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
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const filter = correctionListFilter(query.status);
  try {
    const rows = await listStaffCorrections(filter);
    return <CorrectionQueue filter={filter} rows={rows} />;
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Could not load correction requests.";
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {message}
      </p>
    );
  }
}
