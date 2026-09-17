/** What the app says about videos left and what to do at zero.
 *  Pure so every sentence is tested — this is the copy a user reads right
 *  before deciding whether to pay. */
import { FREE, TIERS, TOPUP } from "./site";

export type BillingView = {
  standing: "free" | "paid" | "lapsed";
  limit: number;
  used: number;
  topup: number;
  remaining: number;
  resetsAt: number | null;
  tier: "solo" | "studio" | null;
  term: "monthly" | "quarterly" | "annual" | "threeYear" | null;
  foundingNumber: number | null;
  accessEndsAt: number | null;
  cancelAt: number | null;
  paymentFailed: boolean;
  pausedUntil: number | null;
  canPause: boolean;
  pauseAvailableAt: number | null;
  canManage: boolean;
};

export type BillingError = { kind: "ALLOWANCE" | "PLAN" | "QUOTA_FULL"; reason: string; message: string };

/** Pull our KIND|reason|message out of whatever the Convex client threw. */
export function parseBillingError(err: unknown): BillingError | null {
  const data = (err as { data?: unknown })?.data;
  const text = typeof data === "string" ? data : err instanceof Error ? err.message : String(err ?? "");
  const m = /(ALLOWANCE|PLAN|QUOTA_FULL)\|([a-z_0-9]*)\|([^\n]*)/.exec(text);
  if (!m) return null;
  return { kind: m[1] as BillingError["kind"], reason: m[2], message: m[3].trim() };
}

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The nav chip. Short, and honest about zero. */
export function meterChip(b: BillingView): { text: string; tone: "ok" | "low" | "out" | "warn"; title: string } {
  if (b.paymentFailed) return { text: "PAYMENT FAILED", tone: "warn", title: "Your last payment didn't go through. Update your card in Settings." };
  if (b.pausedUntil) return { text: `PAUSED · ${day(b.pausedUntil).toUpperCase()}`, tone: "warn", title: "Posting is held until the pause ends." };
  if (b.standing === "lapsed") return { text: "PLAN ENDED", tone: "out", title: "Pick a plan to keep making videos." };
  const tone = b.remaining === 0 ? "out" : b.remaining <= 2 ? "low" : "ok";
  if (b.standing === "free") {
    return { text: `${b.remaining} OF ${FREE.videosTotal} FREE`, tone, title: `${b.remaining} free ${b.remaining === 1 ? "video" : "videos"} left. Previews are always free.` };
  }
  const refill = b.resetsAt ? ` Refills ${day(b.resetsAt)}.` : "";
  const extra = b.topup > 0 ? ` Includes ${b.topup} top-up.` : "";
  return { text: `${b.remaining} LEFT`, tone, title: `${b.remaining} ${b.remaining === 1 ? "video" : "videos"} left this month.${extra}${refill}` };
}

export type ZeroAction =
  | { label: string; lookupKey: string; primary?: boolean }
  | { label: string; portal: true; primary?: boolean };

/** The sheet shown instead of a keep when nothing is left. Skipping always still works. */
export function atZero(reason: string, b: BillingView | null): { title: string; body: string; actions: ZeroAction[] } {
  const [solo, studio] = TIERS;
  const plans: ZeroAction[] = [
    { label: `${solo.name} · ${solo.videos} videos a month · $${solo.monthly}`, lookupKey: `${solo.id}_monthly`, primary: true },
    { label: `${studio.name} · ${studio.videos} videos a month · $${studio.monthly}`, lookupKey: `${studio.id}_monthly` },
  ];
  if (reason === "month_used" && b) {
    const actions: ZeroAction[] = [{ label: `Add ${TOPUP.videos} videos · $${TOPUP.price}`, lookupKey: `topup_${TOPUP.videos}`, primary: true }];
    if (b.tier === "solo" && b.term !== "threeYear") actions.push({ label: `Switch to ${studio.name} · ${studio.videos} a month`, portal: true });
    return {
      title: `You've used this month's ${b.limit} videos.`,
      body: `${b.resetsAt ? `They refill on ${day(b.resetsAt)}. ` : ""}Previews stay free, so keep browsing and skipping.`,
      actions,
    };
  }
  if (reason === "no_plan") {
    return { title: "Your plan has ended.", body: "Pick a plan to keep making videos. Your brand, drafts and schedule are all still here.", actions: plans };
  }
  return {
    title: `You've used your ${FREE.videosTotal} free videos.`,
    body: "Pick a plan to keep the ones you like. Previews stay free, and a card is only asked for at checkout.",
    actions: plans,
  };
}
