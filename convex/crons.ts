import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const STALE_MS = 5 * 60 * 1000;

/** Stale-claim reaper: a worker that died mid-render leaves claimed/running
 *  jobs behind; put them back in the queue (failJob's attempt cap still applies). */
export const reapStaleClaims = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const cutoff = Date.now() - STALE_MS;
    for (const status of ["claimed", "running"] as const) {
      const rows = await ctx.db
        .query("renderJobs")
        .withIndex("by_status_and_priority", (q) => q.eq("status", status))
        .take(50);
      for (const job of rows) {
        if ((job.claimedAt ?? 0) < cutoff) {
          if (job.attempts >= 3) {
            await ctx.db.patch("renderJobs", job._id, { status: "failed", error: "stale claim; attempts exhausted" });
            await ctx.db.patch("concepts", job.conceptId, { status: "failed" });
          } else {
            await ctx.db.patch("renderJobs", job._id, {
              status: "pending",
              claimedBy: undefined,
              claimedAt: undefined,
              error: "reaped stale claim",
            });
          }
        }
      }
    }
    return null;
  },
});

const crons = cronJobs();
crons.interval("reap stale render claims", { minutes: 2 }, internal.crons.reapStaleClaims, {});
crons.interval("publish due publications", { minutes: 1 }, internal.publishing.publishDue, {});
export default crons;
