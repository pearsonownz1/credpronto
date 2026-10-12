import { Suspense } from "react";
import { AuthForm } from "@/components/account/auth-form";
import { AuthLayout } from "@/components/account/auth-layout";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Forgot password" lede="We'll email a sign-in link. It comes back through /auth/callback.">
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <AuthForm mode="forgot" />
      </Suspense>
    </AuthLayout>
  );
}
