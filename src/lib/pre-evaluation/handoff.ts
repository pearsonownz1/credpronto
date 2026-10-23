import { safeNextPath } from "@/lib/auth/redirect";
import { SITE_ORIGIN } from "@/lib/seo";

export const PRE_EVALUATION_PATH = "/pre-evaluation";

export const PRE_EVALUATION_CANONICAL = `${SITE_ORIGIN}${PRE_EVALUATION_PATH}`;

/**
 * Signup handoff for a finished preview. The pre-evaluation id is the token.
 * The email that unlocked the preview is included so the account form can prefill it.
 */
export function officialEvaluationSignupHref(input: { id: string; email: string }): string {
  const id = input.id.trim();
  const email = input.email.trim();
  const next = safeNextPath(
    `/translate?${new URLSearchParams({ service: "diploma", preEvaluation: id }).toString()}`,
    "/translate",
  );
  return `/sign-up?${new URLSearchParams({ email, preEvaluation: id, next }).toString()}`;
}
