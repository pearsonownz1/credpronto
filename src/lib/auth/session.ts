import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/orders/errors";

export type AuthUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
};

type Identity = {
  identity_data?: Record<string, unknown> | null;
};

/** Magic link, confirmed password, and Google (email_verified) all count. */
export function emailIsVerified(user: {
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  identities?: Identity[] | null;
}): boolean {
  if (!user.email) return false;
  if (user.email_confirmed_at || user.confirmed_at) return true;
  return (user.identities ?? []).some((identity) => identity.identity_data?.email_verified === true);
}

function authUser(user: {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  identities?: Identity[] | null;
}): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    emailVerified: emailIsVerified(user),
  };
}

/** Validated auth user, or null when this request has no Supabase session. */
export async function optionalUser(): Promise<AuthUser | null> {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return authUser(data.user);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

export async function requireUser(): Promise<AuthUser> {
  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch {
    throw new HttpError("Auth is not configured", 503);
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError("Sign in required", 401);

  return authUser(data.user);
}
