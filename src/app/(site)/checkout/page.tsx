import { Suspense } from "react";
import type { Metadata } from "next";
import { signedInEmail } from "@/lib/auth/session";
import { CheckoutView } from "@/components/flow/checkout-view";
import { FlowStatus } from "@/components/flow/status";

export const metadata: Metadata = {
  title: "Checkout · CredPronto",
  description: "Pay for the certified translation you already reviewed.",
};

export default function CheckoutPage() {
  return (
    <Suspense fallback={<FlowStatus title="Loading checkout…" body="" />}>
      <CheckoutGate />
    </Suspense>
  );
}

async function CheckoutGate() {
  const accountEmail = await signedInEmail();
  return <CheckoutView accountEmail={accountEmail} />;
}
