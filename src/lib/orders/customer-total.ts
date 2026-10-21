import { HttpError } from "./errors";

const CLIENT_TOTAL_FIELDS = [
  "total",
  "totalCents",
  "total_cents",
  "amount",
  "amountCents",
  "amount_cents",
  "evaluationCents",
  "evaluation_cents",
  "translationCents",
  "translation_cents",
  "unitPriceCents",
  "unit_price_cents",
] as const;

/** The server prices every selected service. A client total is rejected. */
export function rejectCustomerTotal(record: Record<string, unknown>): void {
  for (const field of CLIENT_TOTAL_FIELDS) {
    if (!(field in record)) continue;
    const value = record[field];
    if (value == null || value === "") continue;
    throw new HttpError("The total is calculated by the server.", 400);
  }
}
