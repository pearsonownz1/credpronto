import { promoteVerifiedEmail } from "@/lib/auth/email-trust";
import { finishAuthenticatedUser } from "@/lib/auth/finish";
import { isEmailOtpType, requestOrigin, safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const next = safeNextPath(url.searchParams.get("next"));
  const supabase = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const orderToken = url.searchParams.get("order");

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
    let user = data.user;
    if (tokenHash && type && isEmailOtpType(type)) {
      try {
        user = await promoteVerifiedEmail(user);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "could not record email verification");
      }
    }
    await finishAuthenticatedUser(user, orderToken);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
