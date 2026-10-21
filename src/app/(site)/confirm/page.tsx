import { Suspense } from "react";
import type { Metadata } from "next";
import { ConfirmView } from "@/components/flow/confirm-view";
import { FlowStatus } from "@/components/flow/status";
import { getAccount } from "@/lib/account/session";

export const instant = false;

export const metadata: Metadata = {
  title: "Confirm · CredPronto",
  description: "Confirm names, dates, and place of birth before the free preview.",
};

export default async function ConfirmPage() {
  const account = await getAccount();
  return (
    <Suspense fallback={<FlowStatus title="Loading your details…" body="" />}>
      <ConfirmView accountEmail={account?.email ?? null} />
    </Suspense>
  );
}
