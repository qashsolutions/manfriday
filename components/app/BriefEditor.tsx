"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { spaceName } from "@/lib/pick-why";
import styles from "./BriefEditor.module.css";

const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** Friday's brief on the product, readable and correctable. Every pick is
 *  written from it: a wrong audience or space means every pick is off, and the
 *  facts are the only numbers Friday is allowed to use. */
export function BriefEditor({ compact = false }: { compact?: boolean }) {
  const brief = useQuery(api.brands.myBrief);
  const niches = useQuery(api.brands.libraryNiches);
  const update = useMutation(api.brands.updateBrief);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", oneLiner: "", audience: "", tone: "", facts: "", trendNiche: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!brief) return null;

  const space = brief.trendNiche;
  const startEdit = () => {
    setDraft({
      name: brief.name,
      oneLiner: brief.oneLiner,
      audience: brief.audience.join("\n"),
      tone: brief.tone.join(", "),
      facts: brief.facts.join("\n"),
      trendNiche: brief.trendNiche,
    });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await update({
        brandId: brief.id,
        name: draft.name,
        oneLiner: draft.oneLiner,
        audience: toLines(draft.audience),
        tone: draft.tone.split(",").map((x) => x.trim()).filter(Boolean),
        facts: toLines(draft.facts),
        trendNiche: draft.trendNiche,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*(Uncaught Error|ConvexError): /, "").split("\n")[0] : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className={styles.view} data-compact={compact}>
        <dl className={styles.list}>
          <div>
            <dt>WHAT IT IS</dt>
            <dd>
              <strong>{brief.name}</strong> — {brief.oneLiner}
            </dd>
          </div>
          <div>
            <dt>WHO IT&apos;S FOR</dt>
            <dd>{brief.audience.join(" · ")}</dd>
          </div>
          <div>
            <dt>FACTS FRIDAY MAY USE</dt>
            <dd>
              {brief.facts.length > 0 ? (
                <ul className={styles.facts}>
                  {brief.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                <span className={styles.dim}>
                  None yet. Friday won&apos;t put numbers in your videos until you add real ones,
                  like customers, cities or time saved.
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>TRENDS FROM</dt>
            <dd>
              {space && space !== "none" ? (
                spaceName(space)
              ) : (
                <span className={styles.dim}>
                  No close match in Friday&apos;s library yet, so picks come from the nearest spaces
                  and say so.
                </span>
              )}
            </dd>
          </div>
        </dl>
        <button type="button" className={styles.ghost} onClick={startEdit}>
          Edit the brief
        </button>
      </div>
    );
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>Product name</span>
        <input className={styles.input} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className={styles.field}>
        <span>What it does, in one plain sentence</span>
        <textarea className={styles.input} rows={2} maxLength={200} value={draft.oneLiner} onChange={(e) => setDraft({ ...draft, oneLiner: e.target.value })} />
      </label>
      <label className={styles.field}>
        <span>Who it&apos;s for — one group per line</span>
        <textarea className={styles.input} rows={3} value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value })} />
      </label>
      <label className={styles.field}>
        <span>Tone — a few words, commas between</span>
        <input className={styles.input} value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value })} />
      </label>
      <label className={styles.field}>
        <span>Facts Friday may use — one per line. Only true ones: these are the only numbers that will appear in your videos.</span>
        <textarea
          className={styles.input}
          rows={4}
          placeholder={"Used by 40 schools in Telangana\nFee reminders go out on WhatsApp"}
          value={draft.facts}
          onChange={(e) => setDraft({ ...draft, facts: e.target.value })}
        />
      </label>
      <div className={styles.field}>
        <span>Trends from — the space closest to your buyers</span>
        <div className={styles.chips} role="radiogroup" aria-label="Trends from">
          {(niches ?? []).map((n) => (
            <button
              key={n.slug}
              type="button"
              role="radio"
              aria-checked={draft.trendNiche === n.slug}
              className={styles.chip}
              onClick={() => setDraft({ ...draft, trendNiche: n.slug })}
            >
              {spaceName(n.slug)} <span className={styles.dim}>{n.count}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={draft.trendNiche === "none" || draft.trendNiche === null}
            className={styles.chip}
            onClick={() => setDraft({ ...draft, trendNiche: "none" })}
          >
            None of these
          </button>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.dim}>New picks use the brief as soon as you save. Videos already made keep their words.</p>
      <div className={styles.row}>
        <button type="button" className={styles.ghost} onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save the brief"}
        </button>
      </div>
    </div>
  );
}
