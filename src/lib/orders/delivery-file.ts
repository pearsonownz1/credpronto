import { deliveryDocumentName, orderDownloadFilename } from "./download-name";
import { isCertifiedTranslationPath } from "./final-file";
import type { EvaluationService } from "./types";

export function isCredentialEvaluation(order: { service: EvaluationService | string | null }): boolean {
  return order.service != null;
}

/**
 * Certified translation on a paid bundle. The evaluation report is a different
 * file and stays behind the evaluation download. An evaluation-only order still
 * serves the report under an evaluation name, and does not offer a translation.
 */
export function bundleTranslationFile(input: {
  includeTranslation?: boolean | null;
  file: "translation" | "certification" | "evaluation";
  translationPath: string | null;
  documentNames: readonly string[];
  targetLanguage: string;
  detectedTitle?: string | null;
}): { path: string; filename: string } | null {
  if (input.includeTranslation !== true || input.file !== "translation") return null;
  if (!isCertifiedTranslationPath(input.translationPath)) return null;
  return {
    path: input.translationPath,
    filename: deliveryDocumentName({
      detectedTitle: input.detectedTitle,
      documentNames: input.documentNames,
    }).filename,
  };
}

export function deliveryFileTarget(input: {
  file: "translation" | "certification" | "evaluation";
  service: EvaluationService | null;
  finalPath: string | null;
  certificationPath: string | null;
  documentNames: readonly string[];
  targetLanguage: string;
  detectedTitle?: string | null;
  includeTranslation?: boolean | null;
}): { path: string; filename: string } | null {
  const bundled = bundleTranslationFile({
    includeTranslation: input.includeTranslation,
    file: input.file,
    translationPath: input.finalPath,
    documentNames: input.documentNames,
    targetLanguage: input.targetLanguage,
    detectedTitle: input.detectedTitle,
  });
  if (bundled) return bundled;

  const path = input.finalPath || input.certificationPath;
  if (!path) return null;

  if (isCredentialEvaluation(input)) {
    if (input.file === "translation") return null;
    if (input.file !== "evaluation" && input.file !== "certification") return null;
    return {
      path,
      filename: orderDownloadFilename("evaluation", input.documentNames, input.targetLanguage),
    };
  }

  if (input.file !== "translation" && input.file !== "certification") return null;
  return {
    path,
    filename: deliveryDocumentName({
      detectedTitle: input.detectedTitle,
      documentNames: input.documentNames,
    }).filename,
  };
}
