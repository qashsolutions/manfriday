import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
