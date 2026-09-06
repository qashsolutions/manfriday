import { dark } from "@clerk/themes";
import type { Appearance } from "@clerk/types";

/** Broadcast-styled Clerk components — matches lib/tokens in globals.css. */
export const clerkAppearance: Appearance = {
  baseTheme: dark,
  variables: {
    colorPrimary: "#FF4D6D",
    colorBackground: "#14131A",
    colorInputBackground: "#0C0B10",
    colorText: "#F4F3F7",
    colorInputText: "#F4F3F7",
    colorTextSecondary: "#A5A1B2",
    colorDanger: "#FF4D6D",
    colorSuccess: "#45E0B0",
    colorWarning: "#F5C044",
    borderRadius: "12px",
    fontFamily: "var(--font-body), system-ui, sans-serif",
  },
  elements: {
    formButtonPrimary: {
      borderRadius: "999px",
      fontWeight: 600,
      textTransform: "none",
    },
    card: { border: "1px solid #1F1D28" },
  },
};
