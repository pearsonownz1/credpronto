import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_REFRESH_AFTER_MS,
  REFRESH_BACKOFF_MS,
  REFRESH_RETRY_LIMIT,
  VIEWER_REFRESH_AFTER_MS,
  downloadNeedsFreshLink,
  linkForDownload,
  viewAfterRefresh,
  watchSignedLink,
} from "./link-refresh";

const ORDER_ID = "28492f38-1111-4111-8111-111111111111";

afterEach(() => {
  vi.useRealTimers();
});

describe("signed link clock", () => {
  it("refreshes the viewer at 270s and a download at 240s", () => {
    expect(VIEWER_REFRESH_AFTER_MS).toBe(270_000);
    expect(DOWNLOAD_REFRESH_AFTER_MS).toBe(240_000);
    expect(REFRESH_BACKOFF_MS).toEqual([5_000, 15_000, 30_000]);
    expect(REFRESH_RETRY_LIMIT).toBe(3);
  });

  it("re-gets the verify API at 270s while the tab is visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    let fetchedAt = Date.now();
    const refresh = vi.fn(async () => {
      fetchedAt = Date.now();
    });
    const watch = watchSignedLink({
      getFetchedAt: () => fetchedAt,
      isVisible: () => true,
      refresh,
      onExhausted: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(269_000);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(269_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it("does not re-get while the tab is hidden, then refreshes when it returns stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    let visible = true;
    const refresh = vi.fn(async () => undefined);
    const watch = watchSignedLink({
      getFetchedAt: () => Date.parse("2026-10-23T12:00:00.000Z"),
      isVisible: () => visible,
      refresh,
      onExhausted: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(269_000);
    visible = false;
    watch.onVisibility();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    watch.onVisibility();
    expect(refresh).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it("does not refresh on visibilitychange while the link is still inside 270s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    let visible = true;
    const refresh = vi.fn(async () => undefined);
    const watch = watchSignedLink({
      getFetchedAt: () => Date.parse("2026-10-23T12:00:00.000Z"),
      isVisible: () => visible,
      refresh,
      onExhausted: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(100_000);
    visible = false;
    watch.onVisibility();
    visible = true;
    watch.onVisibility();
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(169_000);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it("retries a failed refresh at 5s, 15s, and 30s, then shows the error state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    const refresh = vi.fn(async () => {
      throw new Error("offline");
    });
    const onExhausted = vi.fn();
    const watch = watchSignedLink({
      getFetchedAt: () => Date.parse("2026-10-23T12:00:00.000Z"),
      isVisible: () => true,
      refresh,
      onExhausted,
    });

    await vi.advanceTimersByTimeAsync(270_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onExhausted).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(14_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(onExhausted).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    watch.stop();
  });

  it("stops the backoff after a retry succeeds and does not retry while hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    let visible = true;
    let fetchedAt = Date.parse("2026-10-23T12:00:00.000Z");
    const refresh = vi.fn(async () => {
      if (refresh.mock.calls.length === 1) throw new Error("offline");
      fetchedAt = Date.now();
    });
    const onExhausted = vi.fn();
    const watch = watchSignedLink({
      getFetchedAt: () => fetchedAt,
      isVisible: () => visible,
      refresh,
      onExhausted,
    });

    await vi.advanceTimersByTimeAsync(270_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    visible = false;
    watch.onVisibility();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    visible = true;
    watch.onVisibility();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onExhausted).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(269_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(onExhausted).not.toHaveBeenCalled();
    watch.stop();
  });

  it("finishes a backoff that was paused when the tab returns early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    let visible = true;
    const refresh = vi.fn(async () => {
      throw new Error("offline");
    });
    const watch = watchSignedLink({
      getFetchedAt: () => Date.parse("2026-10-23T12:00:00.000Z"),
      isVisible: () => visible,
      refresh,
      onExhausted: () => undefined,
    });

    await vi.advanceTimersByTimeAsync(270_000);
    await vi.advanceTimersByTimeAsync(2_000);
    visible = false;
    watch.onVisibility();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    visible = true;
    watch.onVisibility();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it("does not retry an aborted refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    const refresh = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const onExhausted = vi.fn();
    const watch = watchSignedLink({
      getFetchedAt: () => Date.parse("2026-10-23T12:00:00.000Z"),
      isVisible: () => true,
      refresh,
      onExhausted,
    });

    await vi.advanceTimersByTimeAsync(270_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onExhausted).not.toHaveBeenCalled();
    watch.stop();
  });

  it("fetches a fresh download link only once the current one is 240s old", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    const fetchedAt = Date.now();
    const refresh = vi.fn(async () => ({
      fetchedAt: Date.now(),
      verification: { documentUrl: "https://files.example/fresh.pdf" },
    }));

    vi.setSystemTime(fetchedAt + 239_000);
    await expect(
      linkForDownload({
        fetchedAt,
        documentUrl: "https://files.example/first.pdf",
        refresh,
      }),
    ).resolves.toEqual({
      refreshed: false,
      fetchedAt,
      documentUrl: "https://files.example/first.pdf",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(downloadNeedsFreshLink(fetchedAt)).toBe(false);

    vi.setSystemTime(fetchedAt + 240_000);
    expect(downloadNeedsFreshLink(fetchedAt)).toBe(true);
    await expect(
      linkForDownload({
        fetchedAt,
        documentUrl: "https://files.example/first.pdf",
        refresh,
      }),
    ).resolves.toEqual({
      refreshed: true,
      fetchedAt: fetchedAt + 240_000,
      verification: { documentUrl: "https://files.example/fresh.pdf" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("points a remote iframe at the new signed URL and leaves an in-memory PDF in place", () => {
    const now = Date.parse("2026-10-23T12:04:30.000Z");
    const next = {
      status: "valid" as const,
      type: "evaluation" as const,
      issuedAt: "2026-10-23T12:00:00.000Z",
      documentUrl: "https://files.example/fresh.pdf",
      reference: ORDER_ID,
    };
    expect(
      viewAfterRefresh(
        {
          documentUrl: "https://files.example/first.pdf",
          viewerUrl: "https://files.example/first.pdf",
          remote: true,
          fetchedAt: now - 270_000,
        },
        next,
        now,
      ),
    ).toEqual({
      outcome: "valid",
      view: {
        documentUrl: "https://files.example/fresh.pdf",
        viewerUrl: "https://files.example/fresh.pdf",
        remote: true,
        fetchedAt: now,
      },
    });
    expect(
      viewAfterRefresh(
        {
          documentUrl: "https://files.example/first.pdf",
          viewerUrl: "blob:document",
          remote: false,
          fetchedAt: now - 270_000,
        },
        next,
        now,
      ),
    ).toMatchObject({ outcome: "valid", view: { viewerUrl: "blob:document", remote: false, fetchedAt: now } });
    expect(viewAfterRefresh(
      { documentUrl: "https://files.example/first.pdf", viewerUrl: "https://files.example/first.pdf", remote: true, fetchedAt: now },
      { ...next, status: "revoked", documentUrl: null },
      now,
    )).toEqual({ outcome: "revoked" });
    expect(viewAfterRefresh(
      { documentUrl: null, viewerUrl: null, remote: false, fetchedAt: now },
      { status: "not_found", type: null, issuedAt: null, documentUrl: null, reference: null },
      now,
    )).toEqual({ outcome: "not_found" });
  });
});
