import { describe, expect, test } from "vitest";
import { addLocalDays, localDayKey, nextSlot, nextSlot as slot, zonedTimeToUtc, zoneOffsetMs } from "../../lib/schedule";

const inZone = (tz: string, ms: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, dateStyle: "short", timeStyle: "short" }).format(new Date(ms));

describe("scheduling a kept video", () => {
  test("17:30 means 17:30 where the user lives, not on our server", () => {
    for (const tz of ["Asia/Kolkata", "America/Chicago", "Europe/Lisbon", "Asia/Jakarta", "America/Sao_Paulo"]) {
      const at = slot(tz, Date.UTC(2026, 9, 5, 2, 0));
      expect(inZone(tz, at)).toMatch(/17:30$/);
    }
  });

  test("India's half-hour offset is handled", () => {
    expect(zoneOffsetMs("Asia/Kolkata", Date.UTC(2026, 9, 5)) / 60000).toBe(330);
  });

  test("a slot that has already passed today rolls to tomorrow", () => {
    const tz = "America/Chicago";
    const evening = zonedTimeToUtc(tz, "2026-10-05", 19, 0); // after 17:30 local
    const at = slot(tz, evening);
    expect(localDayKey(tz, at)).toBe("2026-10-06");
  });

  test("one post a day: days already taken are skipped", () => {
    const tz = "Europe/Lisbon";
    const now = zonedTimeToUtc(tz, "2026-10-05", 9, 0);
    const at = nextSlot(tz, now, ["2026-10-05", "2026-10-06"]);
    expect(localDayKey(tz, at)).toBe("2026-10-07");
  });

  test("the clock stays at 17:30 across a daylight-saving change", () => {
    const tz = "America/Chicago"; // DST ends 1 Nov 2026
    const before = zonedTimeToUtc(tz, "2026-10-30", 17, 30);
    const after = zonedTimeToUtc(tz, "2026-11-02", 17, 30);
    expect(inZone(tz, before)).toMatch(/17:30$/);
    expect(inZone(tz, after)).toMatch(/17:30$/);
    expect(after - before).not.toBe(3 * 24 * 3600 * 1000); // an hour longer, as it should be
  });

  test("never schedules something about to fire", () => {
    const tz = "UTC";
    const justBefore = zonedTimeToUtc(tz, "2026-10-05", 17, 29);
    expect(slot(tz, justBefore)).toBeGreaterThan(justBefore + 15 * 60 * 1000);
    expect(localDayKey(tz, slot(tz, justBefore))).toBe("2026-10-06");
  });

  test("day keys walk the local calendar, including month ends", () => {
    expect(addLocalDays("Asia/Kolkata", "2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("times shown to the user", () => {
  test("a scheduled slot reads as their local clock, not UTC", () => {
    // 17:30 in Chicago is 22:30 UTC — the email must say the former.
    const at = zonedTimeToUtc("America/Chicago", "2026-10-05", 17, 30);
    const shown = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Chicago", weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
    }).format(new Date(at));
    expect(shown).toMatch(/17:30/);
    expect(shown).not.toMatch(/22:30/);
  });
});
