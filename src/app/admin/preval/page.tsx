import { Suspense } from "react";
import { PrevalList } from "@/components/admin/preval-list";
import { listStaffPreEvaluations, PREVAL_PAGE_SIZE, prevalOffset } from "@/lib/admin/preval-queue";
import { HttpError } from "@/lib/orders/errors";

export const instant = false;

export default function PrevalPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading pre-evaluations…</p>}>
      <PrevalBody searchParams={searchParams} />
    </Suspense>
  );
}

export async function PrevalBody({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const query = await searchParams;
  const offset = prevalOffset(query.offset);
  try {
    const list = await listStaffPreEvaluations({ limit: PREVAL_PAGE_SIZE, offset });
    return <PrevalList rows={list.rows} page={{ limit: PREVAL_PAGE_SIZE, offset, total: list.total }} />;
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Could not load pre-evaluations.";
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {message}
      </p>
    );
  }
}
