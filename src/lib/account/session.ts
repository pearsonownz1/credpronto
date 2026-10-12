import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { mockAccountName } from "./names";
import type { Account } from "./names";

export const MOCK_COOKIE = "cp-mock-account";

export function isMockMode(): boolean {
  return process.env.CREDPRONTO_MOCK === "1" || process.env.NEXT_PUBLIC_CREDPRONTO_MOCK === "1";
}

export function isPublicMockMode(): boolean {
  return process.env.NEXT_PUBLIC_CREDPRONTO_MOCK === "1";
}

export async function currentPath(): Promise<string> {
  const { headers } = await import("next/headers");
  const headerStore = await headers();
  return headerStore.get("x-cp-path") ?? "/dashboard";
}

export async function currentOrigin(): Promise<string> {
  const { headers } = await import("next/headers");
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (!host) return "http://127.0.0.1:3000";
  const proto =
    headerStore.get("x-forwarded-proto") ??
    (host.startsWith("127.") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function encodeAccount(account: Account): string {
  return Buffer.from(JSON.stringify(account), "utf8").toString("base64url");
}

export function readMockAccount(value: string | undefined): Account | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Account>;
    if (!parsed.email || !parsed.id || !parsed.name) return null;
    return { id: parsed.id, email: parsed.email, name: parsed.name, isAdmin: parsed.isAdmin === true };
  } catch {
    return null;
  }
}

export async function writeMockAccount(account: Account): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MOCK_COOKIE, encodeAccount(account), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearMockAccount(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(MOCK_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

async function readIsAdmin(userId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
    if (error || !data) return false;
    return data.is_admin === true;
  } catch {
    return false;
  }
}

export async function getAccount(): Promise<Account | null> {
  const cookieStore = await cookies();
  if (isMockMode()) return readMockAccount(cookieStore.get(MOCK_COOKIE)?.value);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    const user = data.user;
    if (error || !user?.email) return null;
    const meta = user.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
    const named =
      (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta?.name === "string" && meta.name.trim()) ||
      "";
    return {
      id: user.id,
      email: user.email,
      name: named || mockAccountName(user.email),
      isAdmin: await readIsAdmin(user.id),
    };
  } catch {
    return null;
  }
}
