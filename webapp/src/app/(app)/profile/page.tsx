"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const TONES = ["Calm & precise", "No hype", "High-energy", "Humorous", "Process-first", "Story-driven"];

type ProfileRow = {
  id: string;
  niche: string | null;
  audience: string | null;
  goals: string[] | null;
  products_links: { label?: string; url: string }[] | null;
  tone: string | null;
  competitors: string[] | null;
};

export default function ProfilePage() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [rowId, setRowId] = useState<string | null>(null);
  const [niche, setNiche] = useState("");
  const [audience, setAudience] = useState("");
  const [goals, setGoals] = useState("");
  const [links, setLinks] = useState("");
  const [tones, setTones] = useState<string[]>([]);
  const [competitors, setCompetitors] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("channel_profiles")
        .select("id,niche,audience,goals,products_links,tone,competitors")
        .limit(1)
        .maybeSingle();
      const p = data as ProfileRow | null;
      if (p) {
        setRowId(p.id);
        setNiche(p.niche ?? "");
        setAudience(p.audience ?? "");
        setGoals((p.goals ?? []).join("\n"));
        setLinks((p.products_links ?? []).map((l) => l.url).join("\n"));
        setTones((p.tone ?? "").split(" · ").filter(Boolean));
        setCompetitors((p.competitors ?? []).join(", "));
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleTone(t: string) {
    setTones((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true); setSaved(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: chans } = await supabase.from("channels").select("id").eq("is_owned", true).limit(1);
    const payload = {
      user_id: user.id,
      channel_id: chans?.[0]?.id ?? null,
      niche: niche.trim() || null,
      audience: audience.trim() || null,
      goals: goals.split("\n").map((s) => s.trim()).filter(Boolean),
      products_links: links.split("\n").map((s) => s.trim()).filter(Boolean).map((url) => ({ url })),
      tone: tones.join(" · ") || null,
      competitors: competitors.split(",").map((s) => s.trim()).filter(Boolean),
    };
    const q = rowId
      ? supabase.from("channel_profiles").update(payload).eq("id", rowId)
      : supabase.from("channel_profiles").insert(payload);
    const { error } = await q;
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSaved(true);
    setTimeout(() => router.push("/desk"), 900);
  }

  if (loading) return <div style={{ color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;

  return (
    <>
      <div className="pagehead"><h1>Tune your team</h1></div>
      <p style={{ color: "var(--ink2)", maxWidth: "62ch", marginTop: -6 }}>
        Ninety seconds, four questions. Every analyst reads this before advising you — it&apos;s how
        recommendations match your voice and your goals instead of a generic channel&apos;s.
      </p>
      {err && <div className="err">{err}</div>}
      {saved && <div className="ok-note">Saved — your team will use this from the next analysis on.</div>}
      <form onSubmit={save} className="card" style={{ maxWidth: 680 }}>
        <label className="field">
          <span>Your niche &amp; audience — who watches, and for what?</span>
          <input className="input" value={niche} onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. Woodworking builds for hobbyists upgrading from beginner tools" />
        </label>
        <label className="field">
          <span>Anything else about your viewers (optional)</span>
          <input className="input" value={audience} onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. mostly weekend makers, small budgets, US/EU" />
        </label>
        <label className="field">
          <span>Your goals — one per line</span>
          <textarea className="input" rows={3} value={goals} onChange={(e) => setGoals(e.target.value)}
            placeholder={"50K subscribers\nSell the jig plans"} />
        </label>
        <label className="field">
          <span>Links to include in descriptions — one per line (optional)</span>
          <textarea className="input" rows={2} value={links} onChange={(e) => setLinks(e.target.value)}
            placeholder={"https://yourshop.example/plans"} />
        </label>
        <div className="field">
          <span>Your tone — pick what fits</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {TONES.map((t) => (
              <button
                type="button" key={t} onClick={() => toggleTone(t)}
                className="pill" style={{
                  cursor: "pointer", border: "1px solid",
                  borderColor: tones.includes(t) ? "var(--acc-line)" : "var(--line)",
                  background: tones.includes(t) ? "var(--acc-soft)" : "var(--card)",
                  color: tones.includes(t) ? "var(--acc)" : "var(--ink2)",
                  padding: "6px 12px", fontSize: 12.5,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Channels you measure yourself against — comma-separated (optional)</span>
          <input className="input" value={competitors} onChange={(e) => setCompetitors(e.target.value)}
            placeholder="@channel1, @channel2" />
        </label>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button className="btn btn-acc" disabled={busy}>{busy ? "Saving…" : "Save — my team reads this"}</button>
          <button type="button" className="btn btn-ghost" onClick={() => router.push("/desk")}>Skip for now</button>
        </div>
      </form>
    </>
  );
}
