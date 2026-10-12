export type ExtractedCredentialTitle = { country: string; title: string };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Printed country and credential title from a stored evaluation. Skips blank titles. */
export function extractedCredentialTitles(result: unknown): ExtractedCredentialTitle[] {
  if (!result || typeof result !== "object") return [];
  const row = result as Record<string, unknown>;
  if (row.kind === "diploma" && Array.isArray(row.credentials)) {
    return row.credentials.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const credential = entry as Record<string, unknown>;
      const country = text(credential.country);
      const title = text(credential.credential);
      if (!country || !title) return [];
      return [{ country, title }];
    });
  }
  if (row.kind === "course_by_course") {
    const country = text(row.country);
    const title = text(row.credential);
    if (!country || !title) return [];
    return [{ country, title }];
  }
  return [];
}
