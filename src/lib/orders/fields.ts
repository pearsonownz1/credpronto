import { HttpError } from "./errors";

export const CONFIRMATION_FIELD_KEYS = [
  "full_name",
  "date_of_birth",
  "parent_names",
  "place_of_birth",
  "date_format",
] as const;

export type ConfirmationFieldKey = (typeof CONFIRMATION_FIELD_KEYS)[number];

/** Credential details collected on an evaluation, instead of birth-certificate fields. */
export const EVALUATION_FIELD_KEYS = [
  "holder_name",
  "school",
  "degree",
  "dates_attended",
  "date_awarded",
] as const;

export type EvaluationFieldKey = (typeof EVALUATION_FIELD_KEYS)[number];

export const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export function isConfirmationFieldKey(value: string): value is ConfirmationFieldKey {
  return (CONFIRMATION_FIELD_KEYS as readonly string[]).includes(value);
}

export function normalizeDateFormat(value: string): DateFormat {
  const normalized = value.trim().toUpperCase().replace(/-/g, "/");
  if (normalized === "MM/DD/YYYY" || normalized === "DD/MM/YYYY") return normalized;
  throw new HttpError("date_format must be MM/DD/YYYY or DD/MM/YYYY", 400);
}

export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}
