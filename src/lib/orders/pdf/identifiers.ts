import { z } from "zod";
import { generateObject } from "../ai";
import type { RenderBlock } from "./layout";
import { blocksToParagraphs } from "./structure";

export type DateOrder = "DMY" | "MDY";

type CivilDate = { year: number; month: number; day: number };

const verifySchema = z.object({
  fixes: z.array(z.object({ wrong: z.string(), right: z.string() })),
});

function civilDate(year: number, month: number, day: number): CivilDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1800 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function usDate(date: CivilDate): string {
  return writtenDate(date, "MM/DD/YYYY");
}

function writtenDate(date: CivilDate, format: "MM/DD/YYYY" | "DD/MM/YYYY"): string {
  const month = pad(date.month);
  const day = pad(date.day);
  return format === "DD/MM/YYYY" ? `${day}/${month}/${date.year}` : `${month}/${day}/${date.year}`;
}

export function sourceDateOrder(sourceLanguage: string, dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY"): DateOrder {
  const language = sourceLanguage.trim().toLowerCase();
  if (/^(tr|de|fr|es|pt|it|nl|pl|ru|el|ro|hu|cs|sk|sl|hr|sr|bg|uk|ar|fa|he)\b/.test(language)) return "DMY";
  return dateFormat === "DD/MM/YYYY" ? "DMY" : "MDY";
}

function sameDate(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

const DATE_TOKEN = /(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})/g;

function readToken(first: number, second: number, year: number, order: DateOrder): CivilDate | null {
  const dayFirst = civilDate(year, second, first);
  const monthFirst = civilDate(year, first, second);
  if (order === "DMY") return dayFirst ?? monthFirst;
  return monthFirst ?? dayFirst;
}

export function sourceDates(text: string, order: DateOrder): CivilDate[] {
  const found: CivilDate[] = [];
  for (const match of text.matchAll(DATE_TOKEN)) {
    const date = readToken(Number(match[1]), Number(match[2]), Number(match[3]), order);
    if (date && !found.some((item) => sameDate(item, date))) found.push(date);
  }
  return found;
}

function rewriteDates(text: string, sources: CivilDate[], format: "MM/DD/YYYY" | "DD/MM/YYYY"): string {
  if (sources.length === 0) return text;
  return text.replace(DATE_TOKEN, (full, a: string, b: string, y: string) => {
    const first = Number(a);
    const second = Number(b);
    const year = Number(y);
    const monthFirst = civilDate(year, first, second);
    const dayFirst = civilDate(year, second, first);
    const monthHit = monthFirst != null && sources.some((item) => sameDate(item, monthFirst));
    const dayHit = dayFirst != null && sources.some((item) => sameDate(item, dayFirst));
    if (monthHit && monthFirst && !dayHit) return writtenDate(monthFirst, format);
    if (dayHit && dayFirst && !monthHit) return writtenDate(dayFirst, format);
    if (monthHit && monthFirst) return writtenDate(monthFirst, format);
    if (dayHit && dayFirst) return writtenDate(dayFirst, format);
    return full;
  });
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const next = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min((next[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j] ?? 0;
  }
  return prev[b.length] ?? a.length;
}

function sourceNumbers(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\d{4,}/g), (match) => match[0]))];
}

function fixNumber(found: string, source: string[]): string {
  if (source.includes(found)) return found;
  const near = source.filter((item) => item.length === found.length && levenshtein(item, found) === 1);
  if (near.length === 1) return near[0] ?? found;
  const bare = found.replace(/^0+/, "") || "0";
  const padded = source.filter((item) => (item.replace(/^0+/, "") || "0") === bare);
  if (padded.length === 1) return padded[0] ?? found;
  return found;
}

function rewriteNumbers(text: string, source: string[]): string {
  if (source.length === 0) return text;
  return text.replace(/\d{4,}/g, (found) => fixNumber(found, source));
}

function mapText(blocks: RenderBlock[], fn: (text: string) => string): RenderBlock[] {
  return blocks.map((block) => {
    if (block.type === "heading" || block.type === "paragraph" || block.type === "note" || block.type === "logo" || block.type === "stamp" || block.type === "handwritten" || block.type === "seal") {
      return { ...block, text: fn(block.text) };
    }
    if (block.type === "kv" || block.type === "box") {
      return { ...block, label: fn(block.label), value: fn(block.value) };
    }
    if (block.type === "address") return { ...block, lines: block.lines.map(fn) };
    if (block.type === "fields") {
      return { ...block, rows: block.rows.map((row) => ({ label: fn(row.label), value: fn(row.value) })) };
    }
    if (block.type === "list") {
      return { ...block, label: block.label ? fn(block.label) : block.label, items: block.items.map(fn) };
    }
    if (block.type === "signature") return { ...block, lines: block.lines?.map(fn) };
    if (block.type === "table") return { ...block, rows: block.rows.map((row) => row.map(fn)) };
    if (block.type === "photo") return { ...block, caption: block.caption ? fn(block.caption) : block.caption };
    return block;
  });
}

/**
 * Put dates in the confirmed format and replace a near-miss ID with the source number.
 * 27379 does not survive when the source prints 24379.
 * A DD/MM/YYYY choice writes 19/09/1996, not 09/19/1996.
 */
export function reconcileIdentifiers(input: {
  sourceText: string;
  blocks: RenderBlock[];
  sourceLanguage: string;
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY";
}): RenderBlock[] {
  const order = sourceDateOrder(input.sourceLanguage, input.dateFormat);
  const dates = sourceDates(input.sourceText, order);
  const numbers = sourceNumbers(input.sourceText);
  return mapText(input.blocks, (text) => rewriteNumbers(rewriteDates(text, dates, input.dateFormat), numbers));
}

function hasIdentifiers(source: string, blocks: RenderBlock[]): boolean {
  const text = `${source}\n${blocksToParagraphs(blocks).join("\n")}`;
  return /\d{2,}/.test(text);
}

function grounded(source: string, right: string): boolean {
  const runs = right.match(/\d{2,}/g) ?? [];
  if (runs.length === 0) return false;
  const digits = source.replace(/\D/g, "");
  return runs.every((run) => {
    const bare = run.replace(/^0+/, "") || "0";
    return source.includes(run) || digits.includes(run) || digits.includes(bare);
  });
}

function replaceToken(text: string, wrong: string, right: string): string {
  const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<!\\d)${escaped}(?!\\d)`, "g"), right);
}

/** Apply a model fix only when every number in the replacement is on the source page. */
export function applyGroundedFixes(
  blocks: RenderBlock[],
  fixes: Array<{ wrong?: string; right?: string }>,
  sourceText: string,
): RenderBlock[] {
  const usable = fixes
    .map((fix) => ({ wrong: (fix.wrong ?? "").trim(), right: (fix.right ?? "").trim() }))
    .filter((fix) => fix.wrong.length >= 4 && fix.right.length > 0 && fix.wrong !== fix.right && grounded(sourceText, fix.right))
    .sort((a, b) => b.wrong.length - a.wrong.length);
  if (usable.length === 0) return blocks;
  return mapText(blocks, (text) => usable.reduce((current, fix) => replaceToken(current, fix.wrong, fix.right), text));
}

/**
 * A second model pass over numbers, IDs, and dates. A failed call keeps the
 * deterministic reconciliation, which already rejects a near-miss ID.
 */
export async function verifyIdentifiers(input: {
  sourceText: string;
  blocks: RenderBlock[];
  sourceLanguage: string;
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY";
  signal?: AbortSignal;
}): Promise<RenderBlock[]> {
  const reconciled = reconcileIdentifiers(input);
  if (!hasIdentifiers(input.sourceText, reconciled)) return reconciled;
  try {
    const translated = blocksToParagraphs(reconciled).join("\n");
    const order = sourceDateOrder(input.sourceLanguage, input.dateFormat);
    const result = await generateObject(
      verifySchema,
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Check this certified translation against the source page.
Source date order: ${order === "DMY" ? "day/month/year" : "month/day/year"}.
Write dates as ${input.dateFormat}. The day, month, and year must be the same civil date as the source.
Every number and ID in the translation must appear in the source. A one-digit difference is a mistake. Replace it with the source number.
Return fixes as {wrong, right}. right is copied from the source, or a date rewritten as ${input.dateFormat} using only digits from the source. If nothing is wrong, return an empty fixes array.
Do not change names. Do not invent digits.

Source:
${input.sourceText.slice(0, 8000)}

Translation:
${translated.slice(0, 8000)}`,
            },
          ],
        },
      ],
      input.signal,
      { maxRetries: 0 },
    );
    return reconcileIdentifiers({ ...input, blocks: applyGroundedFixes(reconciled, result.fixes, input.sourceText) });
  } catch {
    return reconciled;
  }
}
