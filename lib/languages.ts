/** Language UX (docs/language-ux.md): detect, chip, combobox, multiply.
 *  Shared by the web app; the Python worker mirrors the codes in slots.py. */

export type LanguageStyle = "code-mixed" | "native" | "roman";

export type LanguageMeta = {
  code: string;
  name: string;
  native: string;
  /** Sarvam Bulbul covers these; they get the "how it sounds" control. */
  indic: boolean;
  /** What code-mixing with English is called for this language. */
  mixedLabel?: string;
  /** Extra search terms (lowercase). */
  aliases: string[];
  /** Sensible "also in" suggestions when the brief has no markets. */
  suggests: string[];
};

export const LANGUAGE_META: readonly LanguageMeta[] = [
  { code: "en", name: "English", native: "English", indic: false, aliases: ["eng"], suggests: ["es", "hi", "pt-BR"] },
  { code: "es", name: "Spanish", native: "Español", indic: false, aliases: ["espanol", "castellano", "mx", "latam"], suggests: ["en", "pt-BR"] },
  { code: "pt-BR", name: "Portuguese (Brazil)", native: "Português", indic: false, aliases: ["portugues", "brasil", "brazil", "pt"], suggests: ["es", "en"] },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", indic: false, aliases: ["bahasa", "indonesia"], suggests: ["en"] },
  { code: "hi", name: "Hindi", native: "हिन्दी", indic: true, mixedLabel: "Hinglish", aliases: ["hinglish", "hindi"], suggests: ["en", "ta", "te"] },
  { code: "bn", name: "Bengali", native: "বাংলা", indic: true, mixedLabel: "Benglish", aliases: ["bangla", "benglish"], suggests: ["en", "hi"] },
  { code: "ta", name: "Tamil", native: "தமிழ்", indic: true, mixedLabel: "Tanglish", aliases: ["tanglish"], suggests: ["en", "te", "hi"] },
  { code: "te", name: "Telugu", native: "తెలుగు", indic: true, mixedLabel: "Tenglish", aliases: ["tenglish"], suggests: ["en", "ta", "hi"] },
  { code: "mr", name: "Marathi", native: "मराठी", indic: true, mixedLabel: "Marathi-English", aliases: [], suggests: ["en", "hi"] },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", indic: true, mixedLabel: "Kanglish", aliases: ["kanglish"], suggests: ["en", "hi", "ta"] },
  { code: "ml", name: "Malayalam", native: "മലയാളം", indic: true, mixedLabel: "Manglish", aliases: ["manglish"], suggests: ["en", "ta", "hi"] },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", indic: true, mixedLabel: "Gujarati-English", aliases: [], suggests: ["en", "hi"] },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", indic: true, mixedLabel: "Punjabi-English", aliases: ["panjabi"], suggests: ["en", "hi"] },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ", indic: true, mixedLabel: "Odia-English", aliases: ["oriya"], suggests: ["en", "hi"] },
] as const;

export const LANGUAGE_CODES = LANGUAGE_META.map((l) => l.code);

export function languageMeta(code: string): LanguageMeta {
  return LANGUAGE_META.find((l) => l.code === code) ?? LANGUAGE_META[0];
}

/** Type-ahead in any script: native name, English name, code, aliases. */
export function searchLanguages(query: string): LanguageMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...LANGUAGE_META];
  return LANGUAGE_META.filter(
    (l) =>
      l.native.toLowerCase().includes(q) ||
      l.name.toLowerCase().includes(q) ||
      l.code.toLowerCase().startsWith(q) ||
      l.aliases.some((a) => a.includes(q)),
  );
}

/** Labels for the "how it sounds" control, per language. */
export function styleOptions(code: string): Array<{ value: LanguageStyle; label: string; hint: string }> {
  const m = languageMeta(code);
  if (!m.indic) return [];
  return [
    { value: "code-mixed", label: m.mixedLabel ?? "Mixed", hint: "How most creators actually talk — English mixed in." },
    { value: "native", label: m.native, hint: `Pure ${m.name}, native script.` },
    { value: "roman", label: "Roman script", hint: `${m.name} written in Latin letters.` },
  ];
}

export function styleLabel(code: string, style?: LanguageStyle | null): string | null {
  if (!style) return null;
  return styleOptions(code).find((o) => o.value === style)?.label ?? null;
}

/** Up to three "also in" suggestions, never the primary language. */
export function suggestMarkets(primary: string, markets?: readonly string[] | null): LanguageMeta[] {
  const pool = (markets && markets.length ? markets : languageMeta(primary).suggests).filter((c) => c !== primary);
  const seen = new Set<string>();
  const out: LanguageMeta[] = [];
  for (const c of pool) {
    if (seen.has(c) || !LANGUAGE_CODES.includes(c)) continue;
    seen.add(c);
    out.push(languageMeta(c));
    if (out.length === 3) break;
  }
  return out;
}
