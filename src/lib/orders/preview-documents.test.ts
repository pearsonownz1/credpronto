import { describe, expect, it } from "vitest";
import {
  evaluationPreviewLinks,
  evaluationPreviewSources,
  evaluationViewerLabel,
} from "./preview-documents";

describe("evaluation preview documents", () => {
  it("keeps a translation preview on the translation object", () => {
    expect(
      evaluationPreviewSources({
        service: null,
        previewPath: "order-1/preview-v2.pdf",
        previewPaths: ["order-1/preview-v1.pdf", "order-1/preview-v2.pdf"],
      }),
    ).toEqual({
      reportPath: null,
      translationPath: "order-1/preview-v2.pdf",
      viewerPath: "order-1/preview-v2.pdf",
    });
    expect(
      evaluationPreviewLinks({
        orderType: "translation",
        service: null,
        reportUrl: "https://files.example/report",
        translationUrl: "https://files.example/translation",
      }),
    ).toEqual([]);
  });

  it("treats the lone watermarked preview as the evaluation report for diploma and course-by-course", () => {
    for (const service of ["diploma", "course_by_course"] as const) {
      expect(
        evaluationPreviewSources({
          service,
          previewPath: "order-1/preview-v1.pdf",
        }),
      ).toEqual({
        reportPath: "order-1/preview-v1.pdf",
        translationPath: null,
        viewerPath: "order-1/preview-v1.pdf",
      });
      expect(
        evaluationPreviewSources({
          service,
          previewPath: "order-1/report-v3.pdf",
          previewPaths: ["order-1/report-v2.pdf", "order-1/report-v3.pdf"],
        }).reportPath,
      ).toBe("order-1/report-v3.pdf");
    }
  });

  it("opens the report and the translation from different preview objects", () => {
    expect(
      evaluationPreviewSources({
        service: "diploma",
        previewPath: "order-1/report-v2.pdf",
        previewPaths: [
          "order-1/report-v2.pdf",
          "order-1/translation-preview-v2.pdf",
          "order-1/preview-v1.pdf",
        ],
      }),
    ).toEqual({
      reportPath: "order-1/report-v2.pdf",
      translationPath: "order-1/translation-preview-v2.pdf",
      viewerPath: "order-1/translation-preview-v2.pdf",
    });
    expect(
      evaluationPreviewSources({
        service: "course_by_course",
        previewPath: "order-1/report-v1.pdf",
        previewPaths: ["order-1/report-v1.pdf", "order-1/preview-v4.pdf"],
      }),
    ).toEqual({
      reportPath: "order-1/report-v1.pdf",
      translationPath: "order-1/preview-v4.pdf",
      viewerPath: "order-1/preview-v4.pdf",
    });
  });

  it("gives each evaluation link its own URL and does not reuse the report for the translation", () => {
    expect(
      evaluationPreviewLinks({
        orderType: "evaluation",
        service: "diploma",
        reportUrl: "https://files.example/report.pdf",
        translationUrl: "https://files.example/translation.pdf",
      }),
    ).toEqual([
      {
        id: "report",
        label: "Evaluation report",
        href: "https://files.example/report.pdf",
        testId: "evaluation-report-link",
      },
      {
        id: "translation",
        label: "Translation",
        href: "https://files.example/translation.pdf",
        testId: "translation-link",
      },
    ]);
    expect(
      evaluationPreviewLinks({
        orderType: "evaluation",
        service: "course_by_course",
        reportUrl: "https://files.example/report.pdf",
        translationUrl: "https://files.example/report.pdf",
      }).map((link) => link.id),
    ).toEqual(["report"]);
    expect(
      evaluationViewerLabel({
        product: "evaluation",
        reportUrl: "https://files.example/report.pdf",
        translationUrl: "https://files.example/report.pdf",
      }),
    ).toBe("Evaluation report");
    expect(
      evaluationViewerLabel({
        product: "evaluation",
        reportUrl: "https://files.example/report.pdf",
        translationUrl: "https://files.example/translation.pdf",
      }),
    ).toBe("Translation");
    expect(
      evaluationViewerLabel({
        product: "translation",
        translationUrl: "https://files.example/translation.pdf",
      }),
    ).toBe("Translation");
  });
});
