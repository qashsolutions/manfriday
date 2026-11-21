/** "Something's wrong" from inside the app. One mutation, stored forever, and
 *  it raises an alert so we hear about it without polling. */
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentUserId } from "./users";
import type { Doc, Id } from "./_generated/dataModel";

const MAX_PER_DAY = 20;

const clip = (s: string, n: number) => s.slice(0, n);

/** What the client may send. Every string is trimmed again before storing. */
const contextArg = v.optional(
  v.object({
    item: v.optional(v.object({ kind: v.literal("pick"), id: v.string(), label: v.optional(v.string()) })),
    lastError: v.optional(v.object({ message: v.string(), at: v.number(), page: v.string() })),
    device: v.optional(v.object({ userAgent: v.string(), viewport: v.string(), timezone: v.string(), language: v.string() })),
  }),
);

export const submit = mutation({
  args: { message: v.string(), page: v.string(), context: contextArg },
  handler: async (ctx: MutationCtx, args) => {
    const message = args.message.trim();
    if (message.length < 3) throw new ConvexError("FEEDBACK|empty|Tell us what happened first.");
    const userId = await currentUserId(ctx);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("FEEDBACK|signed_out|Sign in to send feedback.");
    const email = (identity.email as string | undefined) ?? "";

    // Light abuse guard: a user can't flood us.
    if (userId) {
      const recent = await ctx.db.query("feedback").order("desc").take(100);
      const mine = recent.filter((f) => f.userId === userId && f._creationTime > Date.now() - 24 * 60 * 60 * 1000);
      if (mine.length >= MAX_PER_DAY) throw new ConvexError("FEEDBACK|too_many|That's plenty for today — we've got them, thank you.");
    }

    const context = await checkedContext(ctx, userId, args.context);
    await ctx.db.insert("feedback", {
      userId: userId ?? undefined,
      email,
      page: args.page.slice(0, 120),
      message: message.slice(0, 4000),
      ...(context ? { context } : {}),
    });
    await ctx.scheduler.runAfter(0, internal.alerts.raiseFromFeedback, {
      email,
      page: args.page.slice(0, 120),
      message: message.slice(0, 1000),
      details: context ? describe(context) : undefined,
    });
    return null;
  },
});

type StoredContext = NonNullable<Doc<"feedback">["context"]>;

/** Trim everything, and resolve the pick server-side: only a concept the
 *  reporter owns is recorded, with facts read from the database, not the client. */
async function checkedContext(
  ctx: MutationCtx,
  userId: Id<"users"> | null,
  raw: { item?: { kind: "pick"; id: string }; lastError?: { message: string; at: number; page: string }; device?: { userAgent: string; viewport: string; timezone: string; language: string } } | undefined,
): Promise<StoredContext | null> {
  if (!raw) return null;
  const out: StoredContext = {};
  if (raw.item && userId) {
    const id = ctx.db.normalizeId("concepts", raw.item.id);
    const c = id ? await ctx.db.get("concepts", id) : null;
    if (c && c.userId === userId) {
      const t = await ctx.db.get("trendTemplates", c.templateId);
      out.pick = { id: c._id, status: c.status, format: t?.format ?? "unknown", language: c.language, batchId: c.batchId, hasVideo: !!c.videoId };
    }
  }
  if (raw.lastError) {
    out.lastError = { message: clip(raw.lastError.message, 500), at: raw.lastError.at, page: clip(raw.lastError.page, 120) };
  }
  if (raw.device) {
    out.device = {
      userAgent: clip(raw.device.userAgent, 300),
      viewport: clip(raw.device.viewport, 20),
      timezone: clip(raw.device.timezone, 60),
      language: clip(raw.device.language, 20),
    };
  }
  return out.pick || out.lastError || out.device ? out : null;
}

/** Plain-text lines for the alert email and the operator screen. */
export function describe(c: StoredContext): string {
  const lines: string[] = [];
  if (c.pick) lines.push(`Pick: ${c.pick.id} · ${c.pick.format} · ${c.pick.language} · ${c.pick.status}${c.pick.hasVideo ? " · has video" : ""} · batch ${c.pick.batchId}`);
  if (c.lastError) lines.push(`Last error shown: "${c.lastError.message}" on ${c.lastError.page} at ${new Date(c.lastError.at).toISOString()}`);
  if (c.device) lines.push(`Device: ${c.device.userAgent} · ${c.device.viewport} · ${c.device.timezone} · ${c.device.language}`);
  return lines.join("\n");
}
