import { beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "@/lib/auth/session";
import { GCS_PIN_COOKIE, gcsPinSessionToken } from "@/lib/gcs/pin";
import { getOrder } from "./customer";
import * as db from "./db";
import type { PreviewOrderRow } from "./db";
import { HttpError } from "./errors";
import { orderForPreview, orderForToken } from "./order-access";
import * as pipeline from "./pipeline";
import type { Db } from "./storage";
import * as storage from "./storage";
import { generateOrderToken } from "./token";
import type { CustomerOrder } from "./view";
import type { OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";

const pinCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get(name: string) {
      if (name !== "gcs_translate_pin" || pinCookie.value == null) return undefined;
      return { value: pinCookie.value };
    },
  }),
}));

function gcsOrder(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    userId: null,
    brand: "gcs",
    status: "preview_ready",
    serviceType: "translation",
    orderType: "translation",
    targetLanguage: "en",
    ...patch,
  } as OrderRecord;
}

function previewOrder(patch: Partial<PreviewOrderRow> = {}): PreviewOrderRow {
  return {
    id: orderId,
    userId: null,
    status: "preview_ready",
    totalCents: 0,
    unitPriceCents: 0,
    billablePages: 2,
    combinedOriginalPath: `${orderId}/original.pdf`,
    service: null,
    orderType: "translation",
    evaluationCents: null,
    translationCents: 0,
    includeTranslation: false,
    evaluationPageCount: null,
    degreeCount: null,
    addonCents: 0,
    brand: "gcs",
    ...patch,
  };
}

describe("GCS order id access", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pinCookie.value = undefined;
    delete process.env.GCS_TRANSLATE_PIN;
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as Db);
    expect(GCS_PIN_COOKIE).toBe("gcs_translate_pin");
  });

  it("loads a GCS order by UUID when the PIN cookie is valid and there is no session", async () => {
    pinCookie.value = gcsPinSessionToken();
    const requireUser = vi.spyOn(session, "requireUser").mockRejectedValue(new HttpError("Sign in required", 401));
    vi.spyOn(db, "getOrderById").mockResolvedValue(gcsOrder());
    vi.spyOn(db, "getPreviewOrderById").mockResolvedValue(previewOrder());

    const owned = await orderForToken(orderId);
    const preview = await orderForPreview(orderId);

    expect(owned.order.id).toBe(orderId);
    expect(owned.order.brand).toBe("gcs");
    expect(preview.order.id).toBe(orderId);
    expect(requireUser).toHaveBeenCalled();
  });

  it("getOrder uses that UUID grant for the status payload", async () => {
    pinCookie.value = gcsPinSessionToken();
    vi.spyOn(session, "requireUser").mockRejectedValue(new HttpError("Sign in required", 401));
    vi.spyOn(db, "getOrderById").mockResolvedValue(gcsOrder({ sourceLanguage: "es" }));
    const loaded = { orderId, status: "preview_ready", sourceLanguage: "es", targetLanguage: "en" } as CustomerOrder;
    vi.spyOn(pipeline, "loadCustomerOrder").mockResolvedValue(loaded);

    await expect(getOrder(orderId)).resolves.toBe(loaded);
  });

  it("rejects a GCS UUID when the PIN cookie is missing", async () => {
    vi.spyOn(session, "requireUser").mockRejectedValue(new HttpError("Sign in required", 401));
    vi.spyOn(db, "getOrderById").mockResolvedValue(gcsOrder());
    vi.spyOn(db, "getPreviewOrderById").mockResolvedValue(previewOrder());

    await expect(orderForToken(orderId)).rejects.toMatchObject({ status: 401, message: "Sign in required" });
    await expect(orderForPreview(orderId)).rejects.toMatchObject({ status: 401 });
    await expect(getOrder(orderId)).rejects.toMatchObject({ status: 401 });
  });

  it("does not let the GCS PIN open an order from another brand", async () => {
    pinCookie.value = gcsPinSessionToken();
    vi.spyOn(session, "requireUser").mockRejectedValue(new HttpError("Sign in required", 401));
    vi.spyOn(db, "getOrderById").mockResolvedValue(gcsOrder({ brand: "credpronto" }));
    vi.spyOn(db, "getPreviewOrderById").mockResolvedValue(previewOrder({ brand: "credpronto" }));

    await expect(orderForToken(orderId)).rejects.toMatchObject({ status: 401 });
    await expect(orderForPreview(orderId)).rejects.toMatchObject({ status: 401 });
  });

  it("still lets the signed-in owner open a non-GCS order by id", async () => {
    pinCookie.value = gcsPinSessionToken();
    vi.spyOn(session, "requireUser").mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      emailVerified: true,
    });
    vi.spyOn(db, "getOrderById").mockResolvedValue(gcsOrder({ brand: "credpronto", userId: "user-1" }));
    vi.spyOn(db, "getPreviewOrderById").mockResolvedValue(previewOrder({ brand: "credpronto", userId: "user-1" }));

    await expect(orderForToken(orderId)).resolves.toMatchObject({ order: { id: orderId, userId: "user-1" } });
    await expect(orderForPreview(orderId)).resolves.toMatchObject({ order: { userId: "user-1" } });

    vi.mocked(db.getOrderById).mockResolvedValue(gcsOrder({ brand: "credpronto", userId: "someone-else" }));
    await expect(orderForToken(orderId)).rejects.toMatchObject({ status: 404, message: "Order not found" });
  });

  it("still accepts an email-link token without a PIN or a session", async () => {
    const requireUser = vi.spyOn(session, "requireUser").mockRejectedValue(new HttpError("Sign in required", 401));
    const token = generateOrderToken();
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(gcsOrder());
    vi.spyOn(db, "requirePreviewOrderByHash").mockResolvedValue(previewOrder());

    await expect(orderForToken(token)).resolves.toMatchObject({ order: { id: orderId } });
    await expect(orderForPreview(token)).resolves.toMatchObject({ order: { id: orderId } });
    expect(requireUser).not.toHaveBeenCalled();
  });
});
