import { orderDownloadFilename } from "./download-name";
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
}): { path: string; filename: string } | null {
  if (isCredentialEvaluation(input)) {
    if (input.file === "certification") {
      if (!input.certificationPath || input.certificationPath === input.finalPath) return null;
      return {
        path: input.certificationPath,
        filename: orderDownloadFilename("certification", input.documentNames, input.targetLanguage),
      };
    }
    if (!input.finalPath) return null;
    return {
      path: input.finalPath,
      filename: orderDownloadFilename("evaluation", input.documentNames, input.targetLanguage),
    };
  }

  const path = input.file === "certification" ? input.certificationPath : input.finalPath;
  if (!path) return null;
  return {
    path,
    filename: orderDownloadFilename(input.file, input.documentNames, input.targetLanguage),
  };
}
