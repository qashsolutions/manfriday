/** Copy for "Why this pick": what each hook pattern does for a viewer, and
 *  plain names for trend-library spaces. Deterministic — no model writes this. */

export const PATTERN_WHY: Record<string, { name: string; why: string }> = {
  "confession-turn": {
    name: "Confession, then the turn",
    why: "Admitting a slow start earns trust in the first second; people stay to see what changed.",
  },
  "bold-claim-receipts": {
    name: "Bold claim, then proof",
    why: "A specific claim up front stops the scroll; viewers stay to check whether it holds up.",
  },
  "bold-claim": {
    name: "Bold claim, then proof",
    why: "A specific claim up front stops the scroll; viewers stay to check whether it holds up.",
  },
  pov: {
    name: "POV",
    why: "Puts the viewer inside the result, so they picture themselves using the product.",
  },
  listicle: {
    name: "Numbered list",
    why: "A count promises a clear payoff and an end point, so people stay to the last item.",
  },
  "listicle-tools": {
    name: "Numbered list",
    why: "A count promises a clear payoff and an end point, so people stay to the last item.",
  },
  "unpopular-opinion": {
    name: "Unpopular opinion",
    why: "Disagreeing with common advice gets a reaction; people stay to agree or argue.",
  },
  "hot-take": {
    name: "Hot take",
    why: "Disagreeing with common advice gets a reaction; people stay to agree or argue.",
  },
  "wish-i-knew": {
    name: "What I wish I knew",
    why: "Speaks to someone just before a mistake; it gets saved and sent to friends.",
  },
  "curiosity-gap-reveal": {
    name: "Question first, answer last",
    why: "The first line opens a question only the end answers, so people watch to the end.",
  },
  "mystery-reveal": {
    name: "Question first, answer last",
    why: "The first line opens a question only the end answers, so people watch to the end.",
  },
  "before-after": {
    name: "Before and after",
    why: "The contrast shows the value without having to explain it.",
  },
  "day-n-buildlog": {
    name: "Day N log",
    why: "A running series gives people a reason to follow for the next one.",
  },
  "tool-demo": {
    name: "Show it working",
    why: "Watching the product do the job is the proof; no claim needed.",
  },
};

export function patternWhy(pattern: string) {
  return (
    PATTERN_WHY[pattern] ?? {
      name: pattern ? pattern.replace(/-/g, " ") : "Proven shape",
      why: "Friday wrote this in the shape of a post that already beat its creator's usual numbers.",
    }
  );
}

const SPACE_NAMES: Record<string, string> = {
  "ai-tools": "AI tools",
  "dev-tools": "developer tools",
  "build-in-public": "build in public",
  "solo-saas": "solo SaaS",
  "consumer-apps": "consumer apps",
  "productivity-tools": "productivity tools",
  edtech: "education",
  "b2b-smb": "B2B for small businesses",
  "d2c-ecommerce": "online brands",
  "local-services": "local businesses",
};

export function spaceName(slug: string | null | undefined): string {
  if (!slug) return "another space";
  return SPACE_NAMES[slug] ?? slug.replace(/-/g, " ");
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** "beat their usual views 89×" — only when the ratio is real and meaningful. */
export function outlierLine(x: number | null): string | null {
  if (x === null || !Number.isFinite(x) || x < 1.5) return null;
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)}× that creator's usual views`;
}

export const PLATFORM_NAME: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};
