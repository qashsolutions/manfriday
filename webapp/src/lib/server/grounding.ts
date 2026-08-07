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
      .select("category,verdict,verdict_kind,option_type")
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

  // Counted by the KIND of claim each verdict can make, because they are not
  // interchangeable: a curve that moved is proof, a view count that moved is
  // an observation, and a Test & Compare result is the creator telling us what
  // YouTube found. Only the first two are evidence a tip worked here.
  type Tally = { stayed: number; noChange: number; leftSooner: number; reportedWon: number; reportedLost: number; watched: number };
  const empty = (): Tally => ({ stayed: 0, noChange: 0, leftSooner: 0, reportedWon: 0, reportedLost: 0, watched: 0 });
  const byCat = new Map<string, Tally>();
  const picks = { safe: 0, reach: 0, bold: 0 };
  for (const r of (verdictRecs ?? []) as { category: string; verdict: string | null; verdict_kind: string | null; option_type: string | null }[]) {
    if (r.option_type === "safe") picks.safe++;
    else if (r.option_type === "reach") picks.reach++;
    else if (r.option_type === "bold") picks.bold++;
    if (!r.verdict) continue;
    // Rows written before kinds existed were judged on view counts alone.
    const kind = r.verdict_kind ?? (r.verdict === "unclear" ? "too_early" : "what_happened");
    if (kind === "too_early") continue;
    const c = byCat.get(r.category) ?? empty();
    if (kind === "viewers_stayed") {
      if (r.verdict === "worked") c.stayed++;
      else if (r.verdict === "failed") c.leftSooner++;
      else c.noChange++;
    } else if (kind === "head_to_head") {
      if (r.verdict === "worked") c.reportedWon++;
      else if (r.verdict === "failed") c.reportedLost++;
    } else {
      c.watched++;
    }
    byCat.set(r.category, c);
  }
  const measuredLines: string[] = [];
  const watchedLines: string[] = [];
  for (const [cat, c] of byCat) {
    const measured = [
      c.stayed > 0 ? `viewers stayed longer ${c.stayed}` : null,
      c.noChange > 0 ? `no real change ${c.noChange}` : null,
      c.leftSooner > 0 ? `viewers left sooner ${c.leftSooner}` : null,
      c.reportedWon > 0 ? `YouTube's own test picked ours ${c.reportedWon} (creator-reported)` : null,
      c.reportedLost > 0 ? `YouTube's own test picked another ${c.reportedLost} (creator-reported)` : null,
    ].filter(Boolean);
    if (measured.length) measuredLines.push(`- ${cat}: ${measured.join(" · ")}`);
    if (c.watched > 0) watchedLines.push(`- ${cat}: ${c.watched} watched on views only`);
  }
  let trackBlock = measuredLines.length
    ? `WHAT ACTUALLY HELD UP ON THIS CHANNEL (measured on real viewers, or reported from YouTube's own Test & Compare — cite these when relevant; a creator-reported test result must be described as exactly that)\n${measuredLines.join("\n")}`
    : `NOTHING MEASURED ON REAL VIEWERS ON THIS CHANNEL YET — "this worked on your channel before" evidence is unavailable; confidence must reflect that.`;
  if (watchedLines.length) {
    trackBlock +=
      `\nWATCHED ON VIEWS ONLY — these are NOT evidence a tip worked. A channel's views swing on their own, so never cite one as proof, never say a tip caused a view change; at most, note what happened.\n${watchedLines.join("\n")}`;
  }
  const totalPicks = picks.safe + picks.reach + picks.bold;
  if (totalPicks > 0) {
    trackBlock += `\nWHAT THEY PICK when offered typed options: safe ${picks.safe} · reach ${picks.reach} · bold ${picks.bold} — revealed preference; still offer all three types, but write the one they lean toward with extra care.`;
  }

  return { audienceBlock, trackBlock };
}
