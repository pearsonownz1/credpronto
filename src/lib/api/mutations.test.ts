import { afterEach, describe, expect, it, vi } from "vitest";
import { approveOrder } from "./mutations";
import { settleStudioAction } from "@/components/admin/studio-action";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
