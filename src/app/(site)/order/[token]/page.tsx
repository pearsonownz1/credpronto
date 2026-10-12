import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { OrderHub } from "@/components/flow/order-hub";
import { OrderLoadingFallback } from "@/components/flow/reading-handoff";
import { waitsForCheckoutOrder } from "@/lib/orders/checkout-return";
import { publicOrderExists } from "@/lib/orders/public-order-server";
import { isOrderToken } from "@/lib/orders/token";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Order · CredPronto",
  description: "Your translation order, from quote through download.",
  robots: ROBOTS_NOINDEX,
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  await connection();
  const checkout = Array.isArray(query.checkout) ? query.checkout[0] : query.checkout;
  // Success and cancel links keep the page up while the webhook lands.
  if (!isOrderToken(token) || (!waitsForCheckoutOrder(checkout) && !(await publicOrderExists(token)))) {
    notFound();
  }

  return (
    <Suspense fallback={<OrderLoadingFallback />}>
      <OrderHub />
    </Suspense>
  );
}
