/** Product email. Five messages, each sent once, each with an unsubscribe link.
 *
 *  Friday's voice: plain, short, says what happened and what to do next. No
 *  marketing. Sending goes through Resend from the verified manfriday.app
 *  domain; when RESEND_API_KEY is missing, nothing is sent and nothing breaks.
 */
import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const APP_URL = () => env.APP_URL ?? "https://manfriday.app";
const FROM = () => env.EMAIL_FROM ?? "Friday <friday@manfriday.app>";

/** Unguessable per-user token for the unsubscribe link. */
function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ensureToken = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx: MutationCtx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user) return null;
    if (user.emailToken) return user.emailToken;
    const token = newToken();
    await ctx.db.patch("users", args.userId, { emailToken: token });
    return token;
  },
});

export const recipient = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx: QueryCtx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || !user.email || user.emailOptOut) return null;
    return { email: user.email, token: user.emailToken ?? null };
  },
});

function wrap(bodyLines: string[], token: string | null): { text: string; html: string } {
  const unsub = token ? `${APP_URL()}/api/unsubscribe?t=${token}` : `${APP_URL()}/settings`;
  const text = [...bodyLines, "", "—", "Man Friday · manfriday.app", `Stop these emails: ${unsub}`].join("\n");
  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:1.6;color:#14131a;max-width:520px">
${bodyLines.map((l) => (l ? `<p style="margin:0 0 12px">${l.replace(/</g, "&lt;")}</p>` : "")).join("")}
<hr style="border:none;border-top:1px solid #e6e4ee;margin:20px 0">
<p style="margin:0;font-size:12px;color:#6b6880">Man Friday · <a href="${APP_URL()}" style="color:#6b6880">manfriday.app</a> · <a href="${unsub}" style="color:#6b6880">stop these emails</a></p>
</div>`;
  return { text, html };
}

/** The one place email leaves the building. */
export const send = internalAction({
  args: { userId: v.id("users"), subject: v.string(), lines: v.array(v.string()) },
  handler: async (ctx: ActionCtx, args): Promise<"sent" | "skipped"> => {
    const to: { email: string; token: string | null } | null = await ctx.runQuery(internal.email.recipient, { userId: args.userId });
    if (!to) return "skipped"; // opted out, or no address
    const key = env.RESEND_API_KEY;
    if (!key) {
      console.warn(`EMAIL [${args.subject}] to ${to.email} not sent: no RESEND_API_KEY`);
      return "skipped";
    }
    const token: string | null = to.token ?? (await ctx.runMutation(internal.email.ensureToken, { userId: args.userId }));
    const { text, html } = wrap(args.lines, token);
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: [to.email], subject: args.subject, text, html }),
    });
    if (!resp.ok) {
      console.error("email failed", args.subject, resp.status, (await resp.text()).slice(0, 200));
      return "skipped";
    }
    return "sent";
  },
});

/** Token from an email footer, no sign-in needed. */
export const unsubscribe = mutation({
  args: { token: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    if (args.token.length < 8) return false;
    const users = await ctx.db.query("users").take(1000);
    const user = users.find((u) => u.emailToken === args.token);
    if (!user) return false;
    await ctx.db.patch("users", user._id, { emailOptOut: true });
    return true;
  },
});

// ── the five messages ──────────────────────────────────────────────────────

export const welcome = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx: MutationCtx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.welcomeEmailedAt) return null; // once per account
    await ctx.db.patch("users", args.userId, { welcomeEmailedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.email.send, {
      userId: args.userId,
      subject: "You build. Friday posts.",
      lines: [
        "Welcome aboard.",
        "Paste your product's URL and Friday reads your site, then drafts ten short videos for it — slideshows, faceless hook videos, and videos fronted by your own photo if you upload one.",
        "You keep the ones you like with a swipe. Friday renders them properly, schedules them, and posts them to TikTok and YouTube Shorts.",
        `Start here: ${APP_URL()}/onboarding`,
        "Two things worth knowing while we're in beta. TikTok posts arrive as drafts in your TikTok app until TikTok finishes reviewing us, and everyone shares a daily YouTube upload limit, so Friday may move a post to the next open slot.",
        "If anything looks wrong, hit the \"Something wrong?\" button inside the app. It reaches us directly.",
      ],
    });
    return null;
  },
});

export const previewsReady = internalMutation({
  args: { requestId: v.id("pipelineRequests"), ready: v.number() },
  handler: async (ctx: MutationCtx, args) => {
    const req = await ctx.db.get("pipelineRequests", args.requestId);
    if (!req || req.previewsEmailedAt) return null; // once per batch
    await ctx.db.patch("pipelineRequests", args.requestId, { previewsEmailedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.email.send, {
      userId: req.userId,
      subject: "Your first videos are ready",
      lines: [
        `Friday has drafted ${args.ready} videos for ${req.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}.`,
        "Open Picks, swipe through them, and keep the ones worth posting. Skipping costs nothing.",
        `${APP_URL()}/picks`,
      ],
    });
    return null;
  },
});

export const postLive = internalMutation({
  args: { postId: v.id("posts"), platform: v.string(), draft: v.boolean() },
  handler: async (ctx: MutationCtx, args) => {
    const post = await ctx.db.get("posts", args.postId);
    if (!post || post.liveEmailedAt) return null; // once per post
    await ctx.db.patch("posts", args.postId, { liveEmailedAt: Date.now() });
    const where = args.platform === "youtube" ? "YouTube" : "TikTok";
    await ctx.scheduler.runAfter(0, internal.email.send, {
      userId: post.userId,
      subject: args.draft ? `Your video is waiting in ${where}` : `Your video is live on ${where}`,
      lines: args.draft
        ? [
            `Friday sent your video to your ${where} inbox.`,
            `Open ${where}, go to Inbox then Notifications, tap the draft and post it. Friday can't publish to ${where} directly until ${where} approves our app.`,
            `${APP_URL()}/calendar`,
          ]
        : [
            `Your video is live on ${where}.`,
            "Its tracked link is in the caption, so clicks to your product show up in Analytics. First view counts arrive tomorrow morning — Friday refreshes them once a day.",
            `${APP_URL()}/analytics`,
          ],
    });
    return null;
  },
});

export const renderFailed = internalMutation({
  args: { userId: v.id("users"), hook: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    await ctx.scheduler.runAfter(0, internal.email.send, {
      userId: args.userId,
      subject: "One video didn't render",
      lines: [
        `Friday couldn't finish ${args.hook ? `"${args.hook}"` : "one of your videos"}.`,
        "It hasn't been counted against your allowance, and we've been told about it. Nothing else in your queue is affected.",
        `${APP_URL()}/picks`,
      ],
    });
    return null;
  },
});

/** Monday morning: what last week actually did. Skipped when there's nothing to say. */
export const weeklyDigest = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const users = await ctx.db.query("users").take(500);
    let sent = 0;
    for (const user of users) {
      if (user.emailOptOut || !user.email) continue;
      const posts: Doc<"posts">[] = await ctx.db.query("posts").withIndex("by_userId", (q) => q.eq("userId", user._id)).take(200);
      const recent = posts.filter((p) => p.publishAt > since && p.publishAt <= Date.now());
      if (recent.length === 0) continue;

      let clicks = 0;
      let views = 0;
      for (const post of recent) {
        const links = await ctx.db.query("trackedLinks").withIndex("by_postId", (q) => q.eq("postId", post._id)).take(2);
        for (const link of links) {
          const hits = await ctx.db
            .query("linkClicks")
            .withIndex("by_linkId_and_clickedAt", (q) => q.eq("linkId", link._id).gt("clickedAt", since))
            .take(500);
          clicks += hits.length;
        }
        const pubs = await ctx.db.query("publications").withIndex("by_postId", (q) => q.eq("postId", post._id)).take(5);
        for (const pub of pubs) {
          const latest = await ctx.db
            .query("metrics")
            .withIndex("by_publicationId_and_capturedAt", (q) => q.eq("publicationId", pub._id))
            .order("desc")
            .first();
          views += latest?.views ?? 0;
        }
      }
      await ctx.scheduler.runAfter(0, internal.email.send, {
        userId: user._id as Id<"users">,
        subject: `Last week: ${clicks} ${clicks === 1 ? "click" : "clicks"} to your product`,
        lines: [
          `${recent.length} ${recent.length === 1 ? "post went out" : "posts went out"} last week.`,
          `Clicks to your product: ${clicks}. Views: ${views}.`,
          clicks === 0
            ? "No clicks yet. That usually means the hook, not the product — keep the ones that sound like you talking, not like an ad."
            : "Keep more of whatever earned those clicks; Friday drafts in the same shape when you do.",
          `${APP_URL()}/analytics`,
        ],
      });
      sent++;
    }
    return { sent };
  },
});
