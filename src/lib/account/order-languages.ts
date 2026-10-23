import type { CustomerOrder, CustomerOrderDocument } from "@/lib/api/types";
import { isMockMode } from "@/lib/account/session";
import { createClient } from "@/lib/supabase/server";

export type OrderLanguageRow = {
  id: string;
  source_language?: string | null;
  target_language?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
};

export type DocumentLanguageRow = {
  order_id?: string | null;
  orderId?: string | null;
  detected_language?: string | null;
  detectedLanguage?: string | null;
  source_language?: string | null;
  sourceLanguage?: string | null;
  target_language?: string | null;
  targetLanguage?: string | null;
  source_language_name?: string | null;
  sourceLanguageName?: string | null;
  target_language_name?: string | null;
  targetLanguageName?: string | null;
  position?: number | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstClean(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = clean(value);
    if (trimmed) return trimmed;
  }
  return null;
}

function documentLanguages(document: DocumentLanguageRow): CustomerOrderDocument {
  return {
    detectedLanguage: firstClean(document.detectedLanguage, document.detected_language),
    sourceLanguage: firstClean(document.sourceLanguage, document.source_language),
    targetLanguage: firstClean(document.targetLanguage, document.target_language),
    sourceLanguageName: firstClean(document.sourceLanguageName, document.source_language_name),
    targetLanguageName: firstClean(document.targetLanguageName, document.target_language_name),
  };
}

function hasLanguage(document: CustomerOrderDocument): boolean {
  return Boolean(
    document.detectedLanguage ||
      document.sourceLanguage ||
      document.targetLanguage ||
      document.sourceLanguageName ||
      document.targetLanguageName,
  );
}

function orderAlreadyHasLanguage(order: CustomerOrder): boolean {
  if (firstClean(order.sourceLanguage, order.sourceLanguageName)) return true;
  return (order.documents ?? []).some((document) =>
    firstClean(document.sourceLanguage, document.sourceLanguageName, document.detectedLanguage),
  );
}

/**
 * Copy source and target language from the order row, then from its documents.
 * Leaves an order untouched when none of those fields has a language.
 */
export function applyOrderLanguages(
  orders: readonly CustomerOrder[],
  rows: readonly OrderLanguageRow[],
  documents: readonly DocumentLanguageRow[] = [],
): CustomerOrder[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const docsByOrder = new Map<string, DocumentLanguageRow[]>();
  for (const document of documents) {
    const id = document.orderId ?? document.order_id;
    if (!id) continue;
    const list = docsByOrder.get(id) ?? [];
    list.push(document);
    docsByOrder.set(id, list);
  }

  return orders.map((order) => {
    const row = byId.get(order.id);
    const related = [...(docsByOrder.get(order.id) ?? [])].sort(
      (left, right) => (left.position ?? 0) - (right.position ?? 0),
    );
    const parsedDocuments = related.map(documentLanguages).filter(hasLanguage);
    const fromDocument = parsedDocuments
      .map((document) => firstClean(document.sourceLanguage, document.sourceLanguageName, document.detectedLanguage))
      .find((value) => value);
    const source =
      firstClean(order.sourceLanguage, order.sourceLanguageName, row?.sourceLanguage, row?.source_language) ??
      fromDocument ??
      null;
    const target =
      firstClean(
        order.targetLanguage,
        order.targetLanguageName,
        row?.targetLanguage,
        row?.target_language,
        ...parsedDocuments.map((document) => firstClean(document.targetLanguage, document.targetLanguageName)),
      ) ?? null;
    if (!source && !target) return order;
    return {
      ...order,
      sourceLanguage: source,
      targetLanguage: target ?? order.targetLanguage ?? null,
      documents: order.documents?.length ? order.documents : parsedDocuments.length > 0 ? parsedDocuments : null,
    };
  });
}

/** Fill languages the orders list omitted, from the signed-in customer's own rows. */
export async function attachDashboardLanguages(orders: CustomerOrder[]): Promise<CustomerOrder[]> {
  if (orders.length === 0 || isMockMode()) return orders;
  if (orders.every(orderAlreadyHasLanguage)) return orders;
  try {
    const supabase = await createClient();
    const ids = orders.map((order) => order.id);
    const [orderResult, documentResult] = await Promise.all([
      supabase.from("orders").select("id, source_language, target_language").in("id", ids),
      supabase.from("documents").select("order_id, detected_language, position").in("order_id", ids),
    ]);
    return applyOrderLanguages(
      orders,
      (orderResult.data ?? []) as OrderLanguageRow[],
      (documentResult.data ?? []) as DocumentLanguageRow[],
    );
  } catch {
    return orders;
  }
}
