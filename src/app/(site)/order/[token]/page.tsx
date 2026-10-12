import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { OrderHub } from "@/components/flow/order-hub";
import { OrderLoadingFallback } from "@/components/flow/reading-handoff";
import { publicOrderExists } from "@/lib/orders/public-order-server";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Order · CredPronto",
  description: "Your translation order, from quote through download.",
  robots: ROBOTS_NOINDEX,
};

export default async function OrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  await connection();
  if (!(await publicOrderExists(token))) notFound();

  return (
    <Suspense fallback={<OrderLoadingFallback />}>
      <OrderHub />
    </Suspense>
  );
}
