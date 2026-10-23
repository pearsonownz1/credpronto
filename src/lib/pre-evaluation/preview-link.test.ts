import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_LINK_REFRESH_AT_MS,
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
});
