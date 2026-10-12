import { claimOrdersForUser } from "@/lib/auth/claim";
import { readEmail, readJson, readNext } from "@/lib/auth/body";
import { callbackUrl, requestOrigin } from "@/lib/auth/redirect";
import { emailIsVerified } from "@/lib/auth/session";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request);
    const email = readEmail(body);
    if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
    const password = (body as { password?: unknown }).password;
    if (typeof password !== "string" || password.length < 8) {
      throw new HttpError("password must be at least 8 characters", 400);
    }
    const mode = (body as { mode?: unknown }).mode === "sign-up" ? "sign-up" : "sign-in";

    let supabase: Awaited<ReturnType<typeof createClient>>;
    try {
      supabase = await createClient();
    } catch {
      throw new HttpError("Auth is not configured", 503);
    }

    if (mode === "sign-up") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callbackUrl(requestOrigin(request), readNext(body)) },
      });
      if (error) throw new HttpError(error.message, 400);
      const claimed =
        data.user && data.session
          ? await claimOrdersForUser(serviceDb(), {
              id: data.user.id,
              email: data.user.email ?? email,
              emailVerified: emailIsVerified(data.user),
            })
          : [];
      return json({ userId: data.user?.id ?? null, session: Boolean(data.session), claimedOrderIds: claimed });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new HttpError("Invalid email or password", 401);
    const claimed = await claimOrdersForUser(serviceDb(), {
      id: data.user.id,
      email: data.user.email ?? email,
      emailVerified: emailIsVerified(data.user),
    });
    return json({ userId: data.user.id, claimedOrderIds: claimed });
  });
}
