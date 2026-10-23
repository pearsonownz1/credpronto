import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/lib/api/types";
import { presentOrder } from "./present";
import { applyOrderLanguages, attachDashboardLanguages } from "./order-languages";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function listed(id: string): CustomerOrder {
  return {
    id,
    status: "preview_ready",
    serviceType: "translation",
    totalCents: 1990,
    currency: "usd",
    billablePages: 2,
    unitPriceCents: 995,
    createdAt: "2026-10-11T12:00:00.000Z",
    previewAvailable: true,
    paymentStatus: null,
    downloadAvailable: false,
    sourceLanguage: null,
    targetLanguage: null,
  };
}

describe("dashboard language fields", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the order language, then a document language, and a dash when both are missing", () => {
    const [fromOrder, fromDocument, empty] = applyOrderLanguages(
      [listed("order-es"), listed("order-fr"), listed("order-none")],
      [
        { id: "order-es", source_language: "es", target_language: "en" },
        { id: "order-fr", source_language: null, target_language: "en" },
      ],
      [
        { order_id: "order-fr", detected_language: null, position: 0 },
        { order_id: "order-fr", detected_language: "fr", position: 1 },
      ],
    );
    expect(presentOrder(fromOrder, NOW).pair).toBe("Spanish → English");
    expect(presentOrder(fromDocument, NOW).pair).toBe("French → English");
    expect(presentOrder(empty, NOW).pair).toBe("—");
  });

  it("keeps a language the list already parsed", () => {
    const [kept] = applyOrderLanguages(
      [listed("order-es")],
      [{ id: "order-es", sourceLanguage: "es", targetLanguage: "en" }],
      [{ orderId: "order-es", detectedLanguage: "zh", position: 0 }],
    );
    const withListLanguage = { ...listed("order-es"), sourceLanguage: "pt", targetLanguage: "en" };
    const [unchanged] = applyOrderLanguages(
      [withListLanguage],
      [{ id: "order-es", source_language: "es", target_language: "es" }],
    );
    expect(presentOrder(kept, NOW).pair).toBe("Spanish → English");
    expect(presentOrder(unchanged, NOW).pair).toBe("Portuguese → English");
  });

  it("does not query in mock mode", async () => {
    vi.stubEnv("CREDPRONTO_MOCK", "1");
    const orders = [listed("order-es")];
    await expect(attachDashboardLanguages(orders)).resolves.toBe(orders);
  });
});
