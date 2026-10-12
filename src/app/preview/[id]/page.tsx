import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LivePreview } from "@/components/preview/live-preview";
import { PreviewShell } from "@/components/preview/preview-shell";
import { publicOrderExists } from "@/lib/orders/public-order-server";
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
  if (!(await publicOrderExists(id))) notFound();

  return (
    <Suspense fallback={<PreviewShell />}>
      <LivePreview />
    </Suspense>
  );
}
