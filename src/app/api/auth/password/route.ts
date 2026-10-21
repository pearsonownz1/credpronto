import { readEmail, readJson, readNext, readOrderToken } from "@/lib/auth/body";
import { emailHasAccount, isExistingAccountError } from "@/lib/auth/email-link";
import { finishAuthenticatedUser } from "@/lib/auth/finish";
import { attachOrderToken } from "@/lib/auth/order-link";
import { continueAfterSignup, orderTokenFromNext } from "@/lib/auth/redirect";
import { emailIsVerified } from "@/lib/auth/session";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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
    const rawName = (body as { name?: unknown }).name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const requestedNext = readNext(body);
    const orderToken = readOrderToken(body) ?? orderTokenFromNext(requestedNext);

    let supabase: Awaited<ReturnType<typeof createClient>>;
    try {
      supabase = await createClient();
    } catch {
      throw new HttpError("Auth is not configured", 503);
    }

    if (mode === "sign-up") {
      let exists = false;
      try {
        exists = await emailHasAccount(email);
      } catch (error) {
        if (error instanceof HttpError && error.status === 503) throw error;
        exists = false;
      }
      if (exists) throw new HttpError("Log in", 409, "account_exists");

      let admin: ReturnType<typeof createServiceClient>["auth"]["admin"];
      try {
        admin = createServiceClient().auth.admin;
      } catch {
        throw new HttpError("Auth is not configured", 503);
      }

      const created = await admin.createUser({
        email,
        password,
        email_confirm: true,
        ...(name ? { user_metadata: { full_name: name } } : {}),
      });
      if (created.error || !created.data.user) {
        if (isExistingAccountError(created.error)) throw new HttpError("Log in", 409, "account_exists");
        throw new HttpError(created.error?.message || "Could not create the account", 400);
      }

      await attachOrderToken(serviceDb(), created.data.user.id, orderToken);
      // The cookie client from @supabase/ssr writes the session onto this response.
      const signed = await supabase.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session || !signed.data.user) {
        throw new HttpError(signed.error?.message || "Could not sign in", 401);
      }
      const claimed = await finishAuthenticatedUser(signed.data.user, orderToken).catch(() => []);
      return json({
        userId: signed.data.user.id,
        session: true,
        claimedOrderIds: claimed,
        emailVerified: emailIsVerified(signed.data.user),
        next: continueAfterSignup(requestedNext),
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      const message = error?.message?.toLowerCase() ?? "";
      if (message.includes("confirm")) {
        throw new HttpError("Check your email to confirm your account.", 401, "email_unconfirmed");
      }
      throw new HttpError("Invalid email or password", 401);
    }
    const claimed = await finishAuthenticatedUser(data.user, orderToken);
    return json({
      userId: data.user.id,
      session: true,
      claimedOrderIds: claimed,
      emailVerified: emailIsVerified(data.user),
    });
  });
}
