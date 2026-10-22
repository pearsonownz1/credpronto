import { MAX_DEGREE_COUNT } from "@/lib/orders/evaluation-price";
import {
  CATALOG_SERVICES,
  normalizeCatalogServices,
  servicesWithTranslation,
  type CatalogService,
} from "@/lib/orders/service-selection";
import type { EvaluationService } from "@/lib/orders/types";

/**
 * Customer upload fields from docs/api.md.
 * `service` is the evaluation kind (`diploma` or `course_by_course`).
 * A translation omits `service` and `degreeCount`.
 */
export type UploadChoice =
  | { orderType: "translation"; services?: CatalogService[] }
  | {
      orderType: "evaluation";
      /**
       * One evaluation id for older servers. `diploma` when both evaluations
       * are checked. The new server prices `services` and may store this as null.
       */
      service: EvaluationService | null;
      degreeCount: number;
      /** True when Translation is checked together with an evaluation. */
      includeTranslation: boolean;
      /** Every checked service. Omitted only by callers that still send the old shape. */
      services?: CatalogService[];
    };

/** The three upload ids, in the order the server stores them. */
export const SERVICE_IDS = {
  translation: CATALOG_SERVICES[0],
  diploma: CATALOG_SERVICES[1],
  courseByCourse: CATALOG_SERVICES[2],
} as const;

export type ServiceChecks = {
  translation: boolean;
  diploma: boolean;
  courseByCourse: boolean;
};

/** Checking one service leaves the other boxes as they are. */
export function checksAfterToggle(
  current: ServiceChecks,
  key: keyof ServiceChecks,
  checked: boolean,
): ServiceChecks {
  return { ...current, [key]: checked };
}

/** Create, quote, and checkout body. `services` is the checked subset; the other fields are the older shape. */
export type ServiceRequest = {
  services: CatalogService[];
  orderType: "translation" | "evaluation";
  service?: EvaluationService;
  degreeCount?: string;
  includeTranslation?: boolean;
};

export function parseEvaluationService(value: string | null | undefined): EvaluationService | null {
  if (value === SERVICE_IDS.diploma || value === SERVICE_IDS.courseByCourse) return value;
  return null;
}

/** Checked services, in catalog order. */
export function checkedServiceIds(checks: ServiceChecks): CatalogService[] {
  const ids: CatalogService[] = [];
  if (checks.translation) ids.push(SERVICE_IDS.translation);
  if (checks.diploma) ids.push(SERVICE_IDS.diploma);
  if (checks.courseByCourse) ids.push(SERVICE_IDS.courseByCourse);
  return ids;
}

function fallbackService(services: readonly CatalogService[]): EvaluationService | null {
  if (services.includes(SERVICE_IDS.diploma)) return SERVICE_IDS.diploma;
  if (services.includes(SERVICE_IDS.courseByCourse)) return SERVICE_IDS.courseByCourse;
  return null;
}

export function uploadChoiceFromSelection(
  service: EvaluationService | "translation",
  degreeCount: number,
  includeTranslation = false,
): UploadChoice {
  if (service === "translation") return { orderType: "translation", services: [SERVICE_IDS.translation] };
  const services: CatalogService[] = includeTranslation ? [SERVICE_IDS.translation, service] : [service];
  return {
    orderType: "evaluation",
    service,
    degreeCount,
    includeTranslation,
    services,
  };
}

/**
 * Any non-empty mix of the three services.
 * `service` stays a single evaluation id so the older request shape still parses.
 * When both evaluations are checked, that fallback id is `diploma`.
 */
export function uploadChoiceFromChecks(checks: ServiceChecks, degreeCount: number): UploadChoice | null {
  const services = checkedServiceIds(checks);
  if (services.length === 0) return null;
  const service = fallbackService(services);
  if (!service) return { orderType: "translation", services };
  if (!Number.isInteger(degreeCount) || degreeCount < 1 || degreeCount > MAX_DEGREE_COUNT) return null;
  return {
    orderType: "evaluation",
    service,
    degreeCount,
    includeTranslation: checks.translation,
    services,
  };
}

/** `services` lists every checked id. Missing lists are derived from the older fields. */
export function servicesForChoice(choice: UploadChoice): CatalogService[] {
  const explicit = normalizeCatalogServices(choice.services);
  if (explicit) return explicit;
  if (choice.orderType !== "evaluation") return [SERVICE_IDS.translation];
  const derived: CatalogService[] = [];
  if (choice.includeTranslation) derived.push(SERVICE_IDS.translation);
  if (choice.service) derived.push(choice.service);
  return normalizeCatalogServices(derived) ?? [SERVICE_IDS.translation];
}

export function serviceRequestFromChoice(choice: UploadChoice): ServiceRequest {
  const services = servicesForChoice(choice);
  const service = fallbackService(services);
  if (!service) return { orderType: "translation", services };
  const degreeCount = choice.orderType === "evaluation" ? choice.degreeCount : 1;
  return {
    orderType: "evaluation",
    services,
    service,
    degreeCount: String(degreeCount),
    includeTranslation: services.includes(SERVICE_IDS.translation),
  };
}

/** Quote and checkout send the order's checked services, plus the older service fields. */
export function serviceRequestFromOrder(
  order: {
    services?: readonly string[] | null;
    service?: string | null;
    includeTranslation?: boolean | null;
    degreeCount?: number | null;
    orderType?: string | null;
  },
  override?: { includeTranslation?: boolean },
): ServiceRequest {
  let services = normalizeCatalogServices(order.services);
  if (!services) {
    const derived: string[] = [];
    const evaluation = order.service === SERVICE_IDS.diploma || order.service === SERVICE_IDS.courseByCourse;
    if (!evaluation || order.includeTranslation === true || order.orderType === "translation") {
      derived.push(SERVICE_IDS.translation);
    }
    if (evaluation && order.service) derived.push(order.service);
    services = normalizeCatalogServices(derived) ?? [SERVICE_IDS.translation];
  }
  if (override?.includeTranslation != null) {
    services = servicesWithTranslation(services, override.includeTranslation);
  }
  const service = fallbackService(services);
  if (!service) return { orderType: "translation", services };
  const degreeCount =
    order.degreeCount != null && Number.isInteger(order.degreeCount) ? String(order.degreeCount) : undefined;
  return {
    orderType: "evaluation",
    services,
    service,
    ...(degreeCount ? { degreeCount } : {}),
    includeTranslation: services.includes(SERVICE_IDS.translation),
  };
}

export function orderRequestChoice(choice: UploadChoice): ServiceRequest {
  return serviceRequestFromChoice(choice);
}

export function appendOrderChoice(form: FormData, choice: UploadChoice) {
  const request = serviceRequestFromChoice(choice);
  if (request.orderType !== "evaluation") return;
  form.set("orderType", "evaluation");
  if (request.service) form.set("service", request.service);
  if (request.degreeCount) form.set("degreeCount", request.degreeCount);
  if (request.includeTranslation) form.set("includeTranslation", "true");
  if (request.services.length > 0) form.set("services", request.services.join(","));
}

export function choiceFields(choice: UploadChoice): Record<string, string> {
  const form = new FormData();
  appendOrderChoice(form, choice);
  return Object.fromEntries(
    [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
