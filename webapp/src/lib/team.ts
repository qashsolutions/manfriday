/** The team of six — the single source of truth for seat names and job
    lines. Canonical roster: webapp/DESIGN.md §12 (decided 2026-08-05).
    Every surface that shows a seat name imports from here. */

export type SeatKey =
  | "editor"
  | "marketer"
  | "listener"
  | "scout"
  | "scorekeeper"
  | "researcher";

export type Seat = {
  key: SeatKey;
  /** Canonical display name, lowercase "the" — use sentenceCase() when the
      name opens a sentence or heading. */
  name: string;
  /** The seat's job line (DESIGN.md §12, verbatim) — the one line shown
      wherever the seat introduces itself. */
  job: string;
  /** Names this seat's DB rows were stored under before the 2026-08-05
      rename. Historical rule: existing rows in reports/recommendations keep
      their stored names — no migrations, no rewriting of stored content.
      All NEW writes use `name`. Any query filtering by agent must match
      both — use agentNames(). */
  historical: readonly string[];
};

export const TEAM: Record<SeatKey, Seat> = {
  editor: {
    key: "editor",
    name: "the Editor",
    job: "I find the exact second viewers leave — and what you were saying when they did.",
    historical: ["Retention Analyst"],
  },
  marketer: {
    key: "marketer",
    name: "the Marketer",
    job: "I grade your title and thumbnail — and hand you stronger options before you publish.",
    historical: ["Packaging Analyst"],
  },
  listener: {
    key: "listener",
    name: "the Listener",
    job: "I read every comment so you don't have to — and surface the videos your viewers already asked for.",
    historical: ["Audience Analyst"],
  },
  scout: {
    key: "scout",
    name: "the Scout",
    job: "I find the outside video worth comparing yours to — and what's yours to take from it.",
    historical: ["The Scout"],
  },
  scorekeeper: {
    key: "scorekeeper",
    name: "the Scorekeeper",
    job: "I check every tip against your real numbers — and show you the misses too.",
    historical: ["The Scorekeeper"],
  },
  researcher: {
    key: "researcher",
    name: "the Researcher",
    job: "I dig into a topic and bring back what people actually want from it.",
    historical: ["The Researcher"],
  },
};

/** Roster order (DESIGN.md §12) — for the sidebar, the landing page, and
    anywhere the six appear as a list. */
export const SEATS: readonly Seat[] = [
  TEAM.editor,
  TEAM.marketer,
  TEAM.listener,
  TEAM.scout,
  TEAM.scorekeeper,
  TEAM.researcher,
];

/** Why-verdicts and weekly reports are signed by the team, not a seventh
    seat (DESIGN.md §12). Same historical rule as seats. */
export const TEAM_ATTRIBUTION = {
  name: "the team",
  job: "all six, working together",
  historical: ["The Team"],
} as const;

/** Every agent name this seat's DB rows can carry — canonical first, then
    historical — for .in("agent", …) filters that must see old rows too. */
export function agentNames(seat: Pick<Seat, "name" | "historical"> | typeof TEAM_ATTRIBUTION): string[] {
  return [seat.name, ...seat.historical];
}

/** Job line for any agent name a stored row can carry — canonical or
    historical (old rows keep their old names and must still render). */
export function jobFor(name: string): string | undefined {
  if (name === TEAM_ATTRIBUTION.name || TEAM_ATTRIBUTION.historical.includes(name as "The Team")) {
    return TEAM_ATTRIBUTION.job;
  }
  return SEATS.find((s) => s.name === name || s.historical.includes(name))?.job;
}

/** "the Editor" → "The Editor", for names that open a sentence or heading. */
export function sentenceCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
