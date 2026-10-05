import { describe, expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import { api } from "../../convex/_generated/api";
import { harness } from "./setup";

/** A tester's allowance can be set before they sign up: the grant parks itself
 *  and lands on the users row at first sign-in, so nobody has to run a command
 *  at the moment a tester arrives. */
describe("pre-sign-up video grants", () => {
  test("grant set before sign-up applies on first sign-in, then is consumed", async () => {
    const t = harness();
    const res = await t.mutation(internal.admin.setVideoGrant, { email: "Tester@Example.com", videos: 25 });
    expect(res).toMatchObject({ email: "tester@example.com", videos: 25, accounts: 0, pending: true });
    expect(await t.query(internal.admin.listPendingGrants, {})).toHaveLength(1);

    const asTester = t.withIdentity({ subject: "user_tester", email: "tester@example.com" });
    const userId = await asTester.mutation(api.users.ensureCurrent, { timezone: "America/Chicago" });

    const row = await t.run(async (ctx) => await ctx.db.get("users", userId));
    expect(row?.videoGrant).toBe(25);
    expect(await t.query(internal.admin.listPendingGrants, {})).toHaveLength(0);
  });

  test("grant for an existing account patches the row and parks nothing", async () => {
    const t = harness();
    const asTester = t.withIdentity({ subject: "user_tester", email: "tester@example.com" });
    await asTester.mutation(api.users.ensureCurrent, {});
    const res = await t.mutation(internal.admin.setVideoGrant, { email: "tester@example.com", videos: 25 });
    expect(res).toMatchObject({ accounts: 1, pending: false });
    expect(await t.query(internal.admin.listPendingGrants, {})).toHaveLength(0);
  });

  test("zero clears a parked grant", async () => {
    const t = harness();
    await t.mutation(internal.admin.setVideoGrant, { email: "tester@example.com", videos: 25 });
    await t.mutation(internal.admin.setVideoGrant, { email: "tester@example.com", videos: 0 });
    expect(await t.query(internal.admin.listPendingGrants, {})).toHaveLength(0);
  });

  test("a second sign-in does not re-apply a consumed grant", async () => {
    const t = harness();
    await t.mutation(internal.admin.setVideoGrant, { email: "tester@example.com", videos: 25 });
    const asTester = t.withIdentity({ subject: "user_tester", email: "tester@example.com" });
    const first = await asTester.mutation(api.users.ensureCurrent, {});
    const second = await asTester.mutation(api.users.ensureCurrent, {});
    expect(second).toBe(first);
    const row = await t.run(async (ctx) => await ctx.db.get("users", first));
    expect(row?.videoGrant).toBe(25);
  });
});
