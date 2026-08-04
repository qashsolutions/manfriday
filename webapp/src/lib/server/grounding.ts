import type { SupabaseClient } from "@supabase/supabase-js";

/** What every analyst reads before advising: who this creator is for (their
    own words, from the profile page) and the team's verified track record on
    this exact channel (the Ledger). This is what makes advice tailored and
    confidence earned instead of one-size-fits-all. */

export type Grounding = { audienceBlock: string; trackBlock: string };

export async function analystGrounding(svc: SupabaseClient, userId: string): Promise<Grounding> {
  const [{ data: profs }, { data: verdictRecs }] = await Promise.all([
    svc.from("channel_profiles")
      .select("niche,audience,goals,tone,competitors,formats,products_links,language_culture,monetization,risk_appetite,effort_budget,constraints_notes")
      .eq("user_id", userId).limit(1),
    svc.from("recommendations")
      .select("category,verdict,option_type")
      .eq("user_id", userId),
  ]);

  type ProfileRow = {
    niche: string | null; audience: string | null; goals: string[] | null;
    tone: string | null; competitors: string[] | null; formats: string | null;
    products_links: { label?: string; url: string }[] | null;
    language_culture: string | null; monetization: string | null;
    risk_appetite: string | null; effort_budget: string | null;
    constraints_notes: string | null;
  };
  const p = profs?.[0] as ProfileRow | undefined;
  const audienceLines: string[] = [];
  if (p?.niche) audienceLines.push(`Niche & who it's for: ${p.niche}`);
  if (p?.audience) audienceLines.push(`More about their viewers: ${p.audience}`);
  if (p?.language_culture) audienceLines.push(`Language & cultural context: ${p.language_culture}`);
  if (p?.goals?.length) audienceLines.push(`Their goals: ${p.goals.join("; ")}`);
  if (p?.monetization) audienceLines.push(`How they earn (or plan to): ${p.monetization} — money advice must fit this, never invented figures`);
  if (p?.tone) audienceLines.push(`Their tone: ${p.tone}`);
  if (p?.formats) audienceLines.push(`Formats they make: ${p.formats}`);
  if (p?.risk_appetite) audienceLines.push(`Advice they want emphasized: ${p.risk_appetite} (still give all option types; lead with this one)`);
  if (p?.effort_budget) audienceLines.push(`Time they can spend: ${p.effort_budget} — prefer fixes that fit it`);
  if (p?.constraints_notes) audienceLines.push(`Hard constraints (never suggest breaking these): ${p.constraints_notes}`);
  if (p?.products_links?.length) audienceLines.push(`Their products/links: ${p.products_links.map((l) => l.label ? `${l.label} (${l.url})` : l.url).join(", ")}`);
  if (p?.competitors?.length) audienceLines.push(`They measure themselves against: ${p.competitors.join(", ")}`);
  const audienceBlock = audienceLines.length
    ? `THE CREATOR'S OWN DEFINITION OF WHO THEY'RE FOR (tailor everything to this)\n${audienceLines.join("\n")}`
    : `THE CREATOR HASN'T FILLED IN THEIR AUDIENCE PROFILE YET — do not guess who they're for; audience-fit evidence is unavailable, say so where relevant.`;

  const byCat = new Map<string, { worked: number; mixed: number; failed: number }>();
  const picks = { safe: 0, reach: 0, bold: 0 };
  for (const r of (verdictRecs ?? []) as { category: string; verdict: string | null; option_type: string | null }[]) {
    if (r.option_type === "safe") picks.safe++;
    else if (r.option_type === "reach") picks.reach++;
    else if (r.option_type === "bold") picks.bold++;
    if (!r.verdict) continue;
    const c = byCat.get(r.category) ?? { worked: 0, mixed: 0, failed: 0 };
    if (r.verdict === "worked") c.worked++;
    else if (r.verdict === "mixed") c.mixed++;
    else if (r.verdict === "failed") c.failed++;
    byCat.set(r.category, c);
  }
  const trackLines = [...byCat.entries()]
    .filter(([, c]) => c.worked + c.mixed + c.failed > 0)
    .map(([cat, c]) => `- ${cat}: worked ${c.worked} · mixed ${c.mixed} · didn't work ${c.failed}`);
  let trackBlock = trackLines.length
    ? `THE TEAM'S VERIFIED TRACK RECORD ON THIS CHANNEL (checked by the Scorekeeper — cite these when relevant)\n${trackLines.join("\n")}`
    : `NO CHECKED TIPS ON THIS CHANNEL YET — "worked on your channel before" evidence is unavailable; confidence must reflect that.`;
  const totalPicks = picks.safe + picks.reach + picks.bold;
  if (totalPicks > 0) {
    trackBlock += `\nWHAT THEY PICK when offered typed options: safe ${picks.safe} · reach ${picks.reach} · bold ${picks.bold} — revealed preference; still offer all three types, but write the one they lean toward with extra care.`;
  }

  return { audienceBlock, trackBlock };
}
