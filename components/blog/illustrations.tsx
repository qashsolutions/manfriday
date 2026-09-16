/* Hand-drawn inline SVG illustrations for the blog. Every colour is a CSS token
 * (var(--ink), var(--accent) …) so each figure re-skins in light mode. Text in
 * the SVGs uses the site fonts. Keep them decorative-plus-informative: each one
 * should still make sense with the alt text alone. */

const mono = { fontFamily: "var(--font-mono)", letterSpacing: "0.08em" } as const;
const display = { fontFamily: "var(--font-display)", fontWeight: 800 } as const;
const body = { fontFamily: "var(--font-body)" } as const;

function Phone({ x, y, w = 150, h = 266, label, live, children }: { x: number; y: number; w?: number; h?: number; label?: string; live?: boolean; children?: React.ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={18} fill="var(--graphite)" stroke="var(--edge-2)" strokeWidth={2} />
      <rect x={10} y={10} width={w - 20} height={h - 20} rx={12} fill="var(--panel-2)" />
      {children}
      {label && (
        <text x={w / 2} y={h - 24} textAnchor="middle" fontSize={11} fill="var(--ink)" style={display}>
          {label}
        </text>
      )}
      {live && (
        <g transform={`translate(${w - 48} 18)`}>
          <rect width={38} height={16} rx={8} fill="var(--mint)" opacity={0.18} />
          <circle cx={9} cy={8} r={3} fill="var(--mint)" />
          <text x={16} y={11.5} fontSize={8} fill="var(--mint)" style={mono}>LIVE</text>
        </g>
      )}
    </g>
  );
}

/** A founder's week: seven days, four posts, zero filming days. */
export function WeekTimeline() {
  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const posts = [1, 3, 4, 6];
  return (
    <svg viewBox="0 0 1200 560" role="img" aria-label="A week with four posts going out on Tuesday, Thursday, Friday and Sunday, each taking one swipe, while the founder's calendar shows only building time.">
      <rect width="1200" height="560" fill="var(--panel)" rx="24" />
      <text x="60" y="64" fontSize="13" fill="var(--accent)" style={mono}>ONE WEEK · SOLO FOUNDER · NO FILMING DAYS</text>
      {days.map((d, i) => {
        const x = 60 + i * 156;
        const hasPost = posts.includes(i);
        return (
          <g key={d} transform={`translate(${x} 100)`}>
            <text x="0" y="0" fontSize="12" fill="var(--dim)" style={mono}>{d}</text>
            <rect x="0" y="16" width="132" height="300" rx="14" fill="var(--panel-2)" stroke="var(--edge)" />
            {[0, 1, 2, 3].map((r) => (
              <rect key={r} x="14" y={34 + r * 62} width="104" height="44" rx="8" fill="var(--edge)" />
            ))}
            <text x="66" y="62" textAnchor="middle" fontSize="10" fill="var(--faint)" style={mono}>BUILD</text>
            <text x="66" y="124" textAnchor="middle" fontSize="10" fill="var(--faint)" style={mono}>BUILD</text>
            <text x="66" y="186" textAnchor="middle" fontSize="10" fill="var(--faint)" style={mono}>SUPPORT</text>
            <text x="66" y="248" textAnchor="middle" fontSize="10" fill="var(--faint)" style={mono}>BUILD</text>
            {hasPost && (
              <g transform="translate(14 330)">
                <rect width="104" height="40" rx="20" fill="var(--accent)" />
                <text x="52" y="25" textAnchor="middle" fontSize="12" fill="var(--accent-ink)" style={display}>1 swipe</text>
                <g transform="translate(40 -12)">
                  <circle cx="12" cy="0" r="12" fill="var(--mint)" />
                  <path d="M6 0l4 4 7-8" stroke="var(--accent-ink)" strokeWidth="2.2" fill="none" />
                </g>
              </g>
            )}
          </g>
        );
      })}
      <text x="60" y="510" fontSize="16" fill="var(--ink)" style={body}>Time spent on video this week:</text>
      <text x="320" y="510" fontSize="16" fill="var(--mint)" style={display}>about four minutes.</text>
      <text x="60" y="536" fontSize="13" fill="var(--dim)" style={body}>Four posts published on schedule. The camera never came out.</text>
    </svg>
  );
}

/** URL in → brief → picks → swipe → posted. The approve-don't-create pipeline. */
export function PipelineFlow() {
  const steps = [
    { t: "Your URL", s: "one paste, once" },
    { t: "Brand brief", s: "who it's for, tone, niche" },
    { t: "Picks", s: "10 drafts from winning formats" },
    { t: "Swipe", s: "keep or skip" },
    { t: "Posted", s: "TikTok + Shorts, on schedule" },
  ];
  return (
    <svg viewBox="0 0 1200 300" role="img" aria-label="Five steps: paste your product URL, Friday writes a brand brief, drafts ten picks from proven formats, you swipe to keep or skip, and kept videos are posted on schedule.">
      <rect width="1200" height="300" fill="var(--panel)" rx="24" />
      {steps.map((st, i) => {
        const x = 40 + i * 232;
        const last = i === steps.length - 1;
        return (
          <g key={st.t} transform={`translate(${x} 70)`}>
            <rect width="200" height="150" rx="16" fill={last ? "var(--accent)" : "var(--panel-2)"} stroke={last ? "var(--accent)" : "var(--edge)"} />
            <text x="20" y="42" fontSize="12" fill={last ? "var(--accent-ink)" : "var(--accent)"} style={mono}>{`0${i + 1}`}</text>
            <text x="20" y="80" fontSize="22" fill={last ? "var(--accent-ink)" : "var(--ink)"} style={display}>{st.t}</text>
            <text x="20" y="108" fontSize="13" fill={last ? "var(--accent-ink)" : "var(--dim)"} style={body}>{st.s}</text>
            {!last && <path d="M208 75 h16 m-6 -6 l6 6 -6 6" stroke="var(--faint)" strokeWidth="2" fill="none" />}
          </g>
        );
      })}
      <text x="40" y="262" fontSize="13" fill="var(--dim)" style={body}>The only step that needs you is the swipe. Everything else is code, not a model improvising.</text>
    </svg>
  );
}

/** Three formats side by side. */
export function ThreeFormats() {
  return (
    <svg viewBox="0 0 1200 420" role="img" aria-label="Three short-form formats: a narrated slideshow, a faceless hook video over product screenshots, and a presenter video that opens with the founder's photo.">
      <rect width="1200" height="420" fill="var(--panel)" rx="24" />
      <Phone x={140} y={60} label="Slideshow">
        {[0, 1, 2].map((i) => <rect key={i} x={24} y={40 + i * 56} width={102} height={44} rx={8} fill={i === 1 ? "var(--accent)" : "var(--edge-2)"} opacity={i === 1 ? 0.9 : 1} />)}
        <text x={75} y={68} textAnchor="middle" fontSize={9} fill="var(--ink)" style={display}>6 months, $0</text>
        <text x={75} y={124} textAnchor="middle" fontSize={9} fill="var(--accent-ink)" style={display}>then one change</text>
      </Phone>
      <Phone x={525} y={60} label="Hook video">
        <rect x={24} y={40} width={102} height={120} rx={10} fill="var(--edge-2)" />
        <rect x={34} y={52} width={82} height={8} rx={4} fill="var(--faint)" />
        <rect x={34} y={68} width={60} height={8} rx={4} fill="var(--faint)" />
        <rect x={34} y={96} width={82} height={50} rx={6} fill="var(--graphite)" />
        <rect x={24} y={172} width={102} height={28} rx={6} fill="var(--graphite)" opacity={0.8} />
        <text x={75} y={190} textAnchor="middle" fontSize={9} fill="var(--ink)" style={display}>captions, voice</text>
      </Phone>
      <Phone x={910} y={60} label="Presenter">
        <circle cx={75} cy={88} r={34} fill="var(--edge-2)" />
        <circle cx={75} cy={76} r={13} fill="var(--faint)" />
        <path d="M50 118 q25 -26 50 0" fill="var(--faint)" />
        <rect x={24} y={150} width={102} height={28} rx={6} fill="var(--graphite)" opacity={0.8} />
        <text x={75} y={168} textAnchor="middle" fontSize={9} fill="var(--ink)" style={display}>your face, 8 s</text>
      </Phone>
      <text x="215" y="372" textAnchor="middle" fontSize="13" fill="var(--dim)" style={body}>TikTok only · narrated</text>
      <text x="600" y="372" textAnchor="middle" fontSize="13" fill="var(--dim)" style={body}>TikTok + Shorts · product on screen</text>
      <text x="985" y="372" textAnchor="middle" fontSize="13" fill="var(--dim)" style={body}>TikTok + Shorts · then product</text>
    </svg>
  );
}

/** Attribution funnel: views → clicks → your product, with the tracked link. */
export function AttributionFunnel() {
  return (
    <svg viewBox="0 0 1200 560" role="img" aria-label="Two posts compared: one with 12,400 views and 3 clicks to the product, one with 1,900 views and 41 clicks. The second post is the one that paid.">
      <rect width="1200" height="560" fill="var(--panel)" rx="24" />
      <text x="60" y="64" fontSize="13" fill="var(--accent)" style={mono}>SAME WEEK · SAME PRODUCT · TWO POSTS (ILLUSTRATIVE NUMBERS)</text>
      {[
        { x: 60, hook: "“POV: you finally fixed onboarding”", views: "12,400", clicks: "3", win: false },
        { x: 620, hook: "“Shipped 11 months, 43 signups. Then one change.”", views: "1,900", clicks: "41", win: true },
      ].map((p) => (
        <g key={p.x} transform={`translate(${p.x} 100)`}>
          <rect width="520" height="380" rx="20" fill="var(--panel-2)" stroke={p.win ? "var(--mint)" : "var(--edge)"} strokeWidth={p.win ? 2 : 1} />
          <text x="28" y="44" fontSize="17" fill="var(--ink)" style={display}>{p.hook}</text>
          <text x="28" y="100" fontSize="12" fill="var(--faint)" style={mono}>VIEWS</text>
          <text x="28" y="148" fontSize="44" fill="var(--dim)" style={display}>{p.views}</text>
          <text x="28" y="210" fontSize="12" fill="var(--faint)" style={mono}>CLICKS TO YOUR PRODUCT</text>
          <text x="28" y="264" fontSize="44" fill={p.win ? "var(--mint)" : "var(--dim)"} style={display}>{p.clicks}</text>
          <rect x="28" y="300" width="464" height="46" rx="23" fill="var(--graphite)" stroke="var(--edge-2)" />
          <text x="48" y="329" fontSize="13" fill="var(--dim)" style={mono}>manfriday.app/l/qp2k8t4 → yourapp.com?utm_source=…</text>
          {p.win && (
            <g transform="translate(400 20)">
              <rect width="92" height="26" rx="13" fill="var(--mint)" />
              <text x="46" y="17.5" textAnchor="middle" fontSize="11" fill="var(--accent-ink)" style={display}>this one paid</text>
            </g>
          )}
        </g>
      ))}
      <text x="60" y="530" fontSize="13" fill="var(--dim)" style={body}>Views are the platform&apos;s number. Clicks are yours. Only one of them tells you what to make next.</text>
    </svg>
  );
}

/** Reward ladder: swipe < published < views < watch % < click. */
export function RewardLadder() {
  const rungs = ["Kept (swipe)", "Published", "Views", "Watch-through", "Click to product"];
  return (
    <svg viewBox="0 0 1200 360" role="img" aria-label="A ladder of five signals from weakest to strongest: kept, published, views, watch-through, click to product.">
      <rect width="1200" height="360" fill="var(--panel)" rx="24" />
      {rungs.map((r, i) => {
        const w = 180 + i * 190;
        const strong = i === rungs.length - 1;
        return (
          <g key={r} transform={`translate(60 ${60 + i * 54})`}>
            <rect width={w} height="40" rx="20" fill={strong ? "var(--accent)" : "var(--panel-2)"} stroke={strong ? "var(--accent)" : "var(--edge)"} />
            <text x="20" y="26" fontSize="15" fill={strong ? "var(--accent-ink)" : "var(--ink)"} style={display}>{r}</text>
            <text x={w + 16} y="26" fontSize="12" fill="var(--faint)" style={mono}>{["cheap to fake", "table stakes", "the platform's KPI", "closer", "the only one you can bank"][i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Ten hook patterns as cards. */
export function HookPatternGrid() {
  const patterns = [
    ["Confession → turn", "“6 months, $0. Then one change.”"],
    ["Bold claim + receipts", "“900 visitors from one post.”"],
    ["POV", "“POV: your app posts itself.”"],
    ["Listicle", "“3 tools. Nobody talks about #3.”"],
    ["Unpopular opinion", "“Your roadmap is the problem.”"],
    ["Wish I knew", "“Before launching a solo SaaS…”"],
    ["Curiosity gap", "“The fix wasn’t in the product.”"],
    ["Before / after", "“12 views. Then 4,000.”"],
    ["Day N build log", "“Day 31. One thing shipped.”"],
    ["Tool demo", "“Watch it post while I build.”"],
  ];
  return (
    <svg viewBox="0 0 1200 640" role="img" aria-label="Ten hook patterns, each with a one-line example: confession then turn, bold claim with receipts, POV, listicle, unpopular opinion, wish I knew, curiosity gap, before and after, day-N build log, tool demo.">
      <rect width="1200" height="640" fill="var(--panel)" rx="24" />
      {patterns.map(([name, ex], i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const x = 40 + col * 228, y = 50 + row * 280;
        return (
          <g key={name} transform={`translate(${x} ${y})`}>
            <rect width="208" height="250" rx="18" fill="var(--panel-2)" stroke="var(--edge)" />
            <text x="18" y="34" fontSize="11" fill="var(--accent)" style={mono}>{`PATTERN ${String(i + 1).padStart(2, "0")}`}</text>
            <text x="18" y="70" fontSize="18" fill="var(--ink)" style={display}>{name}</text>
            <rect x="18" y="96" width="172" height="112" rx="12" fill="var(--graphite)" />
            <foreignObject x="26" y="104" width="156" height="98">
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.35, color: "var(--ink)", fontWeight: 600 }}>{ex}</div>
            </foreignObject>
            <text x="18" y="234" fontSize="11" fill="var(--faint)" style={mono}>SEEN IN 10+ OUTLIER POSTS</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Anatomy of the first three seconds. */
export function FirstThreeSeconds() {
  return (
    <svg viewBox="0 0 1200 340" role="img" aria-label="A timeline of the first three seconds of a short: 0 to 1 second the on-screen line, 1 to 2 the pattern interrupt, 2 to 3 the promise, then the body.">
      <rect width="1200" height="340" fill="var(--panel)" rx="24" />
      <line x1="60" y1="150" x2="1140" y2="150" stroke="var(--edge-2)" strokeWidth="3" />
      {[
        { x: 60, t: "0.0 s", l: "The line is already on screen", d: "No fade-in. The hook is the first frame." },
        { x: 380, t: "1.0 s", l: "Voice says something else", d: "Text and voice disagree on purpose: two hooks for the price of one." },
        { x: 700, t: "2.0 s", l: "The promise", d: "What they get if they stay: a number, a turn, a reveal." },
        { x: 1020, t: "3.0 s", l: "Body", d: "Now, and only now, the product." },
      ].map((p, i) => (
        <g key={p.t} transform={`translate(${p.x} 150)`}>
          <circle r="10" fill={i === 3 ? "var(--mint)" : "var(--accent)"} />
          <text x="0" y="-26" fontSize="12" fill="var(--faint)" style={mono}>{p.t}</text>
          <text x="0" y="48" fontSize="16" fill="var(--ink)" style={display}>{p.l}</text>
          <foreignObject x="0" y="60" width="290" height="80">
            <div style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.4, color: "var(--dim)" }}>{p.d}</div>
          </foreignObject>
        </g>
      ))}
    </svg>
  );
}

/** One pick, three markets. */
export function LanguageMultiplier() {
  const langs = [
    { name: "Hinglish", native: "हिन्दी + English", x: 700 },
    { name: "Tanglish", native: "தமிழ் + English", x: 900 },
    { name: "Español", native: "LATAM", x: 1100 },
  ];
  return (
    <svg viewBox="0 0 1300 420" role="img" aria-label="One kept concept on the left becomes three videos on the right: Hinglish, Tanglish and Spanish, each a full rewrite in that language, not a translation.">
      <rect width="1300" height="420" fill="var(--panel)" rx="24" />
      <Phone x={120} y={70} w={170} h={280} label="One pick (English)" live />
      <text x={205} y={150} textAnchor="middle" fontSize={11} fill="var(--ink)" style={display}>6 months, $0.</text>
      <text x={205} y={168} textAnchor="middle" fontSize={11} fill="var(--ink)" style={display}>Then one change.</text>
      {langs.map((l, i) => (
        <g key={l.name}>
          <path d={`M300 210 C 480 210, 480 ${140 + i * 100}, ${l.x - 90} ${140 + i * 100}`} stroke="var(--accent)" strokeWidth="2" fill="none" strokeDasharray="6 6" />
          <g transform={`translate(${l.x - 90} ${100 + i * 100})`}>
            <rect width="180" height="80" rx="16" fill="var(--panel-2)" stroke="var(--edge)" />
            <text x="16" y="32" fontSize="16" fill="var(--ink)" style={display}>{l.name}</text>
            <text x="16" y="56" fontSize="12" fill="var(--dim)" style={body}>{l.native} · +1 video</text>
          </g>
        </g>
      ))}
      <text x="120" y="392" fontSize="13" fill="var(--dim)" style={body}>Rewritten, re-voiced, re-captioned per language. Counted as one video each, on any plan.</text>
    </svg>
  );
}

/** Code-mixed vs native vs roman, one line three ways. */
export function HowItSounds() {
  const rows = [
    ["Hinglish (code-mixed)", "6 महीने तक ₹0 कमाया, फिर एक चीज़ बदली", "how most creators actually talk"],
    ["शुद्ध हिन्दी (native)", "छह महीने तक कुछ नहीं कमाया, फिर एक बात बदली", "formal, broadcast register"],
    ["Roman script", "6 mahine tak ₹0 kamaya, phir ek cheez badli", "reads on any keyboard"],
  ];
  return (
    <svg viewBox="0 0 1200 330" role="img" aria-label="The same line in three registers: Hinglish code-mixed, pure Hindi in Devanagari, and Hindi in Roman script.">
      <rect width="1200" height="330" fill="var(--panel)" rx="24" />
      {rows.map((r, i) => (
        <g key={r[0]} transform={`translate(60 ${40 + i * 92})`}>
          <rect width="1080" height="74" rx="14" fill={i === 0 ? "var(--panel-2)" : "var(--panel)"} stroke={i === 0 ? "var(--accent)" : "var(--edge)"} />
          <text x="20" y="30" fontSize="12" fill="var(--accent)" style={mono}>{r[0].toUpperCase()}</text>
          <text x="20" y="58" fontSize="19" fill="var(--ink)" style={{ fontFamily: "var(--font-body), 'Noto Sans Devanagari', sans-serif", fontWeight: 600 }}>{r[1]}</text>
          <text x="1060" y="46" textAnchor="end" fontSize="12" fill="var(--faint)" style={mono}>{r[2]}</text>
        </g>
      ))}
    </svg>
  );
}
