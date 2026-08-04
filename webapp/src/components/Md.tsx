/** Minimal markdown rendering: headings, bullets, bold, paragraphs. Reports are
    trusted app-generated content, but we still render as text nodes only. */
export function Md({ md }: { md: string }) {
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((p, i) => {
      if (p.startsWith("**") && p.endsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
      if (p.startsWith("*") && p.endsWith("*")) return <i key={i}>{p.slice(1, -1)}</i>;
      return <span key={i}>{p}</span>;
    });
  };
  const blocks = md.split(/\n{2,}/);
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (b.startsWith("### ")) return <h4 key={i} style={{ margin: "14px 0 4px" }}>{b.slice(4)}</h4>;
        if (b.startsWith("## ")) return <h3 key={i} style={{ margin: "16px 0 6px" }}>{b.slice(3)}</h3>;
        if (b.startsWith("# ")) return <h2 key={i} style={{ margin: "16px 0 6px" }}>{b.slice(2)}</h2>;
        if (lines.every((l) => l.startsWith("- ") || l.startsWith("* "))) {
          return (
            <ul key={i} style={{ margin: "6px 0", paddingLeft: 20 }}>
              {lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}
            </ul>
          );
        }
        return <p key={i} style={{ margin: "6px 0", color: "var(--ink2)" }}>{inline(b)}</p>;
      })}
    </div>
  );
}
