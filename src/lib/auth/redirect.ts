import { isOrderToken } from "@/lib/orders/token";

const EMAIL_OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email", "email_change"]);

export type EmailOtpType = "signup" | "invite" | "magiclink" | "recovery" | "email" | "email_change";

export function isEmailOtpType(type: string): type is EmailOtpType {
  return EMAIL_OTP_TYPES.has(type);
}

/**
 * Email links land here with token_hash. verifyOtp does not need the browser
 * that requested the link, so the same link works on another device.
 */
export function confirmUrl(
  origin: string,
  input: { tokenHash: string; type: string; next?: string | null; orderToken?: string | null },
): string {
  const url = new URL("/auth/confirm", origin.replace(/\/$/, ""));
  url.searchParams.set("token_hash", input.tokenHash);
  url.searchParams.set("type", input.type);
  url.searchParams.set("next", safeNextPath(input.next, "/account"));
  if (input.orderToken && isOrderToken(input.orderToken)) url.searchParams.set("order", input.orderToken);
  return url.toString();
}

/** Relative in-app path. Rejects protocol-relative and absolute URLs. */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("://") || value.includes("\\")) return fallback;
  return value;
}

/** Where a new account continues. Same-origin `next`, or Upload when it is missing. */
export function continueAfterSignup(value: string | null | undefined, fallback = "/translate"): string {
  return safeNextPath(value, fallback);
}

const ORDER_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

/**
 * Guest order token carried on a same-origin next path.
 * Matches /order/TOKEN, /preview/TOKEN, and ?token= or ?order= on any in-app path.
 */
export function orderTokenFromNext(value: string | null | undefined): string | null {
  const path = safeNextPath(value, "");
  if (!path) return null;
  let url: URL;
  try {
    url = new URL(path, "https://credpronto.local");
  } catch {
    return null;
  }
  const fromQuery = url.searchParams.get("token") ?? url.searchParams.get("order");
  if (fromQuery && ORDER_TOKEN.test(fromQuery)) return fromQuery;
  const match = /^\/(?:order|preview)\/([^/]+)$/.exec(url.pathname);
  if (!match?.[1]) return null;
  let segment = match[1];
  try {
    segment = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return ORDER_TOKEN.test(segment) ? segment : null;
}

export function callbackUrl(origin: string, nextPath: string | null | undefined): string {
  const next = safeNextPath(nextPath);
  return `${origin.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return url.origin;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${forwardedProto}://${forwardedHost}`;
}
