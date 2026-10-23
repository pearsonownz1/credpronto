import type { StaffDetail } from "@/lib/api/types";

/** Preview and local builds can open the fixture. Production cannot. */
export function adminOrderFixtureEnabled(env: string | undefined = process.env.VERCEL_ENV): boolean {
  return env !== "production";
}

/** Staff order with one stored report and one still missing. Not a customer order. */
export function adminOrderFixtureDetail(): StaffDetail {
  return {
    id: "CP-24910",
    status: "paid",
    email: "ada@example.com",
    sourceLanguage: "es",
    targetLanguage: "en",
    billablePages: 4,
    totalCents: 13970,
    currency: "usd",
    createdAt: "2026-10-20T15:00:00.000Z",
    reviewReason: null,
    service: null,
    services: ["translation", "diploma", "course_by_course"],
    includesTranslation: true,
    evaluationReports: [
      {
        service: "diploma",
        uploaded: true,
        fileName: "diploma-evaluation.pdf",
        url: "/samples/birth-certificate-en.pdf",
      },
      { service: "course_by_course", uploaded: false },
    ],
    equivalencyCredentials: [],
    edge: null,
    filename: "diploma.pdf",
    pages: [],
    originals: [{ filename: "diploma.pdf", url: "/samples/birth-certificate-es.pdf", pages: 2 }],
    corrections: [],
    payment: { status: "paid", paidAt: "2026-10-20T15:04:00.000Z" },
    delivery: { status: "pending", approvedAt: null, deliveredAt: null },
    originalUrl: null,
    translationUrl: null,
    qa: null,
    expedited: false,
    evaluationStatus: null,
    evaluationStatusAt: {
      under_review: null,
      performing_evaluation: null,
      performing_layout: null,
      evaluation_complete: null,
    },
    fulfillment: { mail: null, notarization: null },
  };
}
