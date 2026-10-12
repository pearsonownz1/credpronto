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
  bokmal: "no",
  "bokmål": "no",
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

/** Customer-facing names. `nb` is Bokmål and shares the Norwegian label. */
const CODE_LABELS: Record<string, string> = {
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  ru: "Russian",
  hi: "Hindi",
  vi: "Vietnamese",
  pl: "Polish",
  uk: "Ukrainian",
  nl: "Dutch",
  tr: "Turkish",
  ro: "Romanian",
  el: "Greek",
  th: "Thai",
  id: "Indonesian",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian (Bokmål)",
  fi: "Finnish",
  cs: "Czech",
  hu: "Hungarian",
  he: "Hebrew",
  fa: "Persian",
  bn: "Bengali",
  ur: "Urdu",
  tl: "Tagalog",
  en: "English",
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
  const normalized = normalizeLanguage(code);
  return normalized != null && normalized !== "en" && SUPPORTED.has(normalized);
}

export function languageLabel(code: string): string {
  const normalized = normalizeLanguage(code);
  if (normalized && CODE_LABELS[normalized]) return CODE_LABELS[normalized];
  return "Unknown";
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
  const seen = new Set<string>();
  const choices: Array<{ code: string; label: string }> = [];
  for (const code of SUPPORTED) {
    const label = languageLabel(code);
    if (seen.has(code) || seen.has(label)) continue;
    if (/^[a-z]{2,3}$/i.test(label)) continue;
    seen.add(code);
    seen.add(label);
    choices.push({ code, label });
  }
  return choices.sort((a, b) => a.label.localeCompare(b.label));
}

/** Target languages, including English. The quote page saves a new choice with PATCH. */
export function targetLanguageChoices(): Array<{ code: string; label: string }> {
  const choices = [{ code: "en", label: languageLabel("en") }, ...sourceLanguageChoices()];
  const seen = new Set<string>();
  return choices
    .filter((choice) => {
      if (seen.has(choice.code) || seen.has(choice.label)) return false;
      seen.add(choice.code);
      seen.add(choice.label);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
