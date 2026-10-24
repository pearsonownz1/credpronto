import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "../src/lib/orders/ai";
import * as db from "../src/lib/orders/db";
import * as edge from "../src/lib/orders/edge";
import { completeEvaluation } from "../src/lib/orders/evaluation";
import { EQUIVALENCY_QA_RESEARCH, PENDING_EQUIVALENCY } from "../src/lib/orders/equivalency";
import * as pdf from "../src/lib/orders/pdf/evaluation";
import * as merge from "../src/lib/orders/pdf/merge";
import type { Db } from "../src/lib/orders/storage";
import * as storage from "../src/lib/orders/storage";
import type { EvaluationResult, OrderRecord } from "../src/lib/orders/types";
import * as verification from "../src/lib/orders/verification";
import * as webhooks from "../src/lib/orders/webhook-delivery";
import type { EdgeCredentialRecord, EdgeEquivalencyRecord } from "../src/lib/orders/edge";

const dbHandle = {} as Db;
const orderId = "order-eval-review";
const COURSE_CREDENTIAL = "BACCALAUREAT DE L'ENSEIGNEMENT SECONDAIRE";

const PAGE_TEXT = `OFFICE DU BACCALAUREAT DU CAMEROUN
RELEVE DE NOTES
${COURSE_CREDENTIAL}
M KOUAMOU NANA MYRTHE
Session de 2001
MATIERES | COEF. | Note x Coef
Applied Mathematics | 2.0 | 30
Economic Law | 2.0 | 28
Comparative Education | 2.0 | 32
DECISION | ADMIS
`;

let diplomaField = "Quantitative Management Techniques";
let edgeTitles: string[] = ["Licence"];

function credentialRow(title: string): EdgeCredentialRecord {
  return {
    id: `cred-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    countrySlug: "cameroon",
    country: "Cameroon",
    title,
    content: "National credential.",
    levelNumber: 6,
    levelTitle: "Bachelor",
    url: null,
    usEquivalency: "Bachelor's degree",
  };
}

function equivalencyRow(edgeCredentialId: string): EdgeEquivalencyRecord {
  return {
    id: `eq-${edgeCredentialId}`,
    edgeCredentialId,
    country: "Cameroon",
    credentialTitle: "Credential",
    edgeLevel: "6",
    usEquivalency: "Bachelor's degree",
    basis: "High confidence national match.",
    confidence: "high",
  };
}

function evaluationOrder(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    customerId: "customer-1",
    userId: null,
    serviceType: "evaluation",
    status: "processing",
    sourceLanguage: "fr",
    targetLanguage: "en",
    languageConfirmed: false,
    billablePages: 1,
    unitPriceCents: null,
    totalCents: null,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: null,
    certificationPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "evaluation",
    service: "diploma",
    services: ["diploma"],
    degreeCount: 1,
    evaluationCents: null,
    translationCents: null,
    includeTranslation: false,
    evaluationResult: null,
    addonCents: 0,
    expedited: false,
    shippingAddress: null,
    mailStatus: null,
    mailTracking: null,
    notarizationStatus: null,
    edgeCredentialId: null,
    edgeGradingScaleId: null,
    edgeMatchMethod: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    paidAt: null,
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "reading", pagesRead: 1, pagesTotal: 1 },
    ...patch,
  } as OrderRecord;
}

function context() {
  return {
    sourceLanguage: "fr",
    confidence: 0.99,
    billablePages: 1,
    imageQuality: false,
    detectionAvailable: true,
    languagesDisagree: false,
    pageText: PAGE_TEXT,
    filenames: ["diploma.pdf"],
    combinedPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    token: null,
  };
}

function readyPatch(): Record<string, unknown> {
  const call = vi.mocked(db.updateOrder).mock.calls.find((item) => item[2]?.status === "preview_ready");
  expect(call, "expected a preview_ready order update").toBeTruthy();
  return call![2];
}

describe("completeEvaluation review reason", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    diplomaField = "Quantitative Management Techniques";
    edgeTitles = ["Licence"];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "listDocuments").mockResolvedValue([]);
    vi.spyOn(db, "nextPreviewVersion").mockResolvedValue(1);
    vi.spyOn(db, "insertPreview").mockResolvedValue("inserted");
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "markPreview").mockResolvedValue(undefined);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "orderCustomerEmail").mockResolvedValue(null);
    vi.spyOn(db, "resolveEdgeCountrySlug").mockResolvedValue("cameroon");
    vi.spyOn(db, "listEdgeGradingScalesForCountry").mockResolvedValue([]);
    vi.spyOn(db, "listEdgeCredentialsForCountry").mockImplementation(async () => edgeTitles.map(credentialRow));
    vi.spyOn(db, "listEdgeEquivalenciesForCredential").mockImplementation(async (_db, id) => [equivalencyRow(id)]);
    vi.spyOn(ai, "generateObject").mockImplementation(async () => ({
      credentials: [
        {
          applicant: "Ada Lovelace",
          institution: "University of Yaounde",
          country: "Cameroon",
          credential: "Licence",
          englishCredential: "Bachelor's degree",
          field: diplomaField,
          dates: "March 26, 2003",
        },
      ],
    }));
    vi.spyOn(pdf, "renderEvaluationPdfs").mockResolvedValue({
      clean: new Uint8Array([1, 2, 3]),
      preview: new Uint8Array([4]),
      pageCount: 1,
    });
    vi.spyOn(merge, "concatPdfs").mockResolvedValue(new Uint8Array([9]));
    vi.spyOn(verification, "stampFinishedPdf").mockImplementation(async (_db, bytes) => bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyLifecycle").mockResolvedValue(undefined);
  });

  it("writes review_reason null for a clean qa_review diploma", async () => {
    const prepared = await completeEvaluation(dbHandle, evaluationOrder(), context());

    expect(prepared.status).toBe("preview_ready");
    const patch = readyPatch();
    expect(patch.review_reason).toBeNull();
    const stored = patch.evaluation_result as Extract<EvaluationResult, { kind: "diploma" }>;
    expect(stored.credentials[0]?.usEquivalency).toBe("Bachelor's degree");
    expect(stored.credentials[0]?.field).not.toBe(PENDING_EQUIVALENCY);
  });

  it("writes equivalency_qa_research when the diploma route is qa_research", async () => {
    edgeTitles = [];

    const prepared = await completeEvaluation(dbHandle, evaluationOrder(), context());

    expect(prepared.status).toBe("preview_ready");
    const patch = readyPatch();
    expect(patch.review_reason).toBe(EQUIVALENCY_QA_RESEARCH);
    const stored = patch.evaluation_result as Extract<EvaluationResult, { kind: "diploma" }>;
    expect(stored.credentials[0]?.usEquivalency).toBe(PENDING_EQUIVALENCY);
  });

  it("writes equivalency_qa_research when a qa_review diploma still has a pending field", async () => {
    diplomaField = PENDING_EQUIVALENCY;

    const prepared = await completeEvaluation(dbHandle, evaluationOrder(), context());

    expect(prepared.status).toBe("preview_ready");
    const patch = readyPatch();
    expect(patch.review_reason).toBe(EQUIVALENCY_QA_RESEARCH);
    const stored = patch.evaluation_result as Extract<EvaluationResult, { kind: "diploma" }>;
    expect(stored.credentials[0]?.usEquivalency).toBe("Bachelor's degree");
    expect(stored.credentials[0]?.field).toBe(PENDING_EQUIVALENCY);
  });

  it("writes review_reason null for a clean qa_review course report", async () => {
    edgeTitles = [COURSE_CREDENTIAL];

    const prepared = await completeEvaluation(
      dbHandle,
      evaluationOrder({ service: "course_by_course", services: ["course_by_course"] }),
      context(),
    );

    expect(prepared.status).toBe("preview_ready");
    const patch = readyPatch();
    expect(patch.review_reason).toBeNull();
    const stored = patch.evaluation_result as Extract<EvaluationResult, { kind: "course_by_course" }>;
    expect(stored.usEquivalency).toBe("Bachelor's degree");
  });

  it("writes equivalency_qa_research when the course equivalency is pending", async () => {
    edgeTitles = [];

    const prepared = await completeEvaluation(
      dbHandle,
      evaluationOrder({ service: "course_by_course", services: ["course_by_course"] }),
      context(),
    );

    expect(prepared.status).toBe("preview_ready");
    const patch = readyPatch();
    expect(patch.review_reason).toBe(EQUIVALENCY_QA_RESEARCH);
    const stored = patch.evaluation_result as Extract<EvaluationResult, { kind: "course_by_course" }>;
    expect(stored.usEquivalency).toBe(PENDING_EQUIVALENCY);
  });

  it("combines one qa_review report and one qa_research report into research", async () => {
    edgeTitles = ["Licence"];
    const combine = vi.spyOn(edge, "combineEquivalencyRoutes");

    const prepared = await completeEvaluation(
      dbHandle,
      evaluationOrder({ service: null, services: ["diploma", "course_by_course"] }),
      context(),
    );

    expect(prepared.status).toBe("preview_ready");
    expect(combine).toHaveBeenCalledWith(["qa_review", "qa_research"]);
    const patch = readyPatch();
    expect(patch.review_reason).toBe(EQUIVALENCY_QA_RESEARCH);
    const results = patch.evaluation_results as EvaluationResult[];
    const diploma = results.find((result) => result.kind === "diploma");
    const course = results.find((result) => result.kind === "course_by_course");
    expect(diploma?.kind === "diploma" ? diploma.credentials[0]?.usEquivalency : null).toBe("Bachelor's degree");
    expect(course?.kind === "course_by_course" ? course.usEquivalency : null).toBe(PENDING_EQUIVALENCY);
  });

  it("leaves review_reason null when every selected report is a clean qa_review", async () => {
    edgeTitles = ["Licence", COURSE_CREDENTIAL];
    const combine = vi.spyOn(edge, "combineEquivalencyRoutes");

    const prepared = await completeEvaluation(
      dbHandle,
      evaluationOrder({ service: null, services: ["diploma", "course_by_course"] }),
      context(),
    );

    expect(prepared.status).toBe("preview_ready");
    expect(combine).toHaveBeenCalledWith(["qa_review", "qa_review"]);
    expect(readyPatch().review_reason).toBeNull();
  });
});
