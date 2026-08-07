import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/youtube", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  yt: vi.fn(),
}));

import { fetchPublicChannels } from "@/lib/server/publicYt";
import { yt } from "@/lib/server/youtube";

const call = vi.mocked(yt);

/** The id list of one request, in order. */
function idsOf(path: string): string[] {
  const raw = new URL(`https://x/${path}`).searchParams.get("id") ?? "";
  return raw ? raw.split(",") : [];
}

function answerWith(ids: string[]) {
  return {
    items: ids.map((id) => ({
      id,
      snippet: { title: `Channel ${id}`, publishedAt: "2020-01-01T00:00:00Z" },
      statistics: { subscriberCount: "100", videoCount: "10" },
      contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  call.mockImplementation(async (path: string) => answerWith(idsOf(path)) as any);
});

describe("fetchPublicChannels", () => {
  it("asks once for a batch of videos that share a few channels", async () => {
    // 15 videos, 3 channels — the shape a topic sweep actually produces.
    const ids = Array.from({ length: 15 }, (_, i) => `UC${i % 3}`);
    const got = await fetchPublicChannels("token", ids);

    expect(call).toHaveBeenCalledTimes(1);
    expect(idsOf(call.mock.calls[0][0])).toEqual(["UC0", "UC1", "UC2"]);
    expect([...got.keys()]).toEqual(["UC0", "UC1", "UC2"]);
  });

  it("pages by unique channel, not by raw id count", async () => {
    // 120 ids, 30 unique: paging over the raw count would fire three requests,
    // two of them with an empty id list — which the API rejects.
    const ids = Array.from({ length: 120 }, (_, i) => `UC${i % 30}`);
    const got = await fetchPublicChannels("token", ids);

    expect(call).toHaveBeenCalledTimes(1);
    expect(idsOf(call.mock.calls[0][0])).toHaveLength(30);
    expect(got.size).toBe(30);
    for (const [path] of call.mock.calls) expect(idsOf(path).length).toBeGreaterThan(0);
  });

  it("still splits at 50 when there are genuinely more than 50 channels", async () => {
    // 130 ids, 65 unique — two requests, and every unique channel comes back.
    const ids = Array.from({ length: 130 }, (_, i) => `UC${i % 65}`);
    const got = await fetchPublicChannels("token", ids);

    expect(call).toHaveBeenCalledTimes(2);
    expect(idsOf(call.mock.calls[0][0])).toHaveLength(50);
    expect(idsOf(call.mock.calls[1][0])).toHaveLength(15);
    expect(got.size).toBe(65);

    const asked = call.mock.calls.flatMap(([path]) => idsOf(path));
    expect(new Set(asked).size).toBe(65); // no channel asked for twice
  });

  it("drops videos that carried no channel id rather than asking for a blank", async () => {
    const got = await fetchPublicChannels("token", ["UC1", "", "UC2", ""]);
    expect(idsOf(call.mock.calls[0][0])).toEqual(["UC1", "UC2"]);
    expect(got.size).toBe(2);
  });

  it("asks nothing at all for an empty list", async () => {
    expect((await fetchPublicChannels("token", [])).size).toBe(0);
    expect((await fetchPublicChannels("token", ["", ""])).size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });
});
