import { deliveryDocumentName, orderDownloadFilename } from "./download-name";
import type { EvaluationService } from "./types";

export function isCredentialEvaluation(order: { service: EvaluationService | string | null }): boolean {
  return order.service != null;
}

/**
 * The file a customer downloads. An evaluation serves the report under an
 * evaluation name. A translation certificate is not substituted for that report.
 */
export function deliveryFileTarget(input: {
  file: "translation" | "certification" | "evaluation";
  service: EvaluationService | null;
  finalPath: string | null;
  certificationPath: string | null;
  documentNames: readonly string[];
  targetLanguage: string;
  detectedTitle?: string | null;
}): { path: string; filename: string } | null {
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
