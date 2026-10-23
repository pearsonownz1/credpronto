import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseStaffDetail } from "@/lib/api/parse";
import { uploadEvaluationReport } from "@/lib/api/mutations";
import { mockStaffDetail } from "@/lib/account/mock-data";
import { adminOrderFixtureDetail } from "@/lib/dev/admin-order-fixture";
import {
  applyReportOverrides,
  evaluationPdfFileError,
  evaluationReportsFor,
  evaluationUploadMessage,
  missingEvaluationReportLabels,
} from "@/components/admin/evaluation-report-model";
import { EvaluationReportBoxes, MissingEvaluationReports } from "@/components/admin/evaluation-reports";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dev/admin-order",
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

const BANNED = /\bGuy\b|Pearson|\bGCS\b|gcs\.org|GEO Credential Services|ImmiTranslate/i;

describe("evaluation report selection", () => {
  it("renders one box per evaluationReports entry and keeps the file name", () => {
    const reports = evaluationReportsFor({
      services: ["translation"],
      service: "diploma",
      evaluationReports: [
        { service: "course_by_course", uploaded: false },
        { service: "diploma", uploaded: true, fileName: "diploma-evaluation.pdf" },
        { service: "diploma", uploaded: false, fileName: "ignored.pdf" },
      ],
    });
    expect(reports.map((report) => report.service)).toEqual(["course_by_course", "diploma"]);
    expect(reports[1]?.fileName).toBe("diploma-evaluation.pdf");
    expect(missingEvaluationReportLabels(reports)).toEqual(["Course-by-course evaluation"]);
  });

  it("falls back to the services list, then the legacy service field", () => {
    expect(
      evaluationReportsFor({ services: ["translation", "diploma", "course_by_course"], service: null }).map(
        (report) => report.service,
      ),
    ).toEqual(["diploma", "course_by_course"]);
    expect(evaluationReportsFor({ service: "course_by_course" })).toEqual([
      { service: "course_by_course", uploaded: false },
    ]);
    expect(evaluationReportsFor({ services: ["translation"], service: "diploma" })).toEqual([]);
    expect(evaluationReportsFor({ evaluationReports: [], service: "diploma" })).toEqual([]);
  });

  it("lets a session upload replace the displayed file", () => {
    const reports = applyReportOverrides(
      [{ service: "diploma", uploaded: true, fileName: "old.pdf" }],
      { diploma: { fileName: "new.pdf", url: "blob:report" } },
    );
    expect(reports).toEqual([{ service: "diploma", uploaded: true, fileName: "new.pdf", url: "blob:report" }]);
  });

  it("reads services, includesTranslation, and evaluationReports from the order", () => {
    const detail = parseStaffDetail({
      id: "ord-1",
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      service: null,
      services: ["translation", "diploma", "course_by_course"],
      includeTranslation: true,
      serviceFiles: { diploma: "ord-1/diploma-evaluation.pdf" },
    });
    expect(detail?.services).toEqual(["translation", "diploma", "course_by_course"]);
    expect(detail?.includesTranslation).toBe(true);
    expect(detail?.evaluationReports).toEqual([
      { service: "diploma", uploaded: true, fileName: "diploma-evaluation.pdf" },
      { service: "course_by_course", uploaded: false },
    ]);
    const bare = parseStaffDetail({ id: "ord-2", status: "paid", createdAt: "2026-10-12T00:00:00.000Z" });
    expect(bare?.services).toEqual(["translation"]);
    expect(bare?.includesTranslation).toBe(true);
    expect(bare?.evaluationReports).toEqual([]);
    expect(bare?.service).toBeNull();
  });
});

describe("evaluation report upload", () => {
  it("rejects anything that is not a PDF", () => {
    expect(evaluationPdfFileError(null)).toBe("Choose a PDF.");
    expect(evaluationPdfFileError(new File(["notes"], "notes.txt", { type: "text/plain" }))).toBe("Upload a PDF");
    expect(evaluationPdfFileError(new File([], "empty.pdf", { type: "application/pdf" }))).toBe(
      "Empty files are not accepted",
    );
    expect(evaluationPdfFileError(new File(["%PDF"], "report.pdf", { type: "application/pdf" }))).toBeNull();
  });

  it("names the reports still waiting after a partial upload", () => {
    expect(
      evaluationUploadMessage("diploma", { status: "received", email: "skipped", pending: ["course_by_course"] }),
    ).toBe("Diploma evaluation saved. Still missing Course-by-course evaluation.");
    expect(evaluationUploadMessage("diploma", { status: "delivered", email: "sent" })).toBe(
      "Diploma evaluation saved. The customer was emailed.",
    );
  });

  it("posts the PDF to the existing evaluation upload route", async () => {
    vi.stubEnv("NEXT_PUBLIC_CREDPRONTO_MOCK", "");
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ status: "received", email: "skipped", pending: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["%PDF"], "diploma.pdf", { type: "application/pdf" });
    const result = await uploadEvaluationReport("order/1", "diploma", file);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    if (!init) throw new Error("missing upload request");
    expect(url).toBe("/api/admin/orders/order%2F1/evaluation");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ accept: "application/json" });
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get("service")).toBe("diploma");
    expect(body.get("file")).toBe(file);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("evaluation report boxes", () => {
  it("shows the file name and the missing report beside approval", () => {
    const reports = adminOrderFixtureDetail().evaluationReports;
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(MissingEvaluationReports, { reports }),
        createElement(EvaluationReportBoxes, {
          reports,
          pending: null,
          onReject: () => undefined,
          onUpload: () => undefined,
        }),
      ),
    );
    expect(html).toContain("Still missing: Course-by-course evaluation");
    expect(html).toContain("Diploma evaluation");
    expect(html).toContain("diploma-evaluation.pdf");
    expect(html).toContain("Not uploaded");
    expect(html).toContain("Replace PDF");
    expect(html).toContain("Upload PDF");
    expect(html).not.toMatch(BANNED);
  });

  it("links the file name after a successful upload in this session", () => {
    const reports = applyReportOverrides(adminOrderFixtureDetail().evaluationReports, {
      diploma: { fileName: "diploma-evaluation.pdf", url: "blob:report" },
    });
    const html = renderToStaticMarkup(
      createElement(EvaluationReportBoxes, {
        reports,
        pending: null,
        onReject: () => undefined,
        onUpload: () => undefined,
      }),
    );
    expect(html).toContain('href="blob:report"');
    expect(html).toContain("diploma-evaluation.pdf");
  });

  it("hides the boxes on a translation order", () => {
    const detail = mockStaffDetail("CP-24802");
    expect(detail).not.toBeNull();
    const html = renderToStaticMarkup(
      createElement(EvaluationReportBoxes, {
        reports: evaluationReportsFor(detail!),
        pending: null,
        onReject: () => undefined,
        onUpload: () => undefined,
      }),
    );
    expect(html).toBe("");
    expect(missingEvaluationReportLabels(evaluationReportsFor(detail!))).toEqual([]);
  });
});
