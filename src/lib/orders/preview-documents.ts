const REPORT_PATH = /\/report-v(\d+)\.pdf$/;
const LEGACY_REPORT_PATH = /\/preview-v(\d+)\.pdf$/;
const TRANSLATION_PREVIEW_PATH = /\/translation-preview-v(\d+)\.pdf$/;

export type PreviewDocLink = {
  id: "report" | "translation";
  label: "Evaluation report" | "Translation";
  href: string;
  testId: "evaluation-report-link" | "translation-link";
};

export type EvaluationPreviewSources = {
  /** Watermarked evaluation report. Null on a translation order. */
  reportPath: string | null;
  /**
   * Watermarked certified translation. Null when the only preview object is the
   * evaluation report, so the translation link does not open that report.
   */
  translationPath: string | null;
  /** Object the side-by-side preview shows in the second pane. */
  viewerPath: string;
};

/**
 * Pick the preview objects for an evaluation.
 *
 * The ready preview row is the watermarked evaluation report (`report-v`, or
 * `preview-v` on orders created before that name). A certified translation is
 * a different object: `translation-preview-v`, or `preview-v` once a `report-v`
 * exists beside it. `orders.final_translation_path` is the clean report in
 * finals (`evaluation-v`), not a translation, and is not a preview target.
 */
export function evaluationPreviewSources(input: {
  service: string | null;
  previewPath: string;
  previewPaths?: readonly string[];
}): EvaluationPreviewSources {
  if (input.service !== "diploma" && input.service !== "course_by_course") {
    return {
      reportPath: null,
      translationPath: input.previewPath,
      viewerPath: input.previewPath,
    };
  }

  const paths = [...new Set([input.previewPath, ...(input.previewPaths ?? [])])];
  const namedReport = newestMatch(paths, REPORT_PATH);
  const reportPath = namedReport ?? newestMatch(paths, LEGACY_REPORT_PATH) ?? input.previewPath;
  const translationPath =
    newestMatch(paths, TRANSLATION_PREVIEW_PATH) ??
    (namedReport ? newestMatch(paths, LEGACY_REPORT_PATH) : null);
  const distinctTranslation = translationPath && translationPath !== reportPath ? translationPath : null;

  return {
    reportPath,
    translationPath: distinctTranslation,
    viewerPath: distinctTranslation ?? reportPath,
  };
}

/** Links on an evaluation preview. Translation orders get none. */
export function evaluationPreviewLinks(input: {
  orderType: string;
  service: string | null;
  reportUrl: string | null | undefined;
  translationUrl: string | null | undefined;
}): PreviewDocLink[] {
  if (input.orderType !== "evaluation") return [];
  if (input.service !== "diploma" && input.service !== "course_by_course") return [];

  const links: PreviewDocLink[] = [];
  if (input.reportUrl) {
    links.push({
      id: "report",
      label: "Evaluation report",
      href: input.reportUrl,
      testId: "evaluation-report-link",
    });
  }
  if (input.translationUrl && input.translationUrl !== input.reportUrl) {
    links.push({
      id: "translation",
      label: "Translation",
      href: input.translationUrl,
      testId: "translation-link",
    });
  }
  return links;
}

/** Second-pane title. An evaluation whose preview file is the report is not labeled as a translation. */
export function evaluationViewerLabel(input: {
  product?: string;
  reportUrl?: string | null;
  translationUrl: string;
}): "Translation" | "Evaluation report" {
  if (input.product !== "evaluation") return "Translation";
  if (input.reportUrl && input.reportUrl !== input.translationUrl) return "Translation";
  return "Evaluation report";
}

function newestMatch(paths: readonly string[], pattern: RegExp): string | null {
  let best: { path: string; version: number } | null = null;
  for (const path of paths) {
    const match = pattern.exec(path);
    const version = match?.[1] ? Number(match[1]) : null;
    if (version == null || Number.isNaN(version)) continue;
    if (!best || version > best.version) best = { path, version };
  }
  return best?.path ?? null;
}
