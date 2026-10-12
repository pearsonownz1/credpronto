import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readPublicSupabaseEnv } from "./env";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  let url: string;
  let key: string;
  try {
    ({ url, key } = readPublicSupabaseEnv());
  } catch {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([header, value]) =>
          supabaseResponse.headers.set(header, value),
        );
      },
    },
  });

  // Refreshes the auth token. Do not add logic between creating the client
  // and getClaims(). Public routes stay open; this does not gate the site.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
