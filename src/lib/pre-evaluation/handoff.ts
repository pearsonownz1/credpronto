import { safeNextPath } from "@/lib/auth/redirect";
import { SITE_ORIGIN } from "@/lib/seo";
import type { PreEvaluationPrefill } from "./client";

export const PRE_EVALUATION_PATH = "/pre-evaluation";

export const PRE_EVALUATION_CANONICAL = `${SITE_ORIGIN}${PRE_EVALUATION_PATH}`;

/**
 * Signup link from GET /api/pre-evaluation/{id}/prefill.
 * The API path is used when it stays on this site. Otherwise the email and order path are rebuilt the same way.
 */
export function signupHrefFromPrefill(
  prefill: Pick<PreEvaluationPrefill, "email" | "signupPath" | "orderPath">,
): string {
  const fromApi = acceptedSignupPath(prefill.signupPath);
  if (fromApi) return fromApi;
  const email = prefill.email.trim();
  const next = safeNextPath(prefill.orderPath, "/translate");
  return `/sign-up?${new URLSearchParams({ email, next }).toString()}`;
}

function acceptedSignupPath(path: string): string | null {
  if (!path.startsWith("/sign-up?") || path.includes("\\") || path.includes("://")) return null;
  let url: URL;
  try {
    url = new URL(path, "https://credpronto.local");
  } catch {
    return null;
  }
  if (url.pathname !== "/sign-up") return null;
  const email = url.searchParams.get("email")?.trim() ?? "";
  if (!email || !email.includes("@")) return null;
  const next = safeNextPath(url.searchParams.get("next"), "");
  if (!next.startsWith("/translate")) return null;
  return `/sign-up?${new URLSearchParams({ email, next }).toString()}`;
}
