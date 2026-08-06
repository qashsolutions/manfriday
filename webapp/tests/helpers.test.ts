import { describe, expect, it } from "vitest";
import { safeJson } from "./helpers";
import { SENTINELS } from "./setup";

/** The leak detector is the linchpin of every contract test — prove it can
    actually fail, so a green suite means what it claims. */
describe("safeJson leak detector", () => {
  it("passes a clean body through", async () => {
    const res = new Response(JSON.stringify({ error: "Not signed in" }));
    expect(await safeJson(res)).toEqual({ error: "Not signed in" });
  });

  it("fails when a response leaks an API key", async () => {
    const res = new Response(JSON.stringify({ error: `upstream said: ${SENTINELS.ANTHROPIC_API_KEY}` }));
    await expect(safeJson(res)).rejects.toThrow(/leaked ANTHROPIC_API_KEY/);
  });

  it("fails when a response leaks the service-role key", async () => {
    const res = new Response(JSON.stringify({ detail: SENTINELS.SUPABASE_SECRET_KEY }));
    await expect(safeJson(res)).rejects.toThrow(/leaked SUPABASE_SECRET_KEY/);
  });

  it("fails when a response carries a stack trace", async () => {
    const res = new Response(JSON.stringify({ error: "boom", stack: "Error: boom\n    at POST (/app/route.ts:1:1)" }));
    await expect(safeJson(res)).rejects.toThrow(/stack frame/);
  });
});
