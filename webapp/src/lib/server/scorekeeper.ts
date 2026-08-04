import type { SupabaseClient } from "@supabase/supabase-js";

/** The Scorekeeper: checks applied tips against what actually happened.
    Verdicts are pure arithmetic — no model in the loop — so they can't be
    argued with. Runs inside the daily cron.

    Rules (documented on the Ledger):
    - a tip is judged no earlier than 7 days after "I applied this"
    - video tips: views/day now vs views/day when the tip was written
    - channel/idea tips: the first upload AFTER applying, at least 5 days old,
      vs the channel's normal for its format
    - ratio >= 1.5 -> worked · <= 0.75 -> failed · between -> mixed
    - missing numbers -> unclear, said plainly */

const JUDGE_AFTER_DAYS = 7;
const NEW_VIDEO_MIN_AGE_DAYS = 5;

type Rec = {
  id: string;
  target_type: "video" | "channel" | "idea";
  target_yt_id: string | null;
  baseline: { views_per_day?: number | null; view_count?: number | null } | null;
  updates: { type: string; at?: string }[] | null;
  updated_at: string;
};

function verdictFromRatio(ratio: number): "worked" | "failed" | "mixed" {
  return ratio >= 1.5 ? "worked" : ratio <= 0.75 ? "failed" : "mixed";
}

export async function checkAppliedTips(svc: SupabaseClient, userId: string): Promise<number> {
  const { data: recs } = await svc
    .from("recommendations")
    .select("id,target_type,target_yt_id,baseline,updates,updated_at")
    .eq("user_id", userId)
    .eq("status", "applied");
  if (!recs || recs.length === 0) return 0;

  const now = Date.now();
  let resolved = 0;

  for (const rec of recs as Rec[]) {
    const appliedEntry = (rec.updates ?? []).find((u) => u.type === "applied");
    const appliedAt = Date.parse(appliedEntry?.at ?? rec.updated_at);
    if (!appliedAt || now - appliedAt < JUDGE_AFTER_DAYS * 86_400_000) continue;

    let verdict: "worked" | "failed" | "mixed" | "unclear" | null = null;
    let result: Record<string, unknown> = {};

    if (rec.target_type === "video" && rec.target_yt_id) {
      const { data: video } = await svc
        .from("videos").select("id,title").eq("user_id", userId).eq("yt_video_id", rec.target_yt_id).maybeSingle();
      const before = rec.baseline?.views_per_day ?? null;
      if (!video || before === null || before <= 0) {
        verdict = "unclear";
        result = { reason: "no usable before-number was captured with this tip" };
      } else {
        const { data: snaps } = await svc
          .from("video_snapshots").select("views_per_day,view_count,captured_at")
          .eq("video_id", video.id).order("captured_at", { ascending: false }).limit(1);
        const after = snaps?.[0]?.views_per_day ?? null;
        if (after === null) {
          verdict = "unclear";
          result = { reason: "no fresh numbers for this video yet" };
        } else {
          const ratio = Math.round((after / before) * 100) / 100;
          verdict = verdictFromRatio(ratio);
          result = { metric: "views_per_day", before, after, ratio, video_title: video.title };
        }
      }
    } else {
      // channel / idea tips: judged by the first upload after applying.
      const appliedIso = new Date(appliedAt).toISOString();
      const { data: newVids } = await svc
        .from("videos").select("id,yt_video_id,title,published_at,is_short")
        .eq("user_id", userId).gt("published_at", appliedIso)
        .order("published_at", { ascending: true }).limit(1);
      const nv = newVids?.[0];
      if (!nv) continue; // nothing published yet — keep checking
      if (now - Date.parse(nv.published_at as string) < NEW_VIDEO_MIN_AGE_DAYS * 86_400_000) continue;

      const fmt = nv.is_short ? "shorts" : "longform";
      const [{ data: bl }, { data: snaps }] = await Promise.all([
        svc.from("channel_baselines").select("median_views,computed_at").eq("user_id", userId)
          .eq("format", fmt).order("computed_at", { ascending: false }).limit(1),
        svc.from("video_snapshots").select("view_count").eq("video_id", nv.id)
          .order("captured_at", { ascending: false }).limit(1),
      ]);
      const medianViews = bl?.[0]?.median_views ?? null;
      const views = snaps?.[0]?.view_count ?? null;
      if (!medianViews || medianViews <= 0 || views === null) {
        verdict = "unclear";
        result = { reason: "the channel's normal is still too thin to judge against" };
      } else {
        const ratio = Math.round((views / medianViews) * 100) / 100;
        verdict = verdictFromRatio(ratio);
        result = {
          metric: "views_vs_normal", before: medianViews, after: views, ratio,
          video_title: nv.title, yt_video_id: nv.yt_video_id,
        };
      }
    }

    if (!verdict) continue;
    const nowIso = new Date().toISOString();
    await svc
      .from("recommendations")
      .update({
        status: "resolved",
        verdict,
        resolved_at: nowIso,
        result_snapshot: result,
        updates: [...(rec.updates ?? []), { type: "verdict", at: nowIso, verdict }],
      })
      .eq("id", rec.id);
    resolved++;
  }

  return resolved;
}
