/** The product, floating in the hero: a retention read, a title grade, and a
    checked Ledger verdict — drawn with the app's own visual language. */
export function HeroPreview() {
  return (
    <div className="hero-visual" aria-hidden>
      <div className="pv pv1">
        <span className="k">Where viewers stop watching</span>
        <svg viewBox="0 0 300 96" width="100%" height="96" fill="none" style={{ display: "block" }}>
          <defs>
            <linearGradient id="pvfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--acc)" stopOpacity=".22" />
              <stop offset="1" stopColor="var(--acc)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 14 C40 18 62 26 92 34 C118 41 138 40 158 56 C180 74 186 74 224 79 C252 82 278 84 300 85 L300 96 L0 96 Z"
            fill="url(#pvfill)"
          />
          <path
            d="M0 14 C40 18 62 26 92 34 C118 41 138 40 158 56 C180 74 186 74 224 79 C252 82 278 84 300 85"
            stroke="var(--acc)" strokeWidth="2.4" strokeLinecap="round"
          />
          <line x1="166" y1="60" x2="166" y2="92" stroke="var(--ink3)" strokeWidth="1.4" strokeDasharray="3 4" />
          <circle cx="166" cy="62" r="5" fill="var(--crit)" />
          <circle cx="166" cy="62" r="9" fill="var(--crit)" opacity=".18" />
        </svg>
        <div className="cap">
          <span><b>Viewers leave at 2:14</b> — right where the intro runs long</span>
          <span className="pill acc" style={{ whiteSpace: "nowrap" }}>fix ready</span>
        </div>
      </div>

      <div className="pv pv2">
        <span className="k">Title grade</span>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          <span style={{
            width: 40, height: 40, borderRadius: 10, background: "var(--good-soft)", color: "var(--good)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, flex: "none",
          }}>A−</span>
          <span style={{ fontSize: 12, lineHeight: 1.4 }}>matches your winners — <b>3 rewrites to pick from</b></span>
        </div>
      </div>

      <div className="pv pv3">
        <span className="k">The Ledger — checked</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5 }}><b>Say what they get in the title</b></span>
        </div>
        <div className="cap" style={{ marginTop: 6 }}>
          <span className="num" style={{ fontSize: 12 }}>41/day → 128/day</span>
          <span className="pill good" style={{ whiteSpace: "nowrap" }}>✓ worked · 3×</span>
        </div>
      </div>
    </div>
  );
}
