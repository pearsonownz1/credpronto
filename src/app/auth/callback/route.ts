import { claimOrdersForUser } from "@/lib/auth/claim";
import { requestOrigin, safeNextPath } from "@/lib/auth/redirect";
import { emailIsVerified } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { serviceDb } from "@/lib/orders/storage";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const next = safeNextPath(url.searchParams.get("next"));
  const supabase = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (code) {
    const exchanged = await supabase.auth.exchangeCodeForSession(code);
    if (exchanged.error) return NextResponse.redirect(`${origin}/?auth_error=1`);
  } else if (tokenHash && type && isEmailOtpType(type)) {
    const verified = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (verified.error) return NextResponse.redirect(`${origin}/?auth_error=1`);
  } else {
    return NextResponse.redirect(`${origin}/?auth_error=1`);
  }

  const { data } = await supabase.auth.getUser();
  if (data.user) {
    await claimOrdersForUser(serviceDb(), {
      id: data.user.id,
      email: data.user.email ?? null,
      emailVerified: emailIsVerified(data.user),
    });
  }

  return NextResponse.redirect(`${origin}${next}`);
}

function isEmailOtpType(type: string): type is "signup" | "invite" | "magiclink" | "recovery" | "email" | "email_change" {
  return type === "signup" || type === "invite" || type === "magiclink" || type === "recovery" || type === "email" || type === "email_change";
}
