import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OrderStudio } from "@/components/admin/order-studio";
import { getAdminNotes, getAdminOrder } from "@/lib/api/server";

export const instant = false;

export default function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading order…</p>}>
      <OrderDetail params={params} />
    </Suspense>
  );
}

async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, notes] = await Promise.all([getAdminOrder(id), getAdminNotes(id)]);
  if (!detail.ok) {
    if (detail.status === 404) notFound();
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {detail.error}
      </p>
    );
  }
  return (
    <OrderStudio
      key={detail.data.id}
      detail={detail.data}
      notes={notes.ok ? notes.data.notes : []}
      notesError={notes.ok ? null : notes.error}
    />
  );
}
