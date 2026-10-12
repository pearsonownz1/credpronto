import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMockMode, MOCK_COOKIE, readMockAccount } from "@/lib/account/session";
import { readPublicSupabaseEnv } from "./env";

export type SessionUpdate = {
  response: NextResponse;
  signedIn: boolean;
};

function continueRequest(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-cp-path",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  if (isMockMode()) {
    const signedIn = readMockAccount(request.cookies.get(MOCK_COOKIE)?.value) != null;
    return { response: continueRequest(request), signedIn };
  }

  let supabaseResponse = continueRequest(request);

  let url: string;
  let key: string;
  try {
    ({ url, key } = readPublicSupabaseEnv());
  } catch {
    return { response: supabaseResponse, signedIn: false };
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
        supabaseResponse = continueRequest(request);
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
  const { data, error } = await supabase.auth.getClaims();

  return { response: supabaseResponse, signedIn: !error && Boolean(data?.claims?.sub) };
}
