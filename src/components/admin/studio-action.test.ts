import { describe, expect, it } from "vitest";
import { approveButtonDisabled, approveButtonLabel, runStudioAction, settleStudioAction } from "./studio-action";

describe("approve button", () => {
  it("stays disabled until a staff-uploaded final is current", () => {
    expect(approveButtonDisabled(null, [])).toBe(true);
    expect(approveButtonDisabled(null, [{ current: false }])).toBe(true);
    expect(approveButtonDisabled(null, [{ current: true }])).toBe(false);
    expect(approveButtonDisabled("approve", [{ current: true }])).toBe(true);
  });

  it("shows a loading label while the request is in flight", () => {
    expect(approveButtonLabel(null)).toBe("Approve and release");
    expect(approveButtonLabel("approve")).toBe("Approving…");
    expect(approveButtonLabel("save")).toBe("Approve and release");
  });

  it("shows the API error and does not refresh the status when approve fails", () => {
    expect(settleStudioAction({ ok: false, error: "ENOENT: no such file or directory, open NotoSans-Italic.ttf" })).toEqual({
      error: "ENOENT: no such file or directory, open NotoSans-Italic.ttf",
      message: null,
      refresh: false,
      status: null,
    });
  });

  it("refreshes and applies the returned status only when approve succeeds", () => {
    expect(
      settleStudioAction({
        ok: true,
        message: "Certified files released. Email sent.",
        status: "delivered",
      }),
    ).toEqual({
      error: null,
      message: "Certified files released. Email sent.",
      refresh: true,
      status: "delivered",
    });
  });

  it("turns a thrown request into an inline error without a status change", async () => {
    const settled = await runStudioAction(async () => {
      throw new Error("Sign in required");
    });
    expect(settled).toEqual({
      error: "Sign in required",
      message: null,
      refresh: false,
      status: null,
    });
  });
});
