import type { Metadata } from "next";
import { CheckoutView } from "@/components/flow/checkout-view";
import { getAccount } from "@/lib/account/session";

export const instant = false;

export const metadata: Metadata = {
  title: "Checkout · CredPronto",
  description: "Pay for the certified translation you already reviewed.",
};

export default async function CheckoutPage() {
  const account = await getAccount();
  return <CheckoutView signedIn={account != null} accountEmail={account?.email ?? null} />;
}
