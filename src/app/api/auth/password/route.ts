import { readEmail, readJson, readNext, readOrderToken } from "@/lib/auth/body";
import { emailHasAccount, generateConfirmLink, isExistingAccountError } from "@/lib/auth/email-link";
import { finishAuthenticatedUser } from "@/lib/auth/finish";
import { attachOrderToken } from "@/lib/auth/order-link";
import { requestOrigin } from "@/lib/auth/redirect";
import { emailIsVerified } from "@/lib/auth/session";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { sendAuthLink } from "@/lib/orders/email";
import { renderAuthLinkEmail } from "@/lib/orders/email-templates";
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
    const rawName = (body as { name?: unknown }).name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const orderToken = readOrderToken(body);
    const origin = requestOrigin(request);

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

      let link: { userId: string; confirmUrl: string };
      try {
        link = await generateConfirmLink({
          email,
          purpose: "signup",
          password,
          name: name || undefined,
          origin,
          next: readNext(body) ?? "/account",
          orderToken,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (isExistingAccountError(error as { message?: string })) throw new HttpError("Log in", 409, "account_exists");
        throw error;
      }

      await attachOrderToken(serviceDb(), link.userId, orderToken);
      const rendered = renderAuthLinkEmail({ confirmUrl: link.confirmUrl, purpose: "signup" });
      const mailed = await sendAuthLink(email, rendered);

      const signed = await supabase.auth.signInWithPassword({ email, password });
      const session = Boolean(signed.data.session && signed.data.user);
      const claimed =
        session && signed.data.user
          ? await finishAuthenticatedUser(signed.data.user, orderToken).catch(() => [])
          : [];
      return json({
        userId: link.userId,
        session,
        claimedOrderIds: claimed,
        emailSent: mailed.sent,
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
