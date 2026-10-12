"use client";

import { useEffect, useState } from "react";
import { PREVIEW_LONG_WAIT_MS } from "@/lib/flow/preview-progress";

/**
 * True only after this page has seen `progress.step === "translating"` for
 * {@link PREVIEW_LONG_WAIT_MS}. The clock starts at first observation and
 * survives a reload of the same token. The API `delayed` flag is ignored:
 * a retry can set it before 15 minutes have passed.
 */
export function usePreviewLate(
  token: string,
  progressStep: string | null | undefined,
  ready: boolean,
): boolean {
  const [lateToken, setLateToken] = useState<string | null>(null);

  useEffect(() => {
    if (!token || progressStep !== "translating" || ready) return;
    const key = `credpronto-translating-since:${token}`;
    const stored = Number(sessionStorage.getItem(key));
    const hasStored = Number.isFinite(stored) && stored > 0;
    const started = hasStored ? stored : Date.now();
    if (!hasStored) sessionStorage.setItem(key, String(started));
    const remaining = Math.max(0, PREVIEW_LONG_WAIT_MS - (Date.now() - started));
    const id = window.setTimeout(() => setLateToken(token), remaining);
    return () => window.clearTimeout(id);
  }, [token, progressStep, ready]);

  return lateToken === token && progressStep === "translating" && !ready;
}
