import { promoteVerifiedEmail } from "@/lib/auth/email-trust";
import { finishAuthenticatedUser } from "@/lib/auth/finish";
import { isEmailOtpType, requestOrigin, safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const next = safeNextPath(url.searchParams.get("next"), "/dashboard");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const orderToken = url.searchParams.get("order");

  if (!tokenHash || !type || !isEmailOtpType(type)) {
    return NextResponse.redirect(`${origin}/?auth_error=1`);
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.redirect(`${origin}/?auth_error=1`);
  }

  const verified = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (verified.error || !verified.data.user) {
    return NextResponse.redirect(`${origin}/?auth_error=1`);
  }

  let user = verified.data.user;
  try {
    user = await promoteVerifiedEmail(user);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "could not record email verification");
  }
  try {
    await finishAuthenticatedUser(user, orderToken);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "account link failed");
  }
  return NextResponse.redirect(`${origin}${next}`);
}
