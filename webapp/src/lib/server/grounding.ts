import type { SupabaseClient } from "@supabase/supabase-js";

/** What every analyst reads before advising: who this creator is for (their
    own words, from the profile page) and the team's verified track record on
    this exact channel (the Ledger). This is what makes advice tailored and
    confidence earned instead of one-size-fits-all. */

export type Grounding = { audienceBlock: string; trackBlock: string };

export async function analystGrounding(svc: SupabaseClient, userId: string): Promise<Grounding> {
  const [{ data: profs }, { data: verdictRecs }] = await Promise.all([
    svc.from("channel_profiles")
      .select("niche,audience,goals,tone,competitors")
      .eq("user_id", userId).limit(1),
    svc.from("recommendations")
      .select("category,verdict")
      .eq("user_id", userId).not("verdict", "is", null),
  ]);

  const p = profs?.[0] as { niche: string | null; audience: string | null; goals: string[] | null; tone: string | null; competitors: string[] | null } | undefined;
  const audienceLines: string[] = [];
  if (p?.niche) audienceLines.push(`Niche & who it's for: ${p.niche}`);
  if (p?.audience) audienceLines.push(`More about their viewers: ${p.audience}`);
  if (p?.goals?.length) audienceLines.push(`Their goals: ${p.goals.join("; ")}`);
  if (p?.tone) audienceLines.push(`Their tone: ${p.tone}`);
  if (p?.competitors?.length) audienceLines.push(`They measure themselves against: ${p.competitors.join(", ")}`);
  const audienceBlock = audienceLines.length
    ? `THE CREATOR'S OWN DEFINITION OF WHO THEY'RE FOR (tailor everything to this)\n${audienceLines.join("\n")}`
    : `THE CREATOR HASN'T FILLED IN THEIR AUDIENCE PROFILE YET — do not guess who they're for; audience-fit evidence is unavailable, say so where relevant.`;

  const byCat = new Map<string, { worked: number; mixed: number; failed: number }>();
  for (const r of (verdictRecs ?? []) as { category: string; verdict: string }[]) {
    const c = byCat.get(r.category) ?? { worked: 0, mixed: 0, failed: 0 };
    if (r.verdict === "worked") c.worked++;
    else if (r.verdict === "mixed") c.mixed++;
    else if (r.verdict === "failed") c.failed++;
    byCat.set(r.category, c);
  }
  const trackLines = [...byCat.entries()]
    .filter(([, c]) => c.worked + c.mixed + c.failed > 0)
    .map(([cat, c]) => `- ${cat}: worked ${c.worked} · mixed ${c.mixed} · didn't work ${c.failed}`);
  const trackBlock = trackLines.length
    ? `THE TEAM'S VERIFIED TRACK RECORD ON THIS CHANNEL (checked by the Scorekeeper — cite these when relevant)\n${trackLines.join("\n")}`
    : `NO CHECKED TIPS ON THIS CHANNEL YET — "worked on your channel before" evidence is unavailable; confidence must reflect that.`;

  return { audienceBlock, trackBlock };
}
