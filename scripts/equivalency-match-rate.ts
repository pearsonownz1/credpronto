/**
 * Match rate for extracted evaluation titles against the credential catalog.
 *
 * Reads SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * from the environment. Does not print those values, licensed row text, or the basis.
 *
 *   npx tsx scripts/equivalency-match-rate.ts
 */
import { createClient } from "@supabase/supabase-js";
import { mapEdgeCredentialRow, matchEdgeCredential, type EdgeCredentialRecord } from "../src/lib/orders/edge";
import { extractedCredentialTitles, type ExtractedCredentialTitle } from "../src/lib/orders/equivalency-match";
import { readServiceRoleEnv } from "../src/lib/supabase/env";

const PAGE = 1000;

function serviceClient(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type ServiceClient = ReturnType<typeof serviceClient>;

function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : "Equivalency match rate failed";
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) message = message.split(secret).join("[redacted]");
  return message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]");
}

async function loadCredentials(db: ServiceClient): Promise<EdgeCredentialRecord[]> {
  const rows: EdgeCredentialRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("edge_credentials")
      .select("id, country_slug, country, title, level_number, level_title, url, us_equivalency")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    for (const row of page) {
      const mapped = mapEdgeCredentialRow(row as Record<string, unknown>);
      if (mapped) rows.push(mapped);
    }
    if (page.length < PAGE) return rows;
  }
}

async function loadTitles(db: ServiceClient): Promise<ExtractedCredentialTitle[]> {
  const titles: ExtractedCredentialTitle[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("orders")
      .select("evaluation_result")
      .eq("order_type", "evaluation")
      .not("evaluation_result", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    for (const row of page) {
      titles.push(...extractedCredentialTitles((row as { evaluation_result?: unknown }).evaluation_result));
    }
    if (page.length < PAGE) return titles;
  }
}

async function main(): Promise<void> {
  const { url, key } = readServiceRoleEnv();
  const db = serviceClient(url, key);
  const [credentials, titles] = await Promise.all([loadCredentials(db), loadTitles(db)]);

  let matched = 0;
  let base = 0;
  let fuzzy = 0;
  const unmatched = new Map<string, number>();
  for (const title of titles) {
    const hit = matchEdgeCredential(credentials, title);
    if (!hit) {
      const label = `${title.country} — ${title.title}`;
      unmatched.set(label, (unmatched.get(label) ?? 0) + 1);
      continue;
    }
    matched += 1;
    if (hit.matchMethod === "base") base += 1;
    else fuzzy += 1;
  }

  const total = titles.length;
  const percent = total === 0 ? "0.0" : ((matched / total) * 100).toFixed(1);
  console.log(`Matched ${matched} of ${total} (${percent}%). base ${base}, fuzzy ${fuzzy}.`);
  console.log("Unmatched:");
  const lines = [...unmatched.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  if (lines.length === 0) {
    console.log("(none)");
    return;
  }
  for (const [label, count] of lines) {
    console.log(count > 1 ? `${label} (${count})` : label);
  }
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/scripts/equivalency-match-rate.ts") || entry?.endsWith("/scripts/equivalency-match-rate.js")) {
  main().catch((error: unknown) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
