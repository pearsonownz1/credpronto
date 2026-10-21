export const CONFIRM_DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY"] as const;

export type ConfirmDateFormat = (typeof CONFIRM_DATE_FORMATS)[number];

export function isConfirmDateFormat(value: string | null | undefined): value is ConfirmDateFormat {
  return value === "MM/DD/YYYY" || value === "DD/MM/YYYY";
}

/**
 * Default for the confirm-page date-format control.
 * A stored reading of DD/MM wins. A numeric date that cannot be MM/DD
 * (for example 19/09/1996) also selects DD/MM/YYYY. Ambiguous dates stay MM/DD/YYYY
 * unless the stored reading already says DD/MM.
 */
export function defaultDateFormat(
  stored: string | null | undefined,
  dateOfBirth?: string | null,
): ConfirmDateFormat {
  const reading = dateOrderFromText(stored);
  const fromDate = dateOrderFromBirth(dateOfBirth);
  if (fromDate === "DMY" && reading !== "DMY") return "DD/MM/YYYY";
  if (reading === "DMY") return "DD/MM/YYYY";
  return "MM/DD/YYYY";
}

/** Blank confirmed text does not hide the original reading. */
export function storedConfirmation(confirmed: string | null | undefined, original: string | null | undefined): string {
  const chosen = confirmed?.trim() ?? "";
  if (chosen) return chosen;
  return original?.trim() ?? "";
}

function dateOrderFromText(value: string | null | undefined): "DMY" | "MDY" | null {
  const text = (value ?? "").trim().toUpperCase().replace(/-/g, "/");
  if (!text) return null;
  const dayFirst = text.indexOf("DD/MM");
  const monthFirst = text.indexOf("MM/DD");
  if (dayFirst >= 0 && (monthFirst < 0 || dayFirst < monthFirst)) return "DMY";
  if (monthFirst >= 0) return "MDY";
  if (text.includes("DAY/MONTH") || text === "DMY") return "DMY";
  return null;
}

function dateOrderFromBirth(value: string | null | undefined): "DMY" | "MDY" | null {
  const match = (value ?? "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (first > 12 && second >= 1 && second <= 12) return "DMY";
  if (second > 12 && first >= 1 && first <= 12) return "MDY";
  return null;
}
