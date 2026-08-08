import type { Metadata } from "next";
import { Inter, Newsreader, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// The three type roles (DESIGN.md §3), self-hosted by next/font and exposed
// as CSS variables so globals.css owns every actual assignment.
// The .variable classes MUST sit on <html>, not <body>: globals.css declares
// --sans/--display/--mono on :root, and a var() that can't resolve there makes
// the whole custom property invalid — which silently drops the entire app to
// the browser default serif (shipped that way from P7 until 2026-08-07).
// Body — an analyst's prose should disappear.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Display — the morning-memo register. Restraint is the rule: page h1 only.
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-newsreader",
  display: "swap",
});
// Data — numbers, timestamps, before→after pairs. Not a variable font, so
// the weights it ships in have to be named.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "manfriday — your channel's analyst team",
  description: "Six analysts working on your channel every day, from your own numbers.",
};

const themeInit = `
try {
  var t = localStorage.getItem("mf-theme");
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${newsreader.variable} ${plexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
