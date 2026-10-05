import type { Appearance } from "@clerk/types";

/** Clerk, dressed in our tokens — one palette per mode.
 *
 *  Colours are literal here on purpose: Clerk derives hover and pressed shades
 *  from these values, and a CSS variable makes that derivation fail (the primary
 *  button renders grey). The palettes mirror globals.css, and
 *  components/app/ClerkTheme.tsx picks the right one and follows the toggle.
 */
const PALETTE = {
  dark: {
    primary: "#FF4D6D",
    background: "#14131A",
    foreground: "#F4F3F7",
    muted: "#A5A1B2",
    input: "#0C0B10",
    border: "rgba(244, 243, 247, 0.18)",
    onPrimary: "#14060B",
    shadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
  },
  light: {
    primary: "#E63E5C",
    background: "#FFFFFF",
    foreground: "#16151C",
    muted: "#4D4960",
    input: "#F7F6FA",
    border: "#D9D5E5",
    onPrimary: "#FFFFFF",
    shadow: "0 24px 60px rgba(12, 11, 16, 0.14)",
  },
} as const;

export type ClerkMode = keyof typeof PALETTE;

/** Card chrome for the full-page auth screens: this card is the only thing on
 *  the right half of /login, so it is deliberately large. Scoped, never global. */
function authCard(c: (typeof PALETTE)[ClerkMode]) {
  return {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", maxWidth: "520px", border: `1px solid ${c.border}`, boxShadow: c.shadow },
    card: { padding: "38px 36px 30px", gap: "20px" },
    headerTitle: { fontFamily: "var(--font-display), sans-serif", fontSize: "26px", fontWeight: 700 },
    headerSubtitle: { fontSize: "15px" },
  };
}

export function clerkAppearanceFor(mode: ClerkMode): Appearance {
  const c = PALETTE[mode];
  return {
  variables: {
    colorPrimary: c.primary,
    colorBackground: c.background,
    colorForeground: c.foreground,
    colorMutedForeground: c.muted,
    colorInput: c.input,
    colorInputForeground: c.foreground,
    colorBorder: c.border,
    colorNeutral: c.foreground,
    colorDanger: c.primary,
    colorSuccess: mode === "light" ? "#0E9F74" : "#45E0B0",
    colorWarning: mode === "light" ? "#A97B10" : "#F5C044",
    colorModalBackdrop: "rgba(6, 5, 8, 0.6)",
    borderRadius: "14px",
    fontFamily: "var(--font-body), system-ui, sans-serif",
    fontSize: "15.5px",
  },
  elements: {
    socialButtonsBlockButton: { height: "48px", fontSize: "15px", border: `1px solid ${c.border}` },
    formFieldLabel: { fontSize: "14px" },
    formFieldInput: { height: "48px", fontSize: "15.5px", border: `1px solid ${c.border}` },
    formButtonPrimary: {
      height: "50px",
      borderRadius: "999px",
      fontWeight: 600,
      fontSize: "16px",
      textTransform: "none",
      color: c.onPrimary,
    },
    footerAction: { fontSize: "14.5px" },
    // One-time-code boxes: Clerk renders them nearly invisible by default.
    otpCodeFieldInput: {
      border: `1.5px solid ${c.border}`,
      backgroundColor: c.input,
      color: c.foreground,
      fontSize: "22px",
      fontWeight: 600,
      "&:focus, &[data-focused='true']": {
        borderColor: c.primary,
        boxShadow: `0 0 0 2px ${c.primary}59`,
      },
    },
    otpCodeFieldInputs: { gap: "10px" },
  },
  // The wide card belongs to the sign-in and sign-up screens ONLY. Applied
  // globally it also hit <UserProfile/>, whose modal is a two-column layout
  // (nav rail + detail panel) that needs ~850px — capped at 520px the columns
  // overlapped and the labels clipped to "oogl" / "Co…".
  signIn: { elements: authCard(c) },
  signUp: { elements: authCard(c) },
  };
}

/** Default for anything rendered before the mode is known. */
export const clerkAppearance: Appearance = clerkAppearanceFor("dark");
