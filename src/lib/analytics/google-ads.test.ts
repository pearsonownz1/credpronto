import { afterEach, describe, expect, it } from "vitest";
import {
  CONVERSION_POLL_MS,
  GA_MEASUREMENT_ID,
  GOOGLE_ADS_ID,
  claimConversion,
  claimOrderEvent,
  decideConversion,
  gaMeasurementId,
  googleAdsConversionLabel,
  googleAdsId,
  googleAdsInlineSnippet,
  googleAdsScriptSrc,
  knownPageCount,
  previewReadyEventParams,
  readOrderPayment,
  trackPaidOrderConversion,
  uploadEventParams,
  type GoogleAdsConversion,
} from "./google-ads";

const LABEL = "purchaseLabel";

function paid(totalCents: number | null = 1990, paymentStatus: string | null = "paid") {
  return { orderId: "order-1", totalCents, paymentStatus };
}

describe("google ads id", () => {
  const previous = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  const previousMeasurement = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
    else process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = previous;
    if (previousMeasurement === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = previousMeasurement;
  });

  it("defaults to the CredPronto ads account and GA4 property", () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    expect(GOOGLE_ADS_ID).toBe("AW-18508202440");
    expect(googleAdsId()).toBe("AW-18508202440");
    expect(GA_MEASUREMENT_ID).toBe("G-2EML0MR9XN");
    expect(gaMeasurementId()).toBe("G-2EML0MR9XN");
    expect(googleAdsScriptSrc()).toBe(
      "https://www.googletagmanager.com/gtag/js?id=AW-18508202440",
    );
    expect(googleAdsInlineSnippet()).toBe(
      "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','AW-18508202440');gtag('config','G-2EML0MR9XN');",
    );
  });

  it("uses a valid NEXT_PUBLIC_GOOGLE_ADS_ID override", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = " AW-999 ";
    expect(googleAdsId()).toBe("AW-999");
    expect(googleAdsInlineSnippet(googleAdsId())).toContain("gtag('config','AW-999')");
    expect(googleAdsInlineSnippet(googleAdsId())).toContain("gtag('config','G-2EML0MR9XN')");
  });

  it("ignores a blank or malformed override", () => {
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "  ";
    expect(googleAdsId()).toBe(GOOGLE_ADS_ID);
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "G-123";
    expect(googleAdsId()).toBe(GOOGLE_ADS_ID);
  });
});

describe("ga measurement id", () => {
  const previous = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const previousAds = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = previous;
    if (previousAds === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
    else process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = previousAds;
  });

  it("defaults to the CredPronto GA4 property", () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    expect(GA_MEASUREMENT_ID).toBe("G-2EML0MR9XN");
    expect(gaMeasurementId()).toBe("G-2EML0MR9XN");
  });

  it("uses a valid NEXT_PUBLIC_GA_MEASUREMENT_ID override beside the ads tag", () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = " G-OVERRIDE1 ";
    expect(gaMeasurementId()).toBe("G-OVERRIDE1");
    const snippet = googleAdsInlineSnippet(googleAdsId(), gaMeasurementId());
    expect(snippet).toContain("gtag('config','AW-18508202440')");
    expect(snippet).toContain("gtag('config','G-OVERRIDE1')");
  });

  it("ignores a blank or malformed measurement id", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "  ";
    expect(gaMeasurementId()).toBe(GA_MEASUREMENT_ID);
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "AW-18508202440";
    expect(gaMeasurementId()).toBe(GA_MEASUREMENT_ID);
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-";
    expect(gaMeasurementId()).toBe(GA_MEASUREMENT_ID);
  });
});

describe("conversion label", () => {
  const previousPurchase = process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL;
  const previousFallback = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL;

  afterEach(() => {
    if (previousPurchase === undefined) delete process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL;
    else process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL = previousPurchase;
    if (previousFallback === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL;
    else process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL = previousFallback;
  });

  it("is unset when both env vars are missing or blank", () => {
    delete process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL;
    delete process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL;
    expect(googleAdsConversionLabel()).toBeNull();
    process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL = "  ";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL = "  ";
    expect(googleAdsConversionLabel()).toBeNull();
  });

  it("reads a trimmed fallback label", () => {
    delete process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL;
    process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL = " abc_123 ";
    expect(googleAdsConversionLabel()).toBe("abc_123");
  });

  it("prefers NEXT_PUBLIC_GADS_PURCHASE_LABEL over the fallback", () => {
    process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL = " purchase ";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL = "fallback";
    expect(googleAdsConversionLabel()).toBe("purchase");
  });

  it("uses the fallback when the purchase label is blank", () => {
    process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL = " ";
    process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL = "fallback";
    expect(googleAdsConversionLabel()).toBe("fallback");
  });
});

describe("decideConversion", () => {
  it("sends the order total in dollars for a paid order", () => {
    expect(decideConversion(paid(1990), GOOGLE_ADS_ID, LABEL)).toEqual({
      action: "fire",
      payload: {
        send_to: "AW-18508202440/purchaseLabel",
        value: 19.9,
        currency: "USD",
        transaction_id: "order-1",
      },
    });
    expect(decideConversion(paid(995), GOOGLE_ADS_ID, LABEL)).toMatchObject({
      action: "fire",
      payload: { value: 9.95, currency: "USD", transaction_id: "order-1" },
    });
  });

  it("skips when the label is unset, the total is missing, or the payment is not paid", () => {
    expect(decideConversion(paid(), GOOGLE_ADS_ID, null)).toEqual({ action: "skip" });
    expect(decideConversion(paid(null), GOOGLE_ADS_ID, LABEL)).toEqual({ action: "skip" });
    for (const status of ["paid_test", "failed", "canceled", "expired", "refunded"]) {
      expect(decideConversion(paid(1990, status), GOOGLE_ADS_ID, LABEL)).toEqual({
        action: "skip",
      });
    }
  });

  it("waits while Stripe has not recorded the payment yet", () => {
    expect(decideConversion(paid(1990, "pending"), GOOGLE_ADS_ID, LABEL)).toEqual({
      action: "wait",
    });
    expect(decideConversion(paid(1990, null), GOOGLE_ADS_ID, LABEL)).toEqual({
      action: "wait",
    });
  });
});

describe("readOrderPayment", () => {
  it("reads the order id, total, and payment status from the API body", () => {
    expect(
      readOrderPayment({
        orderId: "order-1",
        totalCents: 995,
        payment: { status: "paid" },
        status: "paid",
      }),
    ).toEqual({ orderId: "order-1", totalCents: 995, paymentStatus: "paid" });
  });

  it("treats a missing payment as unpaid", () => {
    expect(readOrderPayment({ orderId: "order-1", totalCents: 995, payment: null })).toEqual({
      orderId: "order-1",
      totalCents: 995,
      paymentStatus: null,
    });
  });

  it("rejects a body without an order id", () => {
    expect(readOrderPayment(null)).toBeNull();
    expect(readOrderPayment({ totalCents: 1 })).toBeNull();
  });
});

describe("claimConversion", () => {
  it("records each order once in the store", () => {
    const store = new Map<string, string>();
    const memory = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(claimConversion("order-1", memory)).toBe(true);
    expect(claimConversion("order-1", memory)).toBe(false);
    expect(claimConversion("order-2", memory)).toBe(true);
    expect(store.get("credpronto:google-ads-conversion:order-1")).toBe("1");
  });

  it("dedupes upload and preview_ready separately from the purchase conversion", () => {
    const store = new Map<string, string>();
    const memory = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(claimOrderEvent("upload", "order-1", memory)).toBe(true);
    expect(claimOrderEvent("upload", "order-1", memory)).toBe(false);
    expect(claimOrderEvent("preview_ready", "order-1", memory)).toBe(true);
    expect(claimOrderEvent("conversion", "order-1", memory)).toBe(true);
    expect(store.get("credpronto:google-ads-upload:order-1")).toBe("1");
    expect(store.get("credpronto:google-ads-preview-ready:order-1")).toBe("1");
  });
});

describe("secondary events", () => {
  it("includes page count on upload only when it is known", () => {
    expect(knownPageCount([1, 2])).toBe(3);
    expect(knownPageCount([1, null])).toBeNull();
    expect(knownPageCount([])).toBeNull();
    expect(uploadEventParams("order-1", 3)).toEqual({ order_id: "order-1", page_count: 3 });
    expect(uploadEventParams("order-1", null)).toEqual({ order_id: "order-1" });
  });

  it("builds a preview_ready event the first time that status is seen", () => {
    expect(
      previewReadyEventParams({ orderId: "order-1", status: "processing", totalCents: 1990 }),
    ).toBeNull();
    expect(
      previewReadyEventParams({ orderId: "order-1", status: "preview_ready", totalCents: 1990 }),
    ).toEqual({ order_id: "order-1", value: 19.9, currency: "USD" });
    expect(
      previewReadyEventParams({ orderId: "order-1", status: "preview_ready", totalCents: null }),
    ).toEqual({ order_id: "order-1", currency: "USD" });
  });
});

describe("trackPaidOrderConversion", () => {
  it("does not fetch when the conversion label is unset", async () => {
    let fetched = false;
    await trackPaidOrderConversion({
      token: "token",
      adsId: GOOGLE_ADS_ID,
      label: null,
      signal: new AbortController().signal,
      fetchOrder: async () => {
        fetched = true;
        return null;
      },
      claim: () => true,
      push: () => {},
      sleep: async () => {},
    });
    expect(fetched).toBe(false);
  });

  it("waits until the order is paid, then pushes one conversion", async () => {
    const bodies = [
      { orderId: "order-9", totalCents: 995, payment: { status: "pending" } },
      { orderId: "order-9", totalCents: 995, payment: { status: "paid" } },
    ];
    const pushed: GoogleAdsConversion[] = [];
    const claimed: string[] = [];
    let sleeps = 0;

    await trackPaidOrderConversion({
      token: "raw token",
      adsId: GOOGLE_ADS_ID,
      label: LABEL,
      signal: new AbortController().signal,
      fetchOrder: async () => bodies.shift() ?? null,
      claim: (orderId) => {
        claimed.push(orderId);
        return true;
      },
      push: (payload) => pushed.push(payload),
      sleep: async (ms) => {
        sleeps += 1;
        expect(ms).toBe(CONVERSION_POLL_MS);
      },
    });

    expect(sleeps).toBe(1);
    expect(claimed).toEqual(["order-9"]);
    expect(pushed).toEqual([
      {
        send_to: "AW-18508202440/purchaseLabel",
        value: 9.95,
        currency: "USD",
        transaction_id: "order-9",
      },
    ]);
  });

  it("does not push when the order was already claimed", async () => {
    const pushed: GoogleAdsConversion[] = [];
    await trackPaidOrderConversion({
      token: "token",
      adsId: GOOGLE_ADS_ID,
      label: LABEL,
      signal: new AbortController().signal,
      fetchOrder: async () => ({
        orderId: "order-9",
        totalCents: 995,
        payment: { status: "paid" },
      }),
      claim: () => false,
      push: (payload) => pushed.push(payload),
      sleep: async () => {},
    });
    expect(pushed).toEqual([]);
  });

  it("stops when the order cannot be loaded", async () => {
    let sleeps = 0;
    await trackPaidOrderConversion({
      token: "missing",
      adsId: GOOGLE_ADS_ID,
      label: LABEL,
      signal: new AbortController().signal,
      fetchOrder: async () => null,
      claim: () => true,
      push: () => {
        throw new Error("should not push");
      },
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(sleeps).toBe(0);
  });

  it("retries a transient fetch error", async () => {
    let calls = 0;
    const pushed: string[] = [];
    await trackPaidOrderConversion({
      token: "token",
      adsId: GOOGLE_ADS_ID,
      label: LABEL,
      signal: new AbortController().signal,
      fetchOrder: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network");
        return { orderId: "order-9", totalCents: 100, payment: { status: "paid" } };
      },
      claim: () => true,
      push: (payload) => pushed.push(payload.transaction_id),
      sleep: async () => {},
    });
    expect(calls).toBe(2);
    expect(pushed).toEqual(["order-9"]);
  });
});
