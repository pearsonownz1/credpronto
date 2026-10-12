"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { mockAccountFor } from "@/lib/account/names";
import { clearMockAccount, isMockMode, writeMockAccount } from "@/lib/account/session";

export type AuthFormState = { error?: string; message?: string } | null;

function emailOf(formData: FormData): string {
  return String(formData.get("email") ?? "").trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function mockPasswordAuth(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isMockMode()) return { error: "Mock sign-in is not enabled." };
  const email = emailOf(formData);
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""), "/dashboard");
  if (!isEmail(email)) return { error: "Enter a valid email." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  await writeMockAccount(mockAccountFor(email));
  redirect(next);
}

export async function mockMagicLink(_state: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isMockMode()) return { error: "Mock sign-in is not enabled." };
  const email = emailOf(formData);
  if (!isEmail(email)) return { error: "Enter the email on your account." };
  return { message: "Check your email for a sign-in link." };
}

export async function signOut(): Promise<void> {
  await clearMockAccount();
  if (!isMockMode()) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // The mock cookie is already cleared. A missing Supabase env still signs the browser out locally.
    }
  }
  redirect("/");
}
