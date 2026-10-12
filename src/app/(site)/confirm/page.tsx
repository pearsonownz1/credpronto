import type { Metadata } from "next";
import { ConfirmView } from "@/components/flow/confirm-view";

export const metadata: Metadata = {
  title: "Confirm · CredPronto",
  description: "Confirm names, dates, and place of birth before the free preview.",
};

export default function ConfirmPage() {
  return <ConfirmView />;
}
