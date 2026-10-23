import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockStaffDetail } from "@/lib/account/mock-data";
import {
  claimOrderCorrection,
  getOrderCorrection,
  getOrderMailing,
  getOrderNotarization,
  mailingPatchFrom,
  parseCorrectionView,
  parseMailingView,
  parseNotarizationView,
  patchOrderMailing,
  patchOrderNotarization,
  resetMockOrderFulfillment,
  runCorrectionUpload,
  saveOrderMailing,
  submitFixedPdf,
  uploadOrderCorrectionFinal,
  fixedPdfFileError,
  type FinalCorrection,
  type MailingView,
  type NotarizationView,
} from "@/lib/api/order-fulfillment";
import { MAX_FILE_BYTES } from "@/lib/orders/constants";
import { CorrectionSection, MailingSection, NotarizationSection } from "./order-fulfillment";
import { OrderStudio } from "./order-studio";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/orders/CP-24790",
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function PreviewStub() {
      return null;
    },
}));

vi.mock("@/lib/account/actions", () => ({
  signOut: () => undefined,
}));

const ORDER_ID = "28492f38-1111-4111-8111-111111111111";

const OPEN_CORRECTION: FinalCorrection = {
  id: "corr-1",
  orderId: ORDER_ID,
  text: "The date on the diploma is wrong.",
  status: "open",
  finalPath: null,
  finalVersion: null,
  claimedAt: null,
  fixedAt: null,
  createdAt: "2026-10-23T15:00:00.000Z",
};

const CLAIM = {
  id: "corr-1",
  orderId: ORDER_ID,
  status: "in_progress" as const,
  claimedAt: "2026-10-23T16:00:00.000Z",
};

const UPLOAD = {
  id: "corr-1",
  orderId: ORDER_ID,
  status: "fixed" as const,
  bucket: "finals",
  finalPath: `${ORDER_ID}/certified-translation-v2.pdf`,
  finalVersion: 2,
  fixedAt: "2026-10-23T16:05:00.000Z",
};

const MAILING: MailingView = {
  needed: true,
  address: {
    name: "Ada Lovelace",
    line1: "2520 Venture Oaks Way",
    line2: null,
    city: "Sacramento",
    state: "CA",
    postalCode: "95833",
    country: "US",
  },
  carrier: null,
  trackingNumber: null,
  shipped: false,
  shippedAt: null,
};

const NOTARIZATION: NotarizationView = { needed: true, status: "pending" };

function pdf(name = "fixed.pdf"): File {
  return new File(["%PDF"], name, { type: "application/pdf" });
}

afterEach(() => {
  resetMockOrderFulfillment();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fulfillment response shapes", () => {
  it("reads a correction, or none", () => {
    expect(parseCorrectionView({ correction: null })).toEqual({ correction: null });
    expect(parseCorrectionView({ correction: OPEN_CORRECTION })).toEqual({ correction: OPEN_CORRECTION });
    expect(parseCorrectionView({ correction: { text: "missing fields" } })).toBeNull();
    expect(parseNotarizationView({ needed: true, status: "notarized" })).toEqual({
      needed: true,
      status: "notarized",
    });
    expect(parseNotarizationView({ needed: false, status: null })).toEqual({ needed: false, status: null });
    expect(parseNotarizationView({ needed: true, status: "shipped" })).toBeNull();
    expect(parseMailingView(MAILING)).toEqual(MAILING);
    expect(parseMailingView({ needed: false })).toBeNull();
  });

  it("builds a mailing patch from the editable fields", () => {
    expect(
      mailingPatchFrom({
        name: "Ada Lovelace",
        line1: "2520 Venture Oaks Way",
        line2: "",
        city: "Sacramento",
        state: "ca",
        postalCode: "95833",
        country: "us",
        carrier: " USPS ",
        trackingNumber: "9400111899223856927645",
        shipped: true,
      }),
    ).toEqual({
      ok: true,
      body: {
        address: { ...MAILING.address, line2: null },
        carrier: "USPS",
        trackingNumber: "9400111899223856927645",
        shipped: true,
      },
    });
    expect(mailingPatchFrom({ ...blankDraft(), country: "CA" })).toMatchObject({
      ok: false,
      error: "Mail requires a US shipping address",
    });
  });

  it("rejects an empty file, a non-PDF, and a file over 25MB", () => {
    expect(fixedPdfFileError(null)).toBe("Choose a PDF.");
    expect(fixedPdfFileError(new File(["notes"], "notes.txt", { type: "text/plain" }))).toBe("Upload a PDF");
    expect(fixedPdfFileError(new File([], "empty.pdf", { type: "application/pdf" }))).toBe("Empty files are not accepted");
    const huge = new File(["%PDF"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(huge, "size", { value: MAX_FILE_BYTES + 1 });
    expect(fixedPdfFileError(huge)).toBe("Each file must be 25MB or smaller");
    expect(fixedPdfFileError(pdf())).toBeNull();
  });
});

describe("fixed PDF upload", () => {
  it("claims an open correction and then uploads the PDF", async () => {
    const order: string[] = [];
    const claim = vi.fn(async () => {
      order.push("claim");
      return { ok: true as const, status: 200, data: CLAIM };
    });
    const upload = vi.fn(async () => {
      order.push("upload");
      return { ok: true as const, status: 200, data: UPLOAD };
    });
    const result = await submitFixedPdf({ orderId: ORDER_ID, status: "open", file: pdf() }, { claim, upload });
    expect(order).toEqual(["claim", "upload"]);
    expect(result).toEqual({ ok: true, claim: CLAIM, upload: UPLOAD });
  });

  it("does not upload when the claim returns 409", async () => {
    const upload = vi.fn();
    const outcome = await runCorrectionUpload(
      { orderId: ORDER_ID, correction: OPEN_CORRECTION, file: pdf() },
      {
        claim: async () => ({ ok: false, status: 409, error: "This correction is not open" }),
        upload,
      },
    );
    expect(upload).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      correction: OPEN_CORRECTION,
      error: "This correction is not open",
      message: null,
    });
  });

  it("uploads without claiming again when the correction is already in progress", async () => {
    const claim = vi.fn();
    const result = await submitFixedPdf(
      { orderId: ORDER_ID, status: "in_progress", file: pdf() },
      { claim, upload: async () => ({ ok: true, status: 200, data: UPLOAD }) },
    );
    expect(claim).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, claim: null, upload: UPLOAD });
  });

  it("keeps the claim when the upload fails, so the next try does not claim again", async () => {
    const outcome = await runCorrectionUpload(
      { orderId: ORDER_ID, correction: OPEN_CORRECTION, file: pdf() },
      {
        claim: async () => ({ ok: true, status: 200, data: CLAIM }),
        upload: async () => ({ ok: false, status: 415, error: "Upload a PDF" }),
      },
    );
    expect(outcome.correction.status).toBe("in_progress");
    expect(outcome.correction.claimedAt).toBe(CLAIM.claimedAt);
    expect(outcome.error).toBe("Upload a PDF");
    expect(outcome.message).toBeNull();
  });

  it("posts the claim and the PDF to the staff routes", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    const file = pdf();
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ?? null });
        if (String(url).endsWith("/claim")) return Response.json(CLAIM);
        if (String(url).endsWith("/final")) return Response.json(UPLOAD);
        return Response.json({ correction: OPEN_CORRECTION });
      }),
    );

    const read = await getOrderCorrection("ord/1");
    const outcome = await runCorrectionUpload({ orderId: "ord/1", correction: OPEN_CORRECTION, file });

    expect(read).toMatchObject({ ok: true, data: { correction: OPEN_CORRECTION } });
    expect(outcome.correction.status).toBe("fixed");
    expect(outcome.correction.finalPath).toBe(UPLOAD.finalPath);
    expect(outcome.message).toBe("Fixed PDF uploaded.");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/admin/orders/ord%2F1/correction",
      "POST /api/admin/orders/ord%2F1/correction/claim",
      "POST /api/admin/orders/ord%2F1/correction/final",
    ]);
    const uploadCall = calls[2];
    expect(uploadCall?.body).toBeInstanceOf(FormData);
    expect((uploadCall?.body as FormData).get("file")).toBe(file);
    expect(calls[1]?.body).toBeNull();
  });

  it("stops after a 409 from the claim route", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).endsWith("/final")) throw new Error("upload ran after 409");
        return Response.json({ error: "This correction is not open" }, { status: 409 });
      }),
    );
    const outcome = await runCorrectionUpload({ orderId: ORDER_ID, correction: OPEN_CORRECTION, file: pdf() });
    expect(outcome.error).toBe("This correction is not open");
    expect(outcome.correction.status).toBe("open");
    expect(urls).toEqual([`/api/admin/orders/${ORDER_ID}/correction/claim`]);
  });
});

describe("notarization and mailing requests", () => {
  it("patches status, address, carrier, tracking, and shipped", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        if (String(url).endsWith("/notarization")) {
          return Response.json({ needed: true, status: "notarized" });
        }
        return Response.json({ ...MAILING, carrier: "USPS", trackingNumber: "9400", shipped: true, shippedAt: "2026-10-23T16:00:00.000Z" });
      }),
    );

    const notarization = await patchOrderNotarization(ORDER_ID, { status: "notarized" });
    const mailing = await saveOrderMailing(ORDER_ID, {
      name: "Ada Lovelace",
      line1: "2520 Venture Oaks Way",
      line2: "",
      city: "Sacramento",
      state: "CA",
      postalCode: "95833",
      country: "US",
      carrier: "USPS",
      trackingNumber: "9400",
      shipped: true,
    });

    expect(notarization).toMatchObject({ ok: true, data: { needed: true, status: "notarized" } });
    expect(mailing).toMatchObject({ ok: true, data: { shipped: true, carrier: "USPS" } });
    expect(bodies[0]).toEqual({ status: "notarized" });
    expect(bodies[1]).toMatchObject({ carrier: "USPS", trackingNumber: "9400", shipped: true });
  });

  it("does not send a mailing patch when the address is not a US address", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveOrderMailing(ORDER_ID, { ...blankDraft(), name: "Ada", country: "MX" });
    expect(result).toMatchObject({ ok: false, status: 400, error: "Mail requires a US shipping address" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads notarization and mailing", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return Response.json({ error: "This order has no mail add-on" }, { status: 409 });
        if (String(url).endsWith("/notarization")) return Response.json(NOTARIZATION);
        if (String(url).endsWith("/mailing")) return Response.json(MAILING);
        return Response.json({ error: "nope" }, { status: 404 });
      }),
    );
    expect(await getOrderNotarization(ORDER_ID)).toMatchObject({ ok: true, data: NOTARIZATION });
    expect(await getOrderMailing(ORDER_ID)).toMatchObject({ ok: true, data: MAILING });
    const missing = await patchOrderMailing(ORDER_ID, {
      address: MAILING.address!,
      carrier: null,
      trackingNumber: null,
      shipped: false,
    });
    expect(missing).toMatchObject({ ok: false, status: 409, error: "This order has no mail add-on" });
  });
});

describe("mock staff orders", () => {
  it("shows a correction on the paid order and empty fulfillment everywhere else", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "1");
    const paid = await getOrderCorrection("CP-24790");
    const empty = await getOrderCorrection("CP-24817");
    const notarization = await getOrderNotarization("CP-24817");
    const mailing = await getOrderMailing("CP-24817");
    expect(paid).toMatchObject({
      ok: true,
      data: { correction: { status: "open", text: "The date on the diploma is wrong." } },
    });
    expect(empty).toEqual({ ok: true, status: 200, data: { correction: null } });
    expect(notarization).toEqual({ ok: true, status: 200, data: { needed: false, status: null } });
    expect(mailing).toMatchObject({ ok: true, data: { needed: false, address: null, shipped: false } });
  });

  it("returns 409 for a second claim and for an order another worker already claimed", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "1");
    const first = await claimOrderCorrection("CP-24790");
    const second = await claimOrderCorrection("CP-24790");
    const raced = await getOrderCorrection("CP-24902");
    const lost = await runCorrectionUpload({
      orderId: "CP-24902",
      correction: raced.ok && raced.data.correction ? raced.data.correction : OPEN_CORRECTION,
      file: pdf(),
    });
    const stillOpen = await getOrderCorrection("CP-24902");
    expect(first).toMatchObject({ ok: true, data: { status: "in_progress" } });
    expect(second).toEqual({ ok: false, status: 409, error: "This correction is not open" });
    expect(lost.error).toBe("This correction is not open");
    expect(lost.correction.status).toBe("open");
    expect(stillOpen).toMatchObject({ ok: true, data: { correction: { status: "open", finalPath: null } } });
    const early = await uploadOrderCorrectionFinal("CP-24817", pdf());
    expect(early).toMatchObject({ ok: false, status: 404 });
  });
});

describe("order fulfillment sections", () => {
  it("shows an empty state when the order has no correction and does not need notarization or mailing", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(CorrectionSection, {
          state: { status: "ready", data: null },
          pending: null,
          error: null,
          message: null,
          onUpload: () => undefined,
        }),
        createElement(NotarizationSection, {
          state: { status: "ready", data: { needed: false, status: null } },
          pending: null,
          error: null,
          message: null,
          onStatus: () => undefined,
        }),
        createElement(MailingSection, {
          state: { status: "ready", data: { ...MAILING, needed: false, address: null } },
          pending: null,
          error: null,
          message: null,
          onSave: () => undefined,
        }),
      ),
    );
    expect(html).toContain("Corrections");
    expect(html).toContain("This order has no correction.");
    expect(html).toContain("This order does not need notarization.");
    expect(html).toContain("This order does not need mailing.");
    expect(html).toContain("border-line");
    expect(html).toContain("bg-white");
    expect(html).not.toContain("correction-file");
    expect(html).not.toContain("notarization-status");
    expect(html).not.toContain("mailing-save");
  });

  it("shows the request, its status, and the upload that claims before storing the PDF", () => {
    const html = renderToStaticMarkup(
      createElement(CorrectionSection, {
        state: { status: "ready", data: OPEN_CORRECTION },
        pending: null,
        error: "This correction is not open",
        message: null,
        onUpload: () => undefined,
      }),
    );
    expect(html).toContain("The date on the diploma is wrong.");
    expect(html).toContain("Status: open");
    expect(html).toContain("Uploading claims this correction, then stores the fixed PDF.");
    expect(html).toContain('data-testid="correction-upload"');
    expect(html).toContain("Upload fixed PDF");
    expect(html).toContain("This correction is not open");
    expect(html).toContain('role="alert"');
  });

  it("hides the upload once the correction is fixed", () => {
    const html = renderToStaticMarkup(
      createElement(CorrectionSection, {
        state: {
          status: "ready",
          data: { ...OPEN_CORRECTION, status: "fixed", finalPath: UPLOAD.finalPath, finalVersion: 2, fixedAt: UPLOAD.fixedAt },
        },
        pending: null,
        error: null,
        message: "Fixed PDF uploaded.",
        onUpload: () => undefined,
      }),
    );
    expect(html).toContain("Status: fixed");
    expect(html).toContain(UPLOAD.finalPath);
    expect(html).toContain("Fixed PDF uploaded.");
    expect(html).not.toContain("correction-upload");
  });

  it("lets staff set notarization to pending, notarized, or done", () => {
    const html = renderToStaticMarkup(
      createElement(NotarizationSection, {
        state: { status: "ready", data: NOTARIZATION },
        pending: null,
        error: null,
        message: null,
        onStatus: () => undefined,
      }),
    );
    expect(html).toContain("Needed");
    expect(html).toContain('data-testid="notarization-status"');
    expect(html).toContain('value="pending"');
    expect(html).toContain('value="notarized"');
    expect(html).toContain('value="done"');
  });

  it("renders an editable address, carrier, tracking number, and shipped toggle", () => {
    const html = renderToStaticMarkup(
      createElement(MailingSection, {
        state: { status: "ready", data: MAILING },
        pending: null,
        error: null,
        message: null,
        onSave: () => undefined,
      }),
    );
    expect(html).toContain("Needed");
    expect(html).toContain('data-testid="mailing-name"');
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('data-testid="mailing-line1"');
    expect(html).toContain("2520 Venture Oaks Way");
    expect(html).toContain('data-testid="mailing-carrier"');
    expect(html).toContain('data-testid="mailing-tracking"');
    expect(html).toContain('data-testid="mailing-shipped"');
    expect(html).toContain("Save mailing");
    expect(html).toContain(">CA<");
  });

  it("keeps the three sections on the order page without changing the existing fulfillment copy", () => {
    const detail = mockStaffDetail("CP-24790");
    expect(detail).not.toBeNull();
    const html = renderToStaticMarkup(createElement(OrderStudio, { detail: detail!, notes: [], notesError: null }));
    expect(html).toContain('data-testid="order-fulfillment"');
    expect(html).toContain('data-testid="final-correction"');
    expect(html).toContain('data-testid="order-notarization"');
    expect(html).toContain('data-testid="order-mailing"');
    expect(html).toContain("Customer corrections");
    expect(html).toContain("No correction requests.");
    expect(html).toContain("Mark shipped");
    expect(html).toContain("Mark done");
    expect(html).toContain(">Mailing</h2>");
    expect(html).toContain(">Notarization</h2>");
  });
});

function blankDraft() {
  return {
    name: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "US",
    carrier: "",
    trackingNumber: "",
    shipped: false,
  };
}
