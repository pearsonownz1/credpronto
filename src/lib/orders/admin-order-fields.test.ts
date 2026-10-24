import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseStaffDetail } from "@/lib/api/parse";
import { staffOrder } from "./admin";
import { adminOrderFields } from "./admin-order-fields";
import { DOWNLOAD_URL_SECONDS, FINALS_BUCKET } from "./constants";
import * as db from "./db";
import * as staff from "./staff";
import * as storage from "./storage";
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
    vi.spyOn(storage, "signedObjectUrls").mockImplementation(async (_db, _bucket, paths) => {
      const urls = new Map<string, string>();
      for (const path of paths) urls.set(path, `https://files.example/${path}?token=short`);
      return urls;
    });
  });

  it("returns services, includesTranslation, and a short-lived link for each stored evaluation PDF", async () => {
    const detail = await staffOrder(orderId);

    expect(detail.services).toEqual(["diploma", "course_by_course"]);
    expect(detail.includesTranslation).toBe(false);
    expect(detail.evaluationReports).toEqual([
      { service: "diploma", uploaded: false },
      {
        service: "course_by_course",
        uploaded: true,
        fileName: "course_by_course-evaluation.pdf",
        url: `https://files.example/${orderId}/course_by_course-evaluation.pdf?token=short`,
      },
    ]);
    expect(storage.signedObjectUrls).toHaveBeenCalledWith(
      expect.anything(),
      FINALS_BUCKET,
      [`${orderId}/course_by_course-evaluation.pdf`],
      DOWNLOAD_URL_SECONDS,
    );
  });

  it("still returns the order when evaluation PDF links cannot be signed", async () => {
    vi.spyOn(storage, "signedObjectUrls").mockRejectedValue(new Error("sign failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const detail = await staffOrder(orderId);

    expect(detail.evaluationReports).toEqual([
      { service: "diploma", uploaded: false },
      { service: "course_by_course", uploaded: true, fileName: "course_by_course-evaluation.pdf" },
    ]);
    expect(console.error).toHaveBeenCalled();
  });

  it("does not sign an evaluation PDF stored outside this order", async () => {
    vi.mocked(db.getOrderById).mockResolvedValue({
      id: orderId,
      customerId: "customer-1",
      status: "paid",
      service: null,
      services: ["diploma", "course_by_course"],
      includeTranslation: false,
      serviceFiles: {
        diploma: "other-order/diploma-evaluation.pdf",
        course_by_course: `${orderId}/../other-order/course.pdf`,
      },
      evaluationStatus: null,
      progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
    } as OrderRecord);

    const detail = await staffOrder(orderId);

    expect(detail.evaluationReports).toEqual([
      { service: "diploma", uploaded: true, fileName: "diploma-evaluation.pdf" },
      { service: "course_by_course", uploaded: true, fileName: "course.pdf" },
    ]);
    expect(storage.signedObjectUrls).not.toHaveBeenCalled();
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

  it("keeps a stored evaluation failure and segment source indexes", () => {
    const detail = parseStaffDetail({
      id: orderId,
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      service: "course_by_course",
      evaluationFailures: [
        { service: "course_by_course", reason: "Course-by-course evaluation could not be read from the uploaded pages." },
      ],
      documents: [
        {
          id: "doc-1",
          filename: "Aristide.pdf",
          pages: [
            {
              id: "page-1",
              pageNumber: 1,
              sourceText: "Session de 2001",
              translation: {
                paragraphs: [
                  { text: "Session: 2001", source_index: 0 },
                  { text: "Sub-center: BAFOUSSAM", source_index: 0 },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(detail?.evaluationFailures).toEqual([
      {
        service: "course_by_course",
        reason: "Course-by-course evaluation could not be read from the uploaded pages.",
      },
    ]);
    expect(detail?.pages[0]?.sourceIndexes).toEqual([0, 0]);
    expect(detail?.pages[0]?.paragraphs).toEqual(["Session: 2001", "Sub-center: BAFOUSSAM"]);
  });

  it("keeps short-lived links for the stored evaluation PDFs", () => {
    const detail = parseStaffDetail({
      id: orderId,
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      service: null,
      services: ["diploma", "course_by_course"],
      includeTranslation: false,
      serviceFiles: {
        diploma: `${orderId}/diploma-evaluation.pdf`,
        course_by_course: `${orderId}/course_by_course-evaluation.pdf`,
      },
      evaluationReports: [
        {
          service: "diploma",
          uploaded: true,
          fileName: "diploma-evaluation.pdf",
          url: "https://files.example/diploma",
        },
        {
          service: "course_by_course",
          uploaded: true,
          fileName: "course_by_course-evaluation.pdf",
          url: "https://files.example/course",
        },
      ],
    });

    expect(detail?.evaluationReports).toEqual([
      {
        service: "diploma",
        uploaded: true,
        fileName: "diploma-evaluation.pdf",
        url: "https://files.example/diploma",
      },
      {
        service: "course_by_course",
        uploaded: true,
        fileName: "course_by_course-evaluation.pdf",
        url: "https://files.example/course",
      },
    ]);
  });

  it("lists a summary for each stored evaluation on a translation bundle", () => {
    const detail = parseStaffDetail({
      id: orderId,
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      service: null,
      services: ["translation", "diploma", "course_by_course"],
      includeTranslation: true,
      evaluationResult: {
        kind: "diploma",
        credentials: [
          {
            applicant: "Ada Lovelace",
            institution: "Universidad Nacional",
            country: "Mexico",
            credential: "Licenciatura",
            field: "Law",
            dates: "2018",
            usEquivalency: "Bachelor degree",
            documentsReviewed: ["diploma.pdf"],
          },
        ],
      },
      evaluationResults: [
        {
          kind: "course_by_course",
          applicant: "Ada Lovelace",
          institution: "Universidad Nacional",
          country: "Mexico",
          credential: "Licenciatura",
          gradeScale: "10-point",
          totalHours: 120,
          gpa: 3.5,
          years: [
            {
              year: "2018",
              courses: [
                {
                  originalName: "Derecho",
                  englishName: "Law",
                  localCredits: 4,
                  localGrade: "9",
                  usSemesterHours: 3,
                  usGrade: "A",
                  gradePoints: 12,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(detail?.evaluations).toEqual([
      {
        service: "diploma",
        heading: "Diploma evaluation",
        lines: ["Licenciatura (Universidad Nacional) — Bachelor degree"],
      },
      {
        service: "course_by_course",
        heading: "Course-by-course evaluation",
        lines: ["Licenciatura (Universidad Nacional)", "GPA 3.5 · 120 US semester hours", "2018: Law — A"],
      },
    ]);
  });

  it("leaves evaluations empty when neither result is stored", () => {
    const detail = parseStaffDetail({
      id: orderId,
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      service: null,
      services: ["translation", "diploma", "course_by_course"],
      includeTranslation: true,
      evaluationResult: null,
      evaluationResults: null,
    });

    expect(detail?.evaluations).toEqual([]);
  });
});
