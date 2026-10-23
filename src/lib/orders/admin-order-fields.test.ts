import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseStaffDetail } from "@/lib/api/parse";
import { staffOrder } from "./admin";
import { adminOrderFields } from "./admin-order-fields";
import * as db from "./db";
import * as staff from "./staff";
import type { OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";

describe("admin order fields", () => {
  it("resolves services and lists one report per purchased evaluation", () => {
    const fields = adminOrderFields({
      id: orderId,
      services: null,
      service: "diploma",
      includeTranslation: true,
      serviceFiles: null,
    });

    expect(fields.services).toEqual(["translation", "diploma"]);
    expect(fields.includesTranslation).toBe(true);
    expect(fields.evaluationReports).toEqual([{ service: "diploma", uploaded: false }]);
  });

  it("marks an uploaded report with its file name and leaves a missing one without a file name", () => {
    const fields = adminOrderFields({
      id: orderId,
      services: ["translation", "diploma", "course_by_course"],
      includeTranslation: true,
      serviceFiles: { diploma: `${orderId}/diploma-evaluation.pdf` },
    });

    expect(fields.services).toEqual(["translation", "diploma", "course_by_course"]);
    expect(fields.includesTranslation).toBe(true);
    expect(fields.evaluationReports).toEqual([
      { service: "diploma", uploaded: true, fileName: "diploma-evaluation.pdf" },
      { service: "course_by_course", uploaded: false },
    ]);
    expect(fields.evaluationReports[1]).not.toHaveProperty("fileName");
  });

  it("treats a stored evaluation package as uploaded", () => {
    const fields = adminOrderFields(
      { id: orderId, service: "course_by_course", includeTranslation: false, serviceFiles: null },
      `${orderId}/evaluation.pdf`,
    );

    expect(fields.services).toEqual(["course_by_course"]);
    expect(fields.includesTranslation).toBe(false);
    expect(fields.evaluationReports).toEqual([
      { service: "course_by_course", uploaded: true, fileName: "evaluation.pdf" },
    ]);
  });

  it("leaves evaluation reports empty for a translation-only order", () => {
    expect(adminOrderFields({ service: null, includeTranslation: false })).toEqual({
      services: ["translation"],
      includesTranslation: true,
      evaluationReports: [],
    });
  });
});

describe("staffOrder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: {} as db.Db, userId: "staff-1", role: "admin" });
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      id: orderId,
      customerId: "customer-1",
      status: "paid",
      service: null,
      services: ["diploma", "course_by_course"],
      includeTranslation: false,
      serviceFiles: { course_by_course: `${orderId}/course_by_course-evaluation.pdf` },
      evaluationStatus: null,
    } as OrderRecord);
    vi.spyOn(db, "listDocuments").mockResolvedValue([]);
    vi.spyOn(db, "listPages").mockResolvedValue([]);
    vi.spyOn(db, "listTranslations").mockResolvedValue([]);
    vi.spyOn(db, "listConfirmations").mockResolvedValue([]);
    vi.spyOn(db, "listCorrections").mockResolvedValue([]);
    vi.spyOn(db, "settledPayment").mockResolvedValue(null);
    vi.spyOn(db, "getDelivery").mockResolvedValue(null);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "listQaRuns").mockResolvedValue([]);
  });

  it("returns services, includesTranslation, and evaluationReports", async () => {
    const detail = await staffOrder(orderId);

    expect(detail.services).toEqual(["diploma", "course_by_course"]);
    expect(detail.includesTranslation).toBe(false);
    expect(detail.evaluationReports).toEqual([
      { service: "diploma", uploaded: false },
      { service: "course_by_course", uploaded: true, fileName: "course_by_course-evaluation.pdf" },
    ]);
  });
});

describe("parseStaffDetail services", () => {
  it("keeps the resolved admin fields on the order view", () => {
    const detail = parseStaffDetail({
      id: orderId,
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      service: "diploma",
      services: ["translation", "diploma"],
      includeTranslation: true,
      serviceFiles: { diploma: `${orderId}/diploma-evaluation.pdf` },
    });

    expect(detail?.services).toEqual(["translation", "diploma"]);
    expect(detail?.includesTranslation).toBe(true);
    expect(detail?.evaluationReports).toEqual([
      { service: "diploma", uploaded: true, fileName: "diploma-evaluation.pdf" },
    ]);
  });
});
