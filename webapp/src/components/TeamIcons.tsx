/** The team's marks — minimal geometric strokes, one per analyst.
    All inherit currentColor so they sit on any tile. */

function Svg({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** A retention curve with the drop marked. */
export function IconRetention() {
  return (
    <Svg label="Retention Analyst">
      <path d="M3 6c3.5.5 5 3.5 7.5 6S16.5 17 21 17.8" />
      <circle cx="11.5" cy="12.6" r="2" fill="currentColor" stroke="none" />
      <path d="M11.5 15v5.5" strokeDasharray="2 2.4" strokeWidth="1.4" />
    </Svg>
  );
}

/** An A-grade on the title card. */
export function IconPackaging() {
  return (
    <Svg label="Packaging Analyst">
      <rect x="3.5" y="4" width="17" height="16" rx="3.5" />
      <path d="M8.6 16.2 12 8l3.4 8.2M9.9 13.4h4.2" />
    </Svg>
  );
}

/** A comment with something worth reading in it. */
export function IconAudience() {
  return (
    <Svg label="Audience Analyst">
      <path d="M4 5.5h16v10.5h-8.5L8 19.5v-3.5H4z" />
      <path d="M7.5 9.2h9M7.5 12.2h5.5" strokeWidth="1.5" />
    </Svg>
  );
}

/** The ledger: two that worked, one that didn't — kept on the record. */
export function IconScorekeeper() {
  return (
    <Svg label="Scorekeeper">
      <path d="M4 6.2l1.5 1.5L8 5.2M11 6.4h9" />
      <path d="M4 12.2l1.5 1.5L8 11.2M11 12.4h9" />
      <path d="M4.6 17.3l2.8 2.8M7.4 17.3l-2.8 2.8M11 18.4h9" />
    </Svg>
  );
}

/** A scope on the neighborhood. */
export function IconScout() {
  return (
    <Svg label="Scout">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M14.4 9.6 19 5" />
    </Svg>
  );
}

/** A close read of the material. */
export function IconResearcher() {
  return (
    <Svg label="Researcher">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M14.9 14.9 20.5 20.5" />
      <path d="M8.2 9.3h4.6M8.2 12h3.2" strokeWidth="1.5" />
    </Svg>
  );
}
