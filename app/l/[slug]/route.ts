import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/** manfriday.app/l/<slug> — the tracked link in every post's caption.
 *  Logs one click (unless the visitor is a link-preview crawler), then 302s to
 *  the user's product with UTM tags. Public route (see proxy.ts). */
export const dynamic = "force-dynamic";

const BOT = /bot|crawler|spider|preview|facebookexternalhit|bytespider|slurp|embedly|quora link|whatsapp|telegrambot|discordbot|linkedinbot|twitterbot/i;

function platformFrom(referer: string | null): string {
  if (!referer) return "direct";
  try {
    const h = new URL(referer).hostname;
    if (h.includes("tiktok")) return "tiktok";
    if (h.includes("youtube") || h.includes("youtu.be")) return "youtube";
    if (h.includes("instagram")) return "instagram";
    return "other";
  } catch {
    return "other";
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const ua = req.headers.get("user-agent") ?? "";
  const result = await client.mutation(api.links.click, {
    slug,
    referrerPlatform: platformFrom(req.headers.get("referer")),
    count: !BOT.test(ua),
  });
  const target = result?.targetUrl ?? "https://manfriday.app/";
  return NextResponse.redirect(target, { status: 302, headers: { "Cache-Control": "no-store" } });
}
