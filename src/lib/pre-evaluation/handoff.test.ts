import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { officialEvaluationSignupHref } from "./handoff";

describe("official evaluation signup", () => {
  it("carries the pre-evaluation id and prefills the email", () => {
    const href = officialEvaluationSignupHref({ id: "prev-1", email: " ada@example.com " });
    const params = new URL(href, "https://credpronto.local").searchParams;
    expect(href.startsWith("/sign-up?")).toBe(true);
    expect(params.get("email")).toBe("ada@example.com");
    expect(params.get("preEvaluation")).toBe("prev-1");
    const next = params.get("next");
    expect(next).toBe("/translate?service=diploma&preEvaluation=prev-1");
    expect(safeNextPath(next, "/")).toBe(next);
  });
});
