import { claimOrdersForUser } from "@/lib/auth/claim";
import { attachOrderToken } from "@/lib/auth/order-link";
import { emailIsVerified } from "@/lib/auth/session";
import { serviceDb } from "@/lib/orders/storage";

type VerifiedUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  app_metadata?: object | null;
  identities?: { identity_data?: Record<string, unknown> | null }[] | null;
};

/** Attach the current order, then claim earlier orders when the email is verified. */
export async function finishAuthenticatedUser(user: VerifiedUser, orderToken: string | null): Promise<string[]> {
  const db = serviceDb();
  await attachOrderToken(db, user.id, orderToken, user.email ?? null);
  return claimOrdersForUser(db, {
    id: user.id,
    email: user.email ?? null,
    emailVerified: emailIsVerified(user),
  });
}

/**
 * Instant sign-up has not proved the inbox. Link only the order this browser
 * holds (request token, next path, or stored token) and leave other guest orders.
 */
export async function finishInstantSignup(
  userId: string,
  orderToken: string | null,
  email: string | null,
): Promise<string[]> {
  const linked = await attachOrderToken(serviceDb(), userId, orderToken, email);
  return linked ? [linked] : [];
}
