import type { Metadata } from "next";
import { EvaluationsView } from "@/components/evaluations/evaluations-view";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
  EVALUATIONS_CANONICAL_URL,
  TRANSLATION_ADDON,
} from "@/lib/evaluations/catalog";

export const metadata: Metadata = {
  title: "Credential evaluations · CredPronto",
  description: `Diploma evaluation ${DIPLOMA_PRICE_LABEL}. Course-by-course ${COURSE_BY_COURSE_PRICE_LABEL}. ${TRANSLATION_ADDON}`,
  alternates: {
    canonical: EVALUATIONS_CANONICAL_URL,
  },
};

export default function EvaluationsPage() {
  return <EvaluationsView />;
}
