import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_LINK_BACKOFF_MS,
  PREVIEW_LINK_REFRESH_AT_MS,
  PREVIEW_LINK_REFRESH_RETRY_LIMIT,
  previewLinkIsStale,
  previewLinkRefreshDelay,
  watchPreviewLink,
} from "./preview-link";

afterEach(() => {
  vi.useRealTimers();
});

describe("signed preview refresh", () => {
  it("refreshes a visible tab 30 seconds before the 5 minute expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onRefresh = vi.fn();
    watchPreviewLink({ issuedAt: 0, onRefresh });

    vi.advanceTimersByTime(PREVIEW_LINK_REFRESH_AT_MS - 1);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(previewLinkIsStale(0, PREVIEW_LINK_REFRESH_AT_MS - 1)).toBe(false);
    expect(previewLinkRefreshDelay(0, PREVIEW_LINK_REFRESH_AT_MS - 1)).toBe(1);

    vi.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(previewLinkIsStale(0, PREVIEW_LINK_REFRESH_AT_MS)).toBe(true);

    vi.advanceTimersByTime(PREVIEW_LINK_REFRESH_AT_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a hidden tab until it is visible again and the link is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visible = false;
    let onChange = () => {};
    const onRefresh = vi.fn();
    watchPreviewLink({
      issuedAt: 0,
      onRefresh,
      isVisible: () => visible,
      listen: (listener) => {
        onChange = listener;
        return () => {
          onChange = () => {};
        };
      },
    });

    vi.advanceTimersByTime(PREVIEW_LINK_REFRESH_AT_MS);
    expect(onRefresh).not.toHaveBeenCalled();

    visible = true;
    onChange();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the original expiry when the tab returns before the link is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visible = false;
    let onChange = () => {};
    const onRefresh = vi.fn();
    watchPreviewLink({
      issuedAt: 0,
      onRefresh,
      isVisible: () => visible,
      listen: (listener) => {
        onChange = listener;
        return () => undefined;
      },
    });

    vi.advanceTimersByTime(100_000);
    visible = true;
    onChange();
    expect(onRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PREVIEW_LINK_REFRESH_AT_MS - 100_000 - 1);
    expect(onRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("drops a scheduled refresh when the tab hides, then refreshes on return if the link is stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visible = true;
    let onChange = () => {};
    const onRefresh = vi.fn();
    watchPreviewLink({
      issuedAt: 0,
      onRefresh,
      isVisible: () => visible,
      listen: (listener) => {
        onChange = listener;
        return () => undefined;
      },
    });

    vi.advanceTimersByTime(200_000);
    visible = false;
    onChange();
    vi.advanceTimersByTime(PREVIEW_LINK_REFRESH_AT_MS);
    expect(onRefresh).not.toHaveBeenCalled();

    visible = true;
    onChange();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("skips the deadline when the tab is hidden without a visibility event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visible = true;
    const onRefresh = vi.fn();
    watchPreviewLink({ issuedAt: 0, onRefresh, isVisible: () => visible });
    vi.advanceTimersByTime(PREVIEW_LINK_REFRESH_AT_MS - 1);
    visible = false;
    vi.advanceTimersByTime(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("cancels the timer on cleanup", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onRefresh = vi.fn();
    const stop = watchPreviewLink({ issuedAt: 0, onRefresh });
    stop();
    vi.advanceTimersByTime(PREVIEW_LINK_REFRESH_AT_MS);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("retries a failed refresh at 5s, 15s, and 30s, then shows the error state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(PREVIEW_LINK_BACKOFF_MS).toEqual([5_000, 15_000, 30_000]);
    expect(PREVIEW_LINK_REFRESH_RETRY_LIMIT).toBe(3);
    const onRefresh = vi.fn(async () => {
      throw new Error("offline");
    });
    const onExhausted = vi.fn();
    const stop = watchPreviewLink({ issuedAt: 0, onRefresh, onExhausted });

    await vi.advanceTimersByTimeAsync(PREVIEW_LINK_REFRESH_AT_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onExhausted).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(14_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(onRefresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(4);
    expect(onExhausted).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).toHaveBeenCalledTimes(4);
    stop();
  });

  it("stops the backoff after a retry succeeds and does not retry while hidden", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visible = true;
    let issuedAt = 0;
    let onChange = () => {};
    const onRefresh = vi.fn(async () => {
      if (onRefresh.mock.calls.length === 1) throw new Error("offline");
      issuedAt = Date.now();
    });
    const onExhausted = vi.fn();
    const stop = watchPreviewLink({
      issuedAt: 0,
      getIssuedAt: () => issuedAt,
      onRefresh,
      onExhausted,
      isVisible: () => visible,
      listen: (listener) => {
        onChange = listener;
        return () => undefined;
      },
    });

    await vi.advanceTimersByTimeAsync(PREVIEW_LINK_REFRESH_AT_MS);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    visible = false;
    onChange();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    visible = true;
    onChange();
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onExhausted).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PREVIEW_LINK_REFRESH_AT_MS - 1_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(3);
    expect(onExhausted).not.toHaveBeenCalled();
    stop();
  });

  it("finishes a backoff that was paused when the tab returns early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let visible = true;
    let onChange = () => {};
    const onRefresh = vi.fn(async () => {
      throw new Error("offline");
    });
    const stop = watchPreviewLink({
      issuedAt: 0,
      onRefresh,
      onExhausted: () => undefined,
      isVisible: () => visible,
      listen: (listener) => {
        onChange = listener;
        return () => undefined;
      },
    });

    await vi.advanceTimersByTimeAsync(PREVIEW_LINK_REFRESH_AT_MS);
    await vi.advanceTimersByTimeAsync(2_000);
    visible = false;
    onChange();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    visible = true;
    onChange();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not retry an aborted refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onRefresh = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const onExhausted = vi.fn();
    const stop = watchPreviewLink({ issuedAt: 0, onRefresh, onExhausted });

    await vi.advanceTimersByTimeAsync(PREVIEW_LINK_REFRESH_AT_MS);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onExhausted).not.toHaveBeenCalled();
    stop();
  });
});
