import { z } from "zod";
import { generateObject } from "@/lib/orders/ai";
import {
  listEdgeCredentialsForCountry,
  listEdgeEquivalenciesForCredential,
  resolveEdgeCountrySlug,
  type Db,
} from "@/lib/orders/db";
import {
  chooseEquivalency,
  countrySlug,
  draftEquivalency,
  edgeContentExcerpt,
  edgeEquivalencyPrompt,
  matchEdgeCredential,
  pickEdgeEquivalency,
  US_EQUIVALENCY_LABELS,
  type EdgeCredentialMatch,
  type EdgeCredentialRecord,
  type EdgeEquivalencyRecord,
} from "@/lib/orders/edge";
import { PENDING_EQUIVALENCY } from "@/lib/orders/equivalency";
import type { PrintedCredential } from "@/lib/orders/evaluation";
import { usEquivalency } from "@/lib/orders/grades";
import type { PreEvalConfidence } from "./constants";

const proposalSchema = z.object({
  usEquivalency: z.enum([...US_EQUIVALENCY_LABELS, ""]),
  confident: z.boolean(),
});

export type PreEvalSuggestion = {
  country: string | null;
  credentialName: string | null;
  equivalent: string;
  confidence: PreEvalConfidence;
  rationale: string;
  documentKind: "diploma" | "transcript";
  degreeCount: number;
  edgeCredentialId: string | null;
  edgeMatchMethod: "base" | "fuzzy" | null;
};

const CONFIDENCE_RANK: Record<PreEvalConfidence, number> = { high: 3, medium: 2, low: 1 };

export function preEvalRationale(input: {
  country: string;
  credentialName: string;
  equivalent: string;
  confidence: PreEvalConfidence;
  matched: boolean;
}): string {
  const credential = clip(input.credentialName);
  const country = clip(input.country);
  if (!input.matched || input.equivalent === PENDING_EQUIVALENCY) {
    return "We could not match this document to a known credential. This is a free suggestion, not an official evaluation.";
  }
  const named = credential && country ? `${credential} from ${country}` : credential || country || "this credential";
  if (input.confidence === "low") {
    return `The printed ${named} only loosely matches a known credential. This is a free suggestion, not an official evaluation.`;
  }
  return `The printed ${named} matches a known credential. This is a free suggestion, not an official evaluation.`;
}

function clip(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117).trimEnd()}…`;
}

export function unmatchedSuggestion(): PreEvalSuggestion {
  return {
    country: null,
    credentialName: null,
    equivalent: PENDING_EQUIVALENCY,
    confidence: "low",
    rationale: preEvalRationale({
      country: "",
      credentialName: "",
      equivalent: PENDING_EQUIVALENCY,
      confidence: "low",
      matched: false,
    }),
    documentKind: "diploma",
    degreeCount: 1,
    edgeCredentialId: null,
    edgeMatchMethod: null,
  };
}

/** One printed title against the equivalency rows already loaded for its country. */
export function suggestFromEdgeRows(input: {
  printed: PrintedCredential;
  credentials: readonly EdgeCredentialRecord[];
  equivalencies: readonly EdgeEquivalencyRecord[];
}): PreEvalSuggestion {
  const matched = matchEdgeCredential(input.credentials, {
    country: input.printed.country,
    title: input.printed.credential,
  });
  const rows = matched
    ? input.equivalencies.filter((row) => row.edgeCredentialId === matched.id)
    : [];
  const suggestion = pickEdgeEquivalency(rows);
  const draft = draftEquivalency({
    printed: input.printed.credential,
    suggestion,
    fallback: usEquivalency(input.printed.credential) ?? PENDING_EQUIVALENCY,
  });
  const equivalent = draft.usEquivalency;
  const confidence: PreEvalConfidence =
    !suggestion || equivalent === PENDING_EQUIVALENCY ? "low" : suggestion.confidence;
  const matchedRow = Boolean(suggestion) && equivalent !== PENDING_EQUIVALENCY;
  const country = input.printed.country.trim() || null;
  const credentialName = input.printed.credential.trim() || null;
  return {
    country,
    credentialName,
    equivalent,
    confidence,
    rationale: preEvalRationale({
      country: country ?? "",
      credentialName: credentialName ?? "",
      equivalent,
      confidence,
      matched: matchedRow,
    }),
    documentKind: input.printed.kind === "transcript" ? "transcript" : "diploma",
    degreeCount: 1,
    edgeCredentialId: matched?.id ?? null,
    edgeMatchMethod: matched ? matched.matchMethod : null,
  };
}

export function pickBestSuggestion(suggestions: readonly PreEvalSuggestion[]): PreEvalSuggestion {
  const ranked = [...suggestions].sort((left, right) => {
    const leftNamed = left.equivalent === PENDING_EQUIVALENCY ? 0 : 1;
    const rightNamed = right.equivalent === PENDING_EQUIVALENCY ? 0 : 1;
    if (leftNamed !== rightNamed) return rightNamed - leftNamed;
    return CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
  });
  return ranked[0] ?? unmatchedSuggestion();
}

async function proposeLabel(printed: string, credential: EdgeCredentialMatch): Promise<string | null> {
  try {
    const ai = await generateObject(
      proposalSchema,
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: edgeEquivalencyPrompt({
                country: credential.country,
                printedTitle: printed,
                edgeTitle: credential.title,
                levelNumber: credential.levelNumber,
                levelTitle: credential.levelTitle,
                contentExcerpt: edgeContentExcerpt(credential.content, 1200),
                usEquivalencyHint: credential.usEquivalency,
                gradingRows: [],
              }),
            },
          ],
        },
      ],
      undefined,
      { maxRetries: 1 },
    );
    return chooseEquivalency({
      matched: true,
      edgeUsEquivalency: credential.usEquivalency,
      ai,
      printed,
    });
  } catch {
    console.error("pre-evaluation equivalency proposal failed");
    return null;
  }
}

async function suggestOne(db: Db, printed: PrintedCredential): Promise<PreEvalSuggestion> {
  const slug = countrySlug(printed.country);
  if (!slug || printed.country === PENDING_EQUIVALENCY) {
    return suggestFromEdgeRows({ printed, credentials: [], equivalencies: [] });
  }
  let resolved: string | null = null;
  try {
    resolved = await resolveEdgeCountrySlug(db, slug);
  } catch {
    console.error("pre-evaluation reference lookup failed");
    return suggestFromEdgeRows({ printed, credentials: [], equivalencies: [] });
  }
  if (!resolved) return suggestFromEdgeRows({ printed, credentials: [], equivalencies: [] });
  let credentials: EdgeCredentialRecord[] = [];
  try {
    credentials = await listEdgeCredentialsForCountry(db, resolved);
  } catch {
    console.error("pre-evaluation reference lookup failed");
    return suggestFromEdgeRows({ printed, credentials: [], equivalencies: [] });
  }
  const matched = matchEdgeCredential(credentials, { country: printed.country, title: printed.credential });
  let equivalencies: EdgeEquivalencyRecord[] = [];
  if (matched) {
    try {
      equivalencies = await listEdgeEquivalenciesForCredential(db, matched.id);
    } catch {
      console.error("pre-evaluation reference lookup failed");
    }
  }
  const base = suggestFromEdgeRows({ printed, credentials, equivalencies });
  if (!matched || equivalencies.length > 0) return base;
  const proposed = await proposeLabel(printed.credential, matched);
  if (!proposed || proposed === PENDING_EQUIVALENCY) return base;
  return {
    ...base,
    equivalent: proposed,
    confidence: "low",
    rationale: preEvalRationale({
      country: base.country ?? "",
      credentialName: base.credentialName ?? "",
      equivalent: proposed,
      confidence: "low",
      matched: true,
    }),
  };
}

export async function suggestPrintedCredentials(
  db: Db,
  printed: readonly PrintedCredential[],
): Promise<PreEvalSuggestion> {
  if (printed.length === 0) return unmatchedSuggestion();
  const suggestions: PreEvalSuggestion[] = [];
  for (const item of printed.slice(0, 5)) {
    suggestions.push(await suggestOne(db, item));
  }
  const best = pickBestSuggestion(suggestions);
  const diplomas = printed.filter((item) => item.kind === "diploma").length;
  return { ...best, degreeCount: diplomas > 0 ? Math.min(5, diplomas) : 1 };
}
