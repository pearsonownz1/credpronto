import type { Metadata } from "next";
import { QuoteView } from "@/components/flow/quote-view";
import { getAccount } from "@/lib/account/session";

export const instant = false;

export const metadata: Metadata = {
  title: "Quote · CredPronto",
  description: "Exact price at $9.95 a page. The preview is free.",
};

export default async function QuotePage() {
  const account = await getAccount();
  return <QuoteView signedIn={account != null} />;
}
