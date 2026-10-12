import { Suspense } from "react";
import type { Metadata } from "next";
import { ConfirmView } from "@/components/flow/confirm-view";
import { FlowStatus } from "@/components/flow/status";

export const metadata: Metadata = {
  title: "Confirm · CredPronto",
  description: "Confirm names, dates, and place of birth before the free preview.",
};

export default function ConfirmPage() {
  return (
    <Suspense fallback={<FlowStatus title="Loading your details…" body="" />}>
      <ConfirmView />
    </Suspense>
  );
}
