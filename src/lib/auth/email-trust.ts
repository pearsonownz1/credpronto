import { createServiceClient } from "@/lib/supabase/server";

/** Server-only mark. Instant sign-up is not an email proof. */
export const INSTANT_SIGNUP_APP_METADATA = { email_verified: false } as const;

type TrustUser = {
  id: string;
  app_metadata?: object | null;
};

/**
 * A magic link or confirm-flow OTP proved this inbox.
 * Later email claiming can run. The local user is updated for this request
 * because the session object still carries the old app_metadata.
 */
export async function promoteVerifiedEmail<T extends TrustUser>(user: T): Promise<T> {
  const admin = createServiceClient().auth.admin;
  const updated = await admin.updateUserById(user.id, { app_metadata: { email_verified: true } });
  if (updated.error) throw new Error(updated.error.message);
  const current =
    user.app_metadata && typeof user.app_metadata === "object" ? { ...user.app_metadata } : {};
  return {
    ...user,
    app_metadata: { ...current, email_verified: true },
  };
}
