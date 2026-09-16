import type { Appearance } from "@clerk/types";

/** Broadcast-styled Clerk components — matches tokens in globals.css.
 *  Uses Core 3 variable names (colorForeground family); the full dark palette
 *  is declared here directly, so no baseTheme import is needed. */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#FF4D6D",
    colorBackground: "#14131A",
    colorForeground: "#F4F3F7",
    colorMutedForeground: "#A5A1B2",
    colorInput: "#0C0B10",
    colorInputForeground: "#F4F3F7",
    colorBorder: "rgba(244, 243, 247, 0.18)",
    colorNeutral: "#F4F3F7",
    colorDanger: "#FF4D6D",
    colorSuccess: "#45E0B0",
    colorWarning: "#F5C044",
    colorModalBackdrop: "rgba(6, 5, 8, 0.7)",
    borderRadius: "12px",
    fontFamily: "var(--font-body), system-ui, sans-serif",
  },
  elements: {
    formButtonPrimary: {
      borderRadius: "999px",
      fontWeight: 600,
      textTransform: "none",
    },
    card: { border: "1px solid rgba(244, 243, 247, 0.18)" },
    cardBox: { border: "1px solid rgba(244, 243, 247, 0.18)" },
    formFieldInput: { border: "1px solid rgba(244, 243, 247, 0.22)" },
    // One-time-code boxes (email code, TOTP): Clerk renders them nearly invisible
    // on a dark card. Visible border, lighter fill, accent ring on focus.
    otpCodeFieldInput: {
      border: "1px solid rgba(244, 243, 247, 0.35)",
      backgroundColor: "#1F1D28",
      color: "#F4F3F7",
      fontSize: "20px",
      fontWeight: 600,
      "&:focus, &[data-focused='true']": {
        borderColor: "#FF4D6D",
        boxShadow: "0 0 0 2px rgba(255, 77, 109, 0.35)",
      },
    },
    otpCodeFieldInputs: { gap: "10px" },
  },
};
