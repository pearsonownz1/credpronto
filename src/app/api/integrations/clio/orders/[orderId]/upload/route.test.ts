import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRecord } from "@/lib/orders/types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const userId = "11111111-1111-4111-8111-111111111111";

const { requireUser, getOrderById, serviceDb } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getOrderById: vi.fn(),
  serviceDb: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/orders/db", () => ({ getOrderById }));
vi.mock("@/lib/orders/storage", () => ({ serviceDb }));
vi.mock("@/lib/orders/staff", () => ({ requireStaff: vi.fn() }));

import { POST } from "./route";

function linkedDb() {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    order_id: orderId,
                    user_id: userId,
                    region: "us",
                    matter_id: "123",
                    document_ids: ["1"],
                    upload_status: "pending",
                    upload_error: null,
                    clio_document_id: null,
                    uploaded_at: null,
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
}

function paidTranslation(): OrderRecord {
  return {
    id: orderId,
    userId,
    orderType: "translation",
    serviceType: "translation",
    service: null,
    services: ["translation"],
    includeTranslation: false,
    status: "paid",
    finalTranslationPath: "finals/certified.pdf",
    certificationPath: "finals/cert.pdf",
  } as OrderRecord;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: userId, email: "ada@example.com", emailVerified: true });
  serviceDb.mockReturnValue(linkedDb());
  getOrderById.mockResolvedValue(paidTranslation());
});

describe("POST /api/integrations/clio/orders/[orderId]/upload", () => {
  it("returns 409 before a translation is approved", async () => {
    const response = await POST(new Request("https://www.credpronto.com/api/integrations/clio/orders/" + orderId + "/upload", { method: "POST" }), {
      params: Promise.resolve({ orderId }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "This translation is not approved yet" });
  });
});
