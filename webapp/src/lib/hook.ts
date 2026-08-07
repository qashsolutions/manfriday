/** The Hook Doctor's shared contract — the few things the compose page and the
    route have to agree on word for word: how long an opening is allowed to be,
    the one line the product answers with when it's asked to write the whole
    script, and the label a read wears when it isn't grounded in the creator's
    own numbers yet.

    Client-safe on purpose: the page enforces the limit as you type and the
    route enforces it again on arrival, and neither may drift from the other. */

/** About thirty seconds of speech. The opening is the whole job here — past it
    the words are the creator's to write. */
export const OPENING_WORD_LIMIT = 120;

/** How far into a video an opening reaches, in seconds. Nothing this surface
    writes goes beyond it. */
export const OPENING_SECONDS = 30;

/** The one honest line the product answers with when it's handed more than an
    opening — the same sentence in the page and in the route, so the answer is
    the same wherever the ask arrives. */
export const GHOSTWRITE_LINE =
  "The team works on openings — the first 30 seconds, where most viewers decide whether to stay. " +
  "Paste about 120 words of that and you'll get openings back; the rest of the script stays yours to write.";

/** What a read is called when the creator's videos can't yet show where
    viewers left. Honest by design: it says what the options ARE, not what
    they're missing. */
export const CRAFT_LABEL = "craft-based — not yet grounded in your numbers (too few viewers so far)";

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** True when what was pasted is more than an opening. */
export function overOpeningLimit(text: string): boolean {
  return wordCount(text) > OPENING_WORD_LIMIT;
}

/** The three shapes an opening can take. The creator picks between shapes, not
    between wordings — that's what makes it a choice rather than an order. */
export type HookShape = "cold open" | "question" | "result-first";

export type HookEvidence = {
  kind: "ledger" | "library" | "search" | "audience" | "caution";
  label: string;
};

export type HookRewrite = {
  shape: HookShape;
  effort: string;
  choice: string;
  opening: string;
  why: string;
  confidence: number;
  evidence: HookEvidence[];
};

export type HookAnalysis = {
  in_short: string;
  where_they_left: string | null;
  voice_note: string | null;
  rewrites: HookRewrite[];
};

/** One second where viewers left, on one of the creator's own videos. */
export type HookExit = {
  videoTitle: string;
  /** "0:22" — a real position in a real video, never a guess. */
  label: string;
  atSeconds: number;
  /** Viewers lost at this step, per 100 of the ones who got that far. */
  lostPer100: number;
  /** Viewers still watching just after it, per 100 who started. */
  stillPer100: number;
};

/** How well one video's opening held, at the 30-second mark. */
export type HookHold = {
  videoTitle: string;
  label: string;
  heldPer100: number;
};

/** Exactly what the route hands back. `grounded` is the server's call, never
    the model's: the honest label can't be talked out of by something that
    wants to be helpful. */
export type HookRead = {
  grounded: boolean;
  exits: HookExit[];
  held: HookHold[];
  videosRead: number;
  /** How many viewers a video needs before the team will trust where they
      left — the number the honest thin state explains itself with. */
  viewsFloor: number;
  target: { ytVideoId: string; title: string } | null;
  draft: string | null;
  checkBy: string | null;
  analysis: HookAnalysis | null;
  createdAt?: string | null;
};
