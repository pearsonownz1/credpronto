import type { Metadata } from "next";
import { QuoteView } from "@/components/flow/quote-view";

export const metadata: Metadata = {
  title: "Quote · CredPronto",
  description: "Exact price at $9.95 a page. The preview is free.",
};

export default function QuotePage() {
  return <QuoteView />;
}
