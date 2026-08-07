/** App-chrome marks — the same Plain-stroke language as TeamIcons
    (currentColor, 1.7px, rounded caps, 24px grid), sized for the shell's
    34px icon buttons. These replace the unicode/emoji glyphs the chrome
    used to draw (DESIGN.md §10: emoji never appear as icons in app
    chrome). Decorative by default — the button carries the aria-label. */

function Svg({ children, size = 17 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Light/dark: one circle, half of it filled. */
export function IconTheme() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 3.6a8.4 8.4 0 0 0 0 16.8z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Settings: the sliders you actually move. */
export function IconSettings() {
  return (
    <Svg>
      <path d="M4 7.5h10M18 7.5h2M4 16.5h4M12 16.5h8" />
      <circle cx="16" cy="7.5" r="2.2" />
      <circle cx="10" cy="16.5" r="2.2" />
    </Svg>
  );
}

/** Locked nav item — shown while the app is signed out. */
export function IconLocked({ size = 11 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </Svg>
  );
}
