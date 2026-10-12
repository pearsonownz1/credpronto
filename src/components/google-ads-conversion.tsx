"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
import {
  claimConversion,
  googleAdsConversionLabel,
  googleAdsId,
  trackPaidOrderConversion,
  type GoogleAdsConversion,
} from "@/lib/analytics/google-ads";

const claimedOrders = new Set<string>();

function claimOnce(orderId: string): boolean {
  if (claimedOrders.has(orderId)) return false;
  try {
    if (!claimConversion(orderId, sessionStorage)) {
      claimedOrders.add(orderId);
      return false;
    }
  } catch {
    // Private browsing can reject sessionStorage. The in-memory set still
    // stops a second fire during this page view.
  }
  claimedOrders.add(orderId);
  return true;
}

function pushConversion(payload: GoogleAdsConversion) {
  const dataLayer = (window.dataLayer = window.dataLayer || []);
  const gtag =
    typeof window.gtag === "function"
      ? window.gtag
      : (...args: unknown[]) => {
          dataLayer.push(args);
        };
  window.gtag = gtag;
  gtag("event", "conversion", payload);
}

async function fetchOrder(token: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/orders/${encodeURIComponent(token)}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (response.status >= 400 && response.status < 500) return null;
  if (!response.ok) throw new Error(`Order request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Stripe return only. Fires after GET /api/orders/{token} shows a paid order. */
export function GoogleAdsConversion({
  token,
  enabled,
}: {
  token: string;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled || !token) return;
    const label = googleAdsConversionLabel();
    if (!label) return;

    const controller = new AbortController();
    void trackPaidOrderConversion({
      token,
      adsId: googleAdsId(),
      label,
      signal: controller.signal,
      fetchOrder,
      claim: claimOnce,
      push: pushConversion,
      sleep,
    });

    return () => controller.abort();
  }, [enabled, token]);

  return null;
}
