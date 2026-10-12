import { Suspense } from "react";
import { AuthForm } from "@/components/account/auth-form";
import { AuthLayout } from "@/components/account/auth-layout";

export default function SignUpPage() {
  return (
    <AuthLayout title="Create account" lede="Orders placed with this email are added to your account when you confirm it.">
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthLayout>
  );
}
