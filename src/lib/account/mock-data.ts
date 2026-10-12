import type { AdminList, AdminOrder, CustomerOrder, StaffDetail, StaffNote } from "@/lib/api/types";

export const MOCK_CUSTOMER_EMAIL = "maria.ruiz@email.com";
export const MOCK_ADMIN_EMAIL = "admin@credpronto.com";

const NOW_OFFSET = 6 * 60_000;

export function mockOrdersFor(email: string, now: number): CustomerOrder[] {
  if (email.trim().toLowerCase() !== MOCK_CUSTOMER_EMAIL) return [];
  return [
    customer("CP-24817", "preview_ready", {
      documentsLabel: "Birth certificate",
      sourceLanguage: "es",
      billablePages: 2,
      totalCents: 1990,
      createdAt: "2026-10-11T12:00:00.000Z",
      previewAvailable: true,
      orderToken: "tok-preview-24817",
    }),
    customer("CP-24815", "processing", {
      documentsLabel: "Diploma, transcript",
      sourceLanguage: "pt",
      billablePages: 5,
      totalCents: 4975,
      createdAt: "2026-10-11T11:00:00.000Z",
      etaAt: new Date(now + NOW_OFFSET).toISOString(),
      orderToken: "tok-progress-24815",
    }),
    customer("CP-24790", "paid", {
      documentsLabel: "Marriage certificate",
      sourceLanguage: "fr",
      billablePages: 1,
      totalCents: 995,
      createdAt: "2026-10-10T12:00:00.000Z",
      previewAvailable: true,
      paymentStatus: "paid",
      orderToken: "tok-paid-24790",
    }),
    customer("CP-24702", "quoted", {
      documentsLabel: "Police certificate",
      sourceLanguage: "zh",
      billablePages: 1,
      totalCents: 995,
      createdAt: "2026-10-09T12:00:00.000Z",
      orderToken: "tok-quoted-24702",
    }),
    customer("CP-24611", "delivered", {
      documentsLabel: "Birth certificate",
      sourceLanguage: "es",
      billablePages: 2,
      totalCents: 1990,
      createdAt: "2026-10-02T12:00:00.000Z",
      previewAvailable: true,
      paymentStatus: "paid",
      downloadAvailable: true,
      orderToken: "tok-ready-24611",
    }),
    customer("CP-24588", "delivered", {
      documentsLabel: "Driver's license",
      sourceLanguage: "es",
      billablePages: 1,
      totalCents: 995,
      createdAt: "2026-09-30T12:00:00.000Z",
      previewAvailable: true,
      paymentStatus: "paid",
      downloadAvailable: true,
      orderToken: "tok-ready-24588",
    }),
  ];
}

function customer(id: string, status: string, extra: Partial<CustomerOrder>): CustomerOrder {
  return {
    id,
    status,
    serviceType: "translation",
    totalCents: null,
    currency: "usd",
    billablePages: null,
    unitPriceCents: 995,
    createdAt: "2026-10-11T12:00:00.000Z",
    previewAvailable: false,
    paymentStatus: null,
    downloadAvailable: false,
    targetLanguage: "en",
    ...extra,
  };
}

export const MOCK_ADMIN_ORDERS: AdminOrder[] = [
  {
    id: "CP-24817",
    status: "preview_ready",
    serviceType: "translation",
    sourceLanguage: "es",
    billablePages: 2,
    totalCents: 1990,
    currency: "usd",
    createdAt: "2026-10-11T12:00:00.000Z",
    reviewReason: null,
    email: MOCK_CUSTOMER_EMAIL,
  },
  {
    id: "CP-24802",
    status: "needs_review",
    serviceType: "translation",
    sourceLanguage: null,
    billablePages: 3,
    totalCents: 2985,
    currency: "usd",
    createdAt: "2026-10-11T09:00:00.000Z",
    reviewReason: "Low confidence on page 2",
    email: "ada@example.com",
  },
  {
    id: "CP-24790",
    status: "paid",
    serviceType: "translation",
    sourceLanguage: "fr",
    billablePages: 1,
    totalCents: 995,
    currency: "usd",
    createdAt: "2026-10-10T12:00:00.000Z",
    reviewReason: null,
    email: MOCK_CUSTOMER_EMAIL,
  },
  {
    id: "CP-24740",
    status: "correction_requested",
    serviceType: "translation",
    sourceLanguage: "pt",
    billablePages: 4,
    totalCents: 3980,
    currency: "usd",
    createdAt: "2026-10-08T12:00:00.000Z",
    reviewReason: null,
    email: "joao@example.com",
  },
  {
    id: "CP-24611",
    status: "delivered",
    serviceType: "translation",
    sourceLanguage: "es",
    billablePages: 2,
    totalCents: 1990,
    currency: "usd",
    createdAt: "2026-10-02T12:00:00.000Z",
    reviewReason: null,
    email: MOCK_CUSTOMER_EMAIL,
  },
];

export function mockAdminList(query: { status?: string | null; limit?: number; offset?: number }): AdminList {
  const status = query.status ?? null;
  const filtered = status ? MOCK_ADMIN_ORDERS.filter((order) => order.status === status) : MOCK_ADMIN_ORDERS;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 50;
  return {
    orders: filtered.slice(offset, offset + limit),
    page: { limit, offset, total: filtered.length },
  };
}

export function mockStaffDetail(id: string): StaffDetail | null {
  const summary = MOCK_ADMIN_ORDERS.find((order) => order.id === id);
  if (!summary) return null;
  return {
    id: summary.id,
    status: summary.status,
    email: summary.email,
    sourceLanguage: summary.sourceLanguage,
    targetLanguage: "en",
    billablePages: summary.billablePages,
    totalCents: summary.totalCents,
    currency: summary.currency,
    createdAt: summary.createdAt,
    reviewReason: summary.reviewReason,
    filename: "birth-certificate.pdf",
    originalUrl: "/samples/birth-certificate-es.pdf",
    translationUrl: "/samples/birth-certificate-en.pdf",
    pages: [
      {
        id: `${id}-p1`,
        documentId: `${id}-doc`,
        pageNumber: 1,
        sourceText: "Acta de nacimiento de María Ruiz.",
        paragraphs: ["Birth certificate of María Ruiz."],
      },
      {
        id: `${id}-p2`,
        documentId: `${id}-doc`,
        pageNumber: 2,
        sourceText: "Fecha de nacimiento: 14 de marzo de 1994.",
        paragraphs: ["Date of birth: March 14, 1994."],
      },
    ],
    corrections:
      summary.status === "correction_requested"
        ? [
            {
              id: `${id}-cor`,
              pageNumber: 1,
              note: "Use the confirmed spelling of the surname.",
              passage: "Ruiz",
              status: "open",
              createdAt: "2026-10-08T13:00:00.000Z",
            },
          ]
        : [],
    payment:
      summary.status === "paid" || summary.status === "delivered"
        ? { status: "paid", paidAt: summary.createdAt }
        : null,
    delivery:
      summary.status === "delivered"
        ? { status: "delivered", approvedAt: "2026-10-02T15:00:00.000Z", deliveredAt: "2026-10-02T16:00:00.000Z" }
        : summary.status === "paid"
          ? { status: "pending", approvedAt: null, deliveredAt: null }
          : null,
    qa:
      id === "CP-24790"
        ? {
            status: "fail",
            score: 72,
            checkedAt: "2026-10-12T00:00:00.000Z",
            attempts: 2,
            issues: [
              {
                type: "date",
                severity: "high",
                page: 2,
                original: "14 de marzo de 1994",
                translated: "March 14, 1994",
                note: "Confirm the day-first date.",
              },
            ],
          }
        : null,
  };
}

export function mockNotes(id: string): StaffNote[] {
  return [
    {
      id: `${id}-note-1`,
      authorId: "staff-1",
      body: "Checked the name against the original scan.",
      createdAt: "2026-10-11T18:00:00.000Z",
    },
  ];
}
