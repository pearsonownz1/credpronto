import { confirmUrl } from "@/lib/auth/redirect";
import { HttpError } from "@/lib/orders/errors";
import { readServiceRoleEnv } from "@/lib/supabase/env";
import { createServiceClient } from "@/lib/supabase/server";

export function isExistingAccountError(error: { message?: string; code?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "email_exists" ||
    code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("already exists")
  );
}

/** True when this exact email already has a Supabase Auth user. */
export async function emailHasAccount(email: string): Promise<boolean> {
  let url: string;
  let key: string;
  try {
    ({ url, key } = readServiceRoleEnv());
  } catch {
    throw new HttpError("Auth is not configured", 503);
  }
  const endpoint = new URL("/auth/v1/admin/users", url);
  endpoint.searchParams.set("page", "1");
  endpoint.searchParams.set("per_page", "50");
  endpoint.searchParams.set("filter", email.trim());
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new HttpError("Auth is not configured", 503);
  const body = (await response.json()) as { users?: { email?: string | null }[] };
  const target = email.trim().toLowerCase();
  return (body.users ?? []).some((user) => user.email?.trim().toLowerCase() === target);
}

export async function generateConfirmLink(input: {
  email: string;
  purpose: "signup" | "magiclink";
  password?: string;
  name?: string;
  origin: string;
  next: string | null;
  orderToken: string | null;
}): Promise<{ userId: string; confirmUrl: string }> {
  let admin: ReturnType<typeof createServiceClient>["auth"]["admin"];
  try {
    admin = createServiceClient().auth.admin;
  } catch {
    throw new HttpError("Auth is not configured", 503);
  }

  const generated =
    input.purpose === "signup"
      ? await admin.generateLink({
          type: "signup",
          email: input.email,
          password: input.password ?? "",
          options: {
            redirectTo: `${input.origin.replace(/\/$/, "")}/account`,
            ...(input.name ? { data: { full_name: input.name } } : {}),
          },
        })
      : await admin.generateLink({
          type: "magiclink",
          email: input.email,
          options: { redirectTo: `${input.origin.replace(/\/$/, "")}/account` },
        });

  if (generated.error || !generated.data.user || !generated.data.properties?.hashed_token) {
    if (isExistingAccountError(generated.error)) throw new HttpError("Log in", 409, "account_exists");
    throw new HttpError(generated.error?.message || "Could not create the sign-in link", 400);
  }

  const otpType = generated.data.properties.verification_type || input.purpose;
  return {
    userId: generated.data.user.id,
    confirmUrl: confirmUrl(input.origin, {
      tokenHash: generated.data.properties.hashed_token,
      type: otpType,
      next: input.next ?? "/account",
      orderToken: input.orderToken,
    }),
  };
}
