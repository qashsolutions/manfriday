/** Alerting: something failed that a human should see.
 *
 *  Every alert is recorded in the database first, so nothing is lost when email
 *  isn't configured yet, then emailed through Resend when RESEND_API_KEY is set.
 *  Called from the worker's failure paths and from publishing — never from the UI.
 */
import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ALERT_TO = () => env.ALERT_EMAIL ?? "admin@manfriday.app";
const ALERT_FROM = () => env.ALERT_FROM ?? "Man Friday alerts <alerts@manfriday.app>";

/** Record an alert and (if email is configured) send it. */
export const raise = internalMutation({
  args: { kind: v.string(), message: v.string(), userId: v.optional(v.id("users")), refId: v.optional(v.string()) },
  handler: async (ctx: MutationCtx, args) => {
    const user = args.userId ? await ctx.db.get("users", args.userId) : null;
    const alertId = await ctx.db.insert("alerts", {
      kind: args.kind,
      message: args.message.slice(0, 1000),
      userEmail: user?.email,
      refId: args.refId,
    });
    await ctx.scheduler.runAfter(0, internal.alerts.send, { alertId });
    return alertId;
  },
});

export const pending = internalQuery({
  args: { alertId: v.id("alerts") },
  handler: async (ctx: QueryCtx, args) => await ctx.db.get("alerts", args.alertId),
});

export const markNotified = internalMutation({
  args: { alertId: v.id("alerts") },
  handler: async (ctx: MutationCtx, args) => {
    await ctx.db.patch("alerts", args.alertId, { notifiedAt: Date.now() });
    return null;
  },
});

export const send = internalAction({
  args: { alertId: v.id("alerts") },
  handler: async (ctx: ActionCtx, args): Promise<null> => {
    const key = env.RESEND_API_KEY;
    const alert = await ctx.runQuery(internal.alerts.pending, { alertId: args.alertId });
    if (!alert || alert.notifiedAt) return null;
    if (!key) {
      // Not configured yet: the row stays, unnotified, and admin:listAlerts shows it.
      console.warn(`ALERT [${alert.kind}] ${alert.message} (no RESEND_API_KEY; recorded only)`);
      return null;
    }
    const subject = `[Man Friday] ${alert.kind}${alert.userEmail ? ` — ${alert.userEmail}` : ""}`;
    const body = [alert.message, alert.userEmail ? `User: ${alert.userEmail}` : null, alert.refId ? `Ref: ${alert.refId}` : null]
      .filter(Boolean)
      .join("\n\n");
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ALERT_FROM(), to: [ALERT_TO()], subject, text: body }),
    });
    if (!resp.ok) {
      console.error("alert email failed", resp.status, (await resp.text()).slice(0, 200));
      return null;
    }
    await ctx.runMutation(internal.alerts.markNotified, { alertId: args.alertId });
    return null;
  },
});

/** Feedback arrives as an alert too, so it lands in the same place as failures. */
export const raiseFromFeedback = internalMutation({
  args: { email: v.string(), page: v.string(), message: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const alertId = await ctx.db.insert("alerts", {
      kind: "feedback",
      message: `${args.message}\n\n(from ${args.page})`,
      userEmail: args.email || undefined,
    });
    await ctx.scheduler.runAfter(0, internal.alerts.send, { alertId });
    return null;
  },
});

/** Re-send anything recorded while email was unconfigured. Safe to run repeatedly. */
export const flush = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const waiting = await ctx.db
      .query("alerts")
      .withIndex("by_notifiedAt", (q) => q.eq("notifiedAt", undefined))
      .take(50);
    for (const a of waiting) await ctx.scheduler.runAfter(0, internal.alerts.send, { alertId: a._id as Id<"alerts"> });
    return { queued: waiting.length };
  },
});
