import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readPublicSupabaseEnv, readServiceRoleEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = readPublicSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll from a Server Component can be ignored when proxy.ts
          // refreshes the session.
        }
      },
    },
  });
}

/** Privileged server client. Never import this from client components. */
export function createServiceClient() {
  const { url, key } = readServiceRoleEnv();

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
