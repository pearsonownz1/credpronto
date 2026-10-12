import type { Metadata } from "next";
import { ProcessingView } from "@/components/flow/processing-view";

export const metadata: Metadata = {
  title: "Preview · CredPronto",
  description: "Your certified translation preview is being prepared.",
};

export default function ProcessingPage() {
  return <ProcessingView />;
}
