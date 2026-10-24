import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { signupHrefFromPrefill } from "./handoff";

describe("official evaluation signup", () => {
  it("uses the prefill signup path and keeps the email on the account form", () => {
    const href = signupHrefFromPrefill({
      email: " ada@example.com ",
      signupPath:
        "/sign-up?email=ada%40example.com&next=%2Ftranslate%3Fservice%3Dcourse_by_course%26preEvaluation%3Dprev-1",
      orderPath: "/translate?service=course_by_course&preEvaluation=prev-1",
    });
    const params = new URL(href, "https://credpronto.local").searchParams;
    expect(href.startsWith("/sign-up?")).toBe(true);
    expect(params.get("email")).toBe("ada@example.com");
    const next = params.get("next");
    expect(next).toBe("/translate?service=course_by_course&preEvaluation=prev-1");
    expect(safeNextPath(next, "/")).toBe(next);
  });

  it("rebuilds a signup path when the prefill link leaves the site", () => {
    const href = signupHrefFromPrefill({
      email: "ada@example.com",
      signupPath: "https://example.invalid/sign-up?email=ada@example.com",
      orderPath: "/translate?service=diploma&preEvaluation=prev-1",
    });
    const params = new URL(href, "https://credpronto.local").searchParams;
    expect(params.get("email")).toBe("ada@example.com");
    expect(params.get("next")).toBe("/translate?service=diploma&preEvaluation=prev-1");
  });
});
