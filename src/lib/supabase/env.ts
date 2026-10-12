type Env = Record<string, string | undefined>;

export function readPublicSupabaseEnv(env: Env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and a public Supabase key (NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).",
    );
  }

  return { url, key };
}

export function readServiceRoleEnv(env: Env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or a Supabase URL (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL).",
    );
  }

  return { url, key };
}
