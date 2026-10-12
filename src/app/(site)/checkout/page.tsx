import type { Metadata } from "next";
import { CheckoutView } from "@/components/flow/checkout-view";

export const metadata: Metadata = {
  title: "Checkout · CredPronto",
  description: "Pay for the certified translation you already reviewed.",
};

export default function CheckoutPage() {
  return <CheckoutView />;
}
