import { Suspense } from "react";
import type { Metadata } from "next";
import { OrderHub } from "@/components/flow/order-hub";
import { FlowStatus } from "@/components/flow/status";

export const metadata: Metadata = {
  title: "Order · CredPronto",
  description: "Your translation order, from quote through download.",
};

export default function OrderPage() {
  return (
    <Suspense fallback={<FlowStatus title="Loading your order…" body="" />}>
      <OrderHub />
    </Suspense>
  );
}
