import { evaluationDeliverablePath } from "./evaluation-review";
import { evaluationKinds, resolveServices, type CatalogService } from "./service-selection";
import type { EvaluationService } from "./types";

export type EvaluationReportView = {
  service: EvaluationService;
  uploaded: boolean;
  fileName?: string;
};

export type AdminOrderFields = {
  services: CatalogService[];
  includesTranslation: boolean;
  evaluationReports: EvaluationReportView[];
};

type AdminOrderSource = Parameters<typeof resolveServices>[0] & {
  id?: string;
  serviceFiles?: Partial<Record<EvaluationService, string>> | null;
};

/** Fields the admin order view adds for one order. `services` always comes from resolveServices. */
export function adminOrderFields(order: AdminOrderSource, deliveredPath?: string | null): AdminOrderFields {
  const services = resolveServices(order);
  const reports = evaluationKinds(services);
  const files = order.serviceFiles ?? {};
  const delivered =
    typeof order.id === "string" &&
    typeof deliveredPath === "string" &&
    deliveredPath === evaluationDeliverablePath(order.id);

  return {
    services,
    includesTranslation: services.includes("translation"),
    evaluationReports: reports.map((service) =>
      reportView(service, files[service], delivered, reports.length === 1 ? (deliveredPath ?? null) : null),
    ),
  };
}

function reportView(
  service: EvaluationService,
  stored: string | undefined,
  delivered: boolean,
  singleDeliveredPath: string | null,
): EvaluationReportView {
  const path = stored?.trim() || (delivered ? singleDeliveredPath?.trim() : "") || "";
  if (!path && !delivered) return { service, uploaded: false };
  if (!path) return { service, uploaded: true };
  const fileName = path.split("/").filter((part) => part.length > 0).pop();
  return fileName ? { service, uploaded: true, fileName } : { service, uploaded: true };
}
