const LANGUAGE_NAMES: Record<string, string> = {
  spanish: "es",
  portuguese: "pt",
  french: "fr",
  german: "de",
  italian: "it",
  chinese: "zh",
  japanese: "ja",
  korean: "ko",
  arabic: "ar",
  russian: "ru",
  hindi: "hi",
  vietnamese: "vi",
  polish: "pl",
  ukrainian: "uk",
  dutch: "nl",
  turkish: "tr",
  romanian: "ro",
  greek: "el",
  thai: "th",
  indonesian: "id",
  swedish: "sv",
  danish: "da",
  norwegian: "no",
  finnish: "fi",
  czech: "cs",
  hungarian: "hu",
  hebrew: "he",
  persian: "fa",
  farsi: "fa",
  bengali: "bn",
  urdu: "ur",
  tagalog: "tl",
  filipino: "tl",
  english: "en",
};

const SUPPORTED = new Set([
  "es",
  "pt",
  "fr",
  "de",
  "it",
  "zh",
  "ja",
  "ko",
  "ar",
  "ru",
  "hi",
  "vi",
  "pl",
  "uk",
  "nl",
  "tr",
  "ro",
  "el",
  "th",
  "id",
  "sv",
  "da",
  "no",
  "nb",
  "fi",
  "cs",
  "hu",
  "he",
  "fa",
  "bn",
  "ur",
  "tl",
]);

export function normalizeLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase().replace(/_/g, "-");
  if (!trimmed) return null;
  const base = trimmed.split("-")[0] ?? trimmed;
  if (/^[a-z]{2}$/.test(base)) return base === "nb" ? "no" : base;
  return LANGUAGE_NAMES[trimmed] ?? LANGUAGE_NAMES[base] ?? null;
}

export function isSupportedSourceLanguage(code: string | null): boolean {
  return code != null && code !== "en" && SUPPORTED.has(code);
}

export function languageLabel(code: string): string {
  const entry = Object.entries(LANGUAGE_NAMES).find(([, value]) => value === code);
  if (!entry) return code;
  return entry[0].slice(0, 1).toUpperCase() + entry[0].slice(1);
}

export function languagesEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeLanguage(left);
  const b = normalizeLanguage(right);
  return a != null && a === b;
}

/** Languages the customer can send on confirm. `needs_review` is staff-only. */
export function sourceLanguageChoices(): Array<{ code: string; label: string }> {
  return [...SUPPORTED]
    .map((code) => ({ code, label: languageLabel(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Target languages, including English. There is no customer route that saves this choice. */
export function targetLanguageChoices(): Array<{ code: string; label: string }> {
  return [{ code: "en", label: languageLabel("en") }, ...sourceLanguageChoices()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
