import { Suspense } from "react";
import { AuthForm } from "@/components/account/auth-form";
import { AuthLayout } from "@/components/account/auth-layout";

export default function SignInPage() {
  return (
    <AuthLayout title="Sign in" lede="Email and password work on their own. Google is optional.">
      <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthLayout>
  );
}
