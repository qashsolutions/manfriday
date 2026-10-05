/** The one picture on the sign-in page: your URL becomes three videos in three
 *  shapes, posted on a schedule, measured in clicks. Theme-aware (CSS tokens),
 *  scales to the column, no text beyond labels. */
export function AuthVisual() {
  const phone = (x: number, title: string, line: string, tint: string) => (
    <g key={title} transform={`translate(${x} 150)`}>
      <rect width="200" height="330" rx="26" fill="var(--panel-2)" stroke="var(--edge-2)" strokeWidth="2" />
      <rect x="12" y="14" width="176" height="238" rx="16" fill={tint} />
      <rect x="28" y="188" width="144" height="12" rx="6" fill="var(--ink)" opacity="0.85" />
      <rect x="28" y="208" width="104" height="12" rx="6" fill="var(--ink)" opacity="0.5" />
      <text x="100" y="286" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="13" letterSpacing="1.6" fill="var(--faint)">
        {title}
      </text>
      <text x="100" y="310" textAnchor="middle" fontFamily="var(--font-body)" fontSize="14" fill="var(--dim)">
        {line}
      </text>
    </g>
  );

  return (
    <svg viewBox="0 0 860 620" role="img" aria-label="Your product URL becomes three short videos — a slideshow, a faceless hook video and a presenter video — posted to TikTok and YouTube Shorts, measured in clicks to your product.">
      {/* the paste */}
      <rect x="230" y="18" width="400" height="62" rx="31" fill="var(--panel)" stroke="var(--accent)" strokeWidth="2.5" />
      <circle cx="268" cy="49" r="7" fill="var(--accent)" />
      <text x="292" y="56" fontFamily="var(--font-mono)" fontSize="19" fill="var(--ink)">yourproduct.com</text>

      {/* the drop into three formats */}
      <path d="M430 80 L430 118 M430 118 L150 118 L150 148 M430 118 L430 148 M430 118 L710 118 L710 148"
        stroke="var(--edge-2)" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      {phone(50, "SLIDESHOW", "six slides, narrated", "var(--graphite)")}
      {phone(330, "FACELESS", "hook, then product", "var(--graphite)")}
      {phone(610, "PRESENTER", "your photo, your voice", "var(--graphite)")}

      {/* posted, and the number that matters */}
      <path d="M150 480 L150 520 L710 520 L710 480 M430 520 L430 548" stroke="var(--edge-2)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="190" y="548" width="480" height="58" rx="29" fill="var(--accent)" />
      <text x="430" y="585" textAnchor="middle" fontFamily="var(--font-body)" fontSize="19" fontWeight="700" fill="var(--accent-ink)">
        Posted to TikTok + Shorts, on schedule
      </text>
    </svg>
  );
}
