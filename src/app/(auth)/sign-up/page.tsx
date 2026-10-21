import { Suspense } from "react";
import { CreateAccountCard } from "@/components/account/create-account-card";

export default function SignUpPage() {
  return (
    <main className="preview-theme flex min-h-dvh items-center justify-center bg-[#f6f7f9] px-4 py-12 text-ink">
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <CreateAccountCard />
      </Suspense>
    </main>
  );
}
