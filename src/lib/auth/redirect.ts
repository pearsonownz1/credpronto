/** Relative in-app path. Rejects protocol-relative and absolute URLs. */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("://") || value.includes("\\")) return fallback;
  return value;
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
