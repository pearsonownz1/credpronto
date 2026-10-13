import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluationUploadError } from "./evaluation-staff";
import { approveOrder, uploadFinishedEvaluation } from "./mutations";
import { settleStudioAction } from "@/components/admin/studio-action";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uploadFinishedEvaluation", () => {
  it("posts the PDF and turns a missing route into a calm message", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    const sent: { file: FormDataEntryValue | null } = { file: null };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body instanceof FormData) sent.file = init.body.get("file");
      return new Response("<html>missing</html>", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["%PDF-1.4"], "evaluation.pdf", { type: "application/pdf" });
    const id = "28492f38-1111-4111-8111-111111111111";

    const missing = await uploadFinishedEvaluation(id, file);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/orders/${id}/evaluation`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(sent.file).toBe(file);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(evaluationUploadError(missing.status, missing.error)).toBe(
      "The finished evaluation upload isn't available yet.",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Order not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const absent = await uploadFinishedEvaluation(id, file);
    expect(absent.ok).toBe(false);
    if (absent.ok) return;
    expect(evaluationUploadError(absent.status, absent.error)).toBe("Order not found");
  });
});

describe("approveOrder", () => {
  it("posts the order id with the session cookie and surfaces a failed body", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "ENOENT: no such file or directory, open 'NotoSans-Italic.ttf'" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const id = "28492f38-1111-4111-8111-111111111111";
    const result = await approveOrder(id);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/orders/${id}/approve`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: "ENOENT: no such file or directory, open 'NotoSans-Italic.ttf'",
    });
    if (result.ok) return;
    expect(settleStudioAction({ ok: false, error: result.error })).toMatchObject({
      error: "ENOENT: no such file or directory, open 'NotoSans-Italic.ttf'",
      refresh: false,
      status: null,
    });
  });

  it("treats a delivered response as the only reason to refresh status", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "delivered", email: "sent" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const result = await approveOrder("28492f38-1111-4111-8111-111111111111");
    expect(result).toMatchObject({ ok: true, data: { status: "delivered", email: "sent" } });
    if (!result.ok || !result.data || typeof result.data !== "object") throw new Error("expected a delivered body");
    const body = result.data as { status?: string; email?: string };
    expect(
      settleStudioAction({
        ok: true,
        message: `Certified files released. Email ${body.email}.`,
        status: body.status,
      }),
    ).toMatchObject({ refresh: true, status: "delivered", error: null });
  });
});
