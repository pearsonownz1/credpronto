import { claimOrdersForUser } from "@/lib/auth/claim";
import { attachOrderToken } from "@/lib/auth/order-link";
import { emailIsVerified } from "@/lib/auth/session";
import { serviceDb } from "@/lib/orders/storage";

type VerifiedUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  identities?: { identity_data?: Record<string, unknown> | null }[] | null;
};

/** Attach the current order, then claim earlier orders when the email is verified. */
export async function finishAuthenticatedUser(user: VerifiedUser, orderToken: string | null): Promise<string[]> {
  const db = serviceDb();
  await attachOrderToken(db, user.id, orderToken);
  return claimOrdersForUser(db, {
    id: user.id,
    email: user.email ?? null,
    emailVerified: emailIsVerified(user),
  });
}
