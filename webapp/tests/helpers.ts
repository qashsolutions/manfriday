import { expect, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { SENTINELS } from "./setup";

export const TEST_USER = { id: "user-1", email: "creator@test.local" } as unknown as User;

type QueryResult = { data?: unknown; error?: { message: string } | null };

/** Chainable, awaitable stand-in for a supabase-js query builder. Each
    `.from(table)` consumes the next queued result for that table; every
    builder method returns the chain, and awaiting the chain — directly or
    after `.single()`/`.maybeSingle()` — resolves that result. `insert`
    payloads are recorded per table so tests can assert what was written. */
export function fakeSvc(tables: Record<string, QueryResult[]> = {}) {
  const inserts: Record<string, unknown[]> = {};
  const svc = {
    from(table: string) {
      const queued = tables[table]?.shift() ?? {};
      const result = { data: null, error: null, ...queued };
      const chain: any = {};
      for (const m of ["select", "eq", "is", "not", "gt", "in", "order", "limit", "maybeSingle", "single", "upsert"]) {
        chain[m] = () => chain;
      }
      chain.insert = (rows: unknown) => {
        (inserts[table] ??= []).push(rows);
        return chain;
      };
      chain.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onOk, onErr);
      return chain;
    },
  };
  return { svc: svc as any, inserts };
}

/** A stand-in Anthropic client whose structured-output call answers with
    `payload` as the analyst's JSON. Pass stopReason "refusal" to exercise
    the refusal branch. */
export function fakeAnthropic(payload: unknown, stopReason = "end_turn") {
  const create = vi.fn().mockResolvedValue({
    stop_reason: stopReason,
    content: stopReason === "refusal" ? [] : [{ type: "text", text: JSON.stringify(payload) }],
  });
  return { client: { beta: { messages: { create } } } as any, create };
}

/** POST request to a route handler; omit body for an empty request. */
export function post(body?: unknown): Request {
  return new Request("http://test.local/api", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

/** Reads the response body, asserts it leaks no sentinel secret, no stack
    frame, and no source paths, then returns the parsed JSON. Use for EVERY
    response read so the leak check rides along with every assertion. */
export async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  for (const [name, value] of Object.entries(SENTINELS)) {
    expect(text, `response body leaked ${name}`).not.toContain(value);
  }
  expect(text, "response body contains a stack frame").not.toContain("    at ");
  expect(text, "response body references source paths").not.toContain("node_modules");
  expect(text, "response body references source paths").not.toContain("webapp/src");
  return JSON.parse(text);
}
