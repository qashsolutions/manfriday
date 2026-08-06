/** The team narrating itself while it works (DESIGN.md §13).

    Every line is a step that actually ran, in the order it ran, named seat and
    present tense. The list growing IS the progress signal — there are no ticks
    and no spinner, because a tick the product can't stand behind is worse than
    no tick at all, and a spinner says nothing about who is doing what.

    The caller owns the copy and seeds the first line when it sends the request,
    so there is never an empty beat between the click and the first line back. */
export function Working({ stages }: { stages: string[] }) {
  if (!stages.length) return null;
  const done = stages.slice(0, -1);
  const now = stages[stages.length - 1];

  return (
    <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {done.map((stage, i) => (
        <div key={i} className="quiet">{stage}</div>
      ))}
      <div style={{ fontSize: 13.5, color: "var(--ink2)" }}>{now}</div>
    </div>
  );
}
