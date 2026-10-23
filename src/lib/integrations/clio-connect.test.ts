import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIO_ACTION_FAILED_NOTICE,
  CLIO_CONNECT_PATH,
  CLIO_CONNECTED_NOTICE,
  CLIO_DISCONNECT_ERROR_NOTICE,
  CLIO_DISCONNECT_PATH,
  CLIO_ERROR_NOTICE,
  CLIO_STATUS_ERROR_NOTICE,
  CLIO_STATUS_PATH,
  clioAfterDisconnect,
  clioConnectionFromLanding,
  clioConnectionFromStatus,
  clioLandingFromSearch,
  clioPublicError,
  disconnectClio,
  loadClioStatus,
  parseClioStatus,
} from "./clio-connect";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clio status", () => {
  it("reads connected yes or no and keeps a region when Clio sends one", () => {
    expect(parseClioStatus({ connected: false })).toEqual({ connected: false });
    expect(parseClioStatus({ connected: false, region: "us" })).toEqual({ connected: false });
    expect(parseClioStatus({ connected: true, region: "eu" })).toEqual({ connected: true, region: "eu" });
    expect(parseClioStatus({ connected: true })).toEqual({ connected: true, region: null });
    expect(parseClioStatus({ connected: true, region: "" })).toEqual({ connected: true, region: null });
    expect(parseClioStatus({ connected: "yes" })).toBeNull();
    expect(parseClioStatus(null)).toBeNull();
  });

  it("loads status with the session cookie", async () => {
    const fetchMock = vi.fn(async () => Response.json({ connected: true, region: "us" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadClioStatus()).resolves.toEqual({
      ok: true,
      status: 200,
      data: { connected: true, region: "us" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      CLIO_STATUS_PATH,
      expect.objectContaining({ credentials: "include" }),
    );
    expect(CLIO_CONNECT_PATH).toBe("/api/integrations/clio/connect");
  });

  it("keeps a short status error and drops markup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Clio storage is not ready" }, { status: 503 })));
    await expect(loadClioStatus()).resolves.toMatchObject({
      ok: false,
      status: 503,
      error: "Clio storage is not ready",
    });
    expect(clioPublicError("Clio storage is not ready", CLIO_STATUS_ERROR_NOTICE)).toBe("Clio storage is not ready");
    expect(clioPublicError("<script>alert(1)</script>", CLIO_STATUS_ERROR_NOTICE)).toBe(CLIO_STATUS_ERROR_NOTICE);
    expect(clioPublicError("x".repeat(181), CLIO_STATUS_ERROR_NOTICE)).toBe(CLIO_STATUS_ERROR_NOTICE);
  });

  it("rejects a status body that is not connected yes or no", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    await expect(loadClioStatus()).resolves.toMatchObject({ ok: false, error: "Unexpected response" });
  });
});

describe("clio disconnect", () => {
  it("posts disconnect and then the caller can refresh status", async () => {
    let body: BodyInit | null | undefined = "unset";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = init?.body;
      return Response.json({ connected: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(disconnectClio()).resolves.toEqual({
      ok: true,
      status: 200,
      data: { connected: false },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      CLIO_DISCONNECT_PATH,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(body).toBeUndefined();
  });

  it("stays connected when disconnect fails and follows a refreshed status", () => {
    expect(
      clioAfterDisconnect(
        { ok: false, status: 500, error: "Clio could not be disconnected." },
        { ok: true, status: 200, data: { connected: false } },
      ),
    ).toEqual({
      connection: "connected",
      notice: { tone: "error", message: "Clio could not be disconnected." },
    });
    expect(
      clioAfterDisconnect(
        { ok: true, status: 200, data: { connected: false } },
        { ok: true, status: 200, data: { connected: false } },
      ),
    ).toEqual({ connection: "disconnected", notice: null });
    expect(
      clioAfterDisconnect(
        { ok: true, status: 200, data: { connected: false } },
        { ok: true, status: 200, data: { connected: true, region: "us" } },
      ),
    ).toEqual({
      connection: "connected",
      notice: { tone: "error", message: CLIO_DISCONNECT_ERROR_NOTICE },
    });
    expect(
      clioAfterDisconnect(
        { ok: true, status: 200, data: { connected: false } },
        { ok: false, status: 503, error: "Clio storage is not ready" },
      ),
    ).toEqual({
      connection: "disconnected",
      notice: { tone: "error", message: "Clio storage is not ready" },
    });
  });
});

describe("clio landing query", () => {
  it("shows connected with a success notice for ?clio=connected", () => {
    const landing = clioLandingFromSearch("?clio=connected");
    expect(landing).toEqual({
      showConnected: true,
      notice: { tone: "success", message: CLIO_CONNECTED_NOTICE },
    });
    expect(clioConnectionFromLanding(landing)).toBe("connected");
    expect(clioLandingFromSearch("?clio=Connected").showConnected).toBe(true);
  });

  it("keeps connected and explains a failed matter action", () => {
    expect(clioLandingFromSearch("?clio=connected&clio_action=failed")).toEqual({
      showConnected: true,
      notice: { tone: "error", message: CLIO_ACTION_FAILED_NOTICE },
    });
  });

  it("uses a fixed notice for any error query param and does not echo it", () => {
    const samples = [
      "?clio=error",
      "?error=access_denied",
      "?error=",
      "?error_description=server_exploded",
      "?clio_error=token",
      "?Error-Code=1",
      "?foo=error",
      "?clio=weird",
      "?clio_action=failed",
    ];
    for (const search of samples) {
      const landing = clioLandingFromSearch(search);
      expect(landing.showConnected, search).toBe(false);
      expect(landing.notice, search).toEqual({ tone: "error", message: CLIO_ERROR_NOTICE });
      expect(landing.notice?.message, search).not.toMatch(/access_denied|server_exploded|token/);
    }
  });

  it("still shows connected when an error param arrives with clio=connected", () => {
    const landing = clioLandingFromSearch("?clio=connected&error=access_denied");
    expect(landing.showConnected).toBe(true);
    expect(landing.notice).toEqual({ tone: "error", message: CLIO_ERROR_NOTICE });
    expect(JSON.stringify(landing)).not.toContain("access_denied");
  });

  it("ignores unrelated query params", () => {
    expect(clioLandingFromSearch("")).toEqual({ showConnected: false, notice: null });
    expect(clioLandingFromSearch("?redirect_status=succeeded")).toEqual({ showConnected: false, notice: null });
    expect(clioConnectionFromLanding(clioLandingFromSearch(""))).toBe("loading");
  });

  it("lets a successful status response decide the card", () => {
    const connected = clioLandingFromSearch("?clio=connected");
    expect(
      clioConnectionFromStatus({ ok: true, status: 200, data: { connected: true, region: "us" } }, connected),
    ).toEqual({ connection: "connected", notice: connected.notice });
    expect(
      clioConnectionFromStatus({ ok: true, status: 200, data: { connected: false } }, connected),
    ).toEqual({ connection: "disconnected", notice: null });

    const failed = clioLandingFromSearch("?clio=error");
    expect(
      clioConnectionFromStatus({ ok: true, status: 200, data: { connected: false } }, failed),
    ).toEqual({ connection: "disconnected", notice: failed.notice });
    expect(
      clioConnectionFromStatus({ ok: false, status: 503, error: "Clio storage is not ready" }, failed),
    ).toEqual({ connection: "disconnected", notice: failed.notice });
    expect(
      clioConnectionFromStatus({ ok: false, status: 503, error: "Clio storage is not ready" }, clioLandingFromSearch("")),
    ).toEqual({
      connection: "disconnected",
      notice: { tone: "error", message: "Clio storage is not ready" },
    });
    expect(
      clioConnectionFromStatus({ ok: false, status: 503, error: "nope" }, connected),
    ).toEqual({ connection: "connected", notice: connected.notice });
  });
});
