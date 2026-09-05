import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get("title") ?? "You build. Friday posts.").slice(0, 120);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0C0B10",
          color: "#F4F3F7",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="30" height="30" viewBox="0 0 24 24">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="#FF4D6D" />
          </svg>
          <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>MAN FRIDAY</span>
        </div>
        <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.1, maxWidth: 950 }}>
          {title}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 24, color: "#A5A1B2" }}>manfriday.app</span>
          <span style={{ fontSize: 22, color: "#FF4D6D" }}>You build. Friday posts.</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
