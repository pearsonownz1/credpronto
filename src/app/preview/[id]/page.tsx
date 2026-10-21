import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AccountEmailScope } from "@/components/flow/wrong-email-link";
import { LivePreview } from "@/components/preview/live-preview";
import { PreviewShell } from "@/components/preview/preview-shell";
import { getAccount } from "@/lib/account/session";
import { viewerOwnsOrder } from "@/lib/orders/owner-order";
import { paidOrderDestination } from "@/lib/orders/preview-redirect";
import { publicOrderExists } from "@/lib/orders/public-order-server";
import { isOrderId } from "@/lib/orders/token";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Preview · CredPronto",
  description: "Review your certified translation before you pay.",
  robots: ROBOTS_NOINDEX,
};

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await connection();
  const account = await getAccount();
  const visible = isOrderId(id) ? await viewerOwnsOrder(id) : await publicOrderExists(id);
  if (!visible) notFound();
  const paidPath = await paidOrderDestination(id);
  if (paidPath) redirect(paidPath);

  return (
    <AccountEmailScope email={account?.email ?? null}>
      <Suspense fallback={<PreviewShell />}>
        <LivePreview />
      </Suspense>
    </AccountEmailScope>
  );
}
