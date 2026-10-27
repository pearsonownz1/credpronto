import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/orders/errors";

export const GCS_PIN_COOKIE = "gcs_translate_pin";
export const GCS_PIN_HEADER = "x-gcs-translate-pin";
export const GCS_PIN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const COOKIE_PURPOSE = "gcs-translate-session";

/** Configured PIN. Empty or missing env falls back to the shared desk PIN. */
export function gcsTranslatePin(): string {
  const configured = process.env.GCS_TRANSLATE_PIN;
  if (configured == null || configured.trim() === "") return "123456";
  return configured.trim();
}

export function gcsPinSessionToken(pin = gcsTranslatePin()): string {
  return createHmac("sha256", pin).update(COOKIE_PURPOSE).digest("hex");
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function pinIsValid(submitted: string | null | undefined, expected = gcsTranslatePin()): boolean {
  const pin = submitted?.trim() ?? "";
  if (!pin) return false;
  return sameText(pin, expected);
}

export function gcsPinCookieMatches(value: string | null | undefined): boolean {
  const token = value?.trim() ?? "";
  if (!token) return false;
  return sameText(token, gcsPinSessionToken());
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Cookie set by the PIN route, or the raw PIN in `x-gcs-translate-pin`. */
export function requestHasGcsPin(request: { headers: { get(name: string): string | null } }): boolean {
  if (pinIsValid(request.headers.get(GCS_PIN_HEADER))) return true;
  return gcsPinCookieMatches(readCookie(request.headers.get("cookie"), GCS_PIN_COOKIE));
}

/** GCS desk routes accept the PIN cookie (or the PIN header) and no Supabase session. */
export function isGcsPinUnlocked(request: { headers: { get(name: string): string | null } }): boolean {
  return requestHasGcsPin(request);
}

export function assertGcsPin(request: { headers: { get(name: string): string | null } }): void {
  if (!requestHasGcsPin(request)) {
    throw new HttpError("Enter the GCS PIN to start a translation.", 401);
  }
}

export function gcsPinCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GCS_PIN_COOKIE}=${gcsPinSessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${GCS_PIN_MAX_AGE_SECONDS}${secure}`;
}
