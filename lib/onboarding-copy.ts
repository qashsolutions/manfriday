/** Copy helpers for the first-run progress block (app/(app)/onboarding).
 *  Pure so the wording can be tested: this is what a new user stares at
 *  while Friday works, and it must never over- or under-claim. */

/** 0 reading the site · 1 writing concepts · 2 rendering previews · 3 finished. */
export function stageIndex(status: string | undefined, previews: { ready: number; total: number }): number {
  if (status === "done") return previews.total > 0 && previews.ready >= previews.total ? 3 : 2;
  if (status === "drafting") return 1;
  return 0;
}

/** What Friday has to show for it, in words that read right at 1 and at 10. */
export function previewLine(ready: number, total: number): string {
  if (total === 0) return "Friday is rendering your previews — they appear in Picks as they finish.";
  if (ready < total) return `${ready} of ${total} ready — the rest are rendering.`;
  return total === 1 ? "Your preview is ready." : `All ${total} previews are ready.`;
}
