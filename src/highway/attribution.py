"""Which rule closed each trade, and what it made or lost.

The hard rules are the part of the league nobody chose bar the owner, so they are the part most
worth auditing in money rather than in counts. `audit.py` already answers "did the rule fire, and
on time"; this answers "and was it worth firing".

A trade is one lane going flat -> bought -> flat again (`metrics.replay`), so its profit is
unambiguous. It is credited to the reason on the fill that *closed* it: a position part-sold by
the strategy and then stopped out counts as a stop, because the stop is what ended it.
"""

from __future__ import annotations

from .db import DB
from .metrics import replay

# Written for the dashboard, so they read as English rather than as column names.
LABELS = {
    "stop_day": "Stop-loss: fell too far in a day",
    "take_profit_day": "Target hit: rose enough in a day",
    "giveback": "Give-back: too far off its own peak",
    "signal": "The strategy decided to get out",
    "signal_market": "The strategy got out, at market",
    "lane_floor": "Lane hit its floor and closed",
    "sleeve_closed": "The retired ETF sleeve was wound up",
}

# The three the owner set by hand. Everything else is a strategy choice.
HARD_RULES = ("stop_day", "take_profit_day", "giveback")


def label(reason: str) -> str:
    return LABELS.get(reason, reason.replace("_", " ").capitalize())


def by_rule(db: DB, pid: str, since: float = 0.0) -> list[dict]:
    """Realised profit for one manager, grouped by the rule that closed the trade."""
    closed, _ = replay(db, pid)
    groups: dict[str, dict] = {}
    for t in closed:
        if t["closed"] < since or not t.get("exits"):
            continue
        reason = t["exits"][-1]
        g = groups.setdefault(reason, {"reason": reason, "label": label(reason), "hard_rule": reason in HARD_RULES,
                                       "trades": 0, "pnl": 0.0, "fees": 0.0, "wins": 0, "pcts": []})
        g["trades"] += 1
        g["pnl"] += t["pnl"]
        g["fees"] += t["fees"]
        g["wins"] += t["pnl"] > 0
        if t["cost"]:
            g["pcts"].append(t["pnl_pct"])
    rows = []
    for g in groups.values():
        pcts = g.pop("pcts")
        g["avg_pct"] = round(sum(pcts) / len(pcts), 2) if pcts else 0.0
        g["worst_pct"] = round(min(pcts), 2) if pcts else 0.0
        g["best_pct"] = round(max(pcts), 2) if pcts else 0.0
        g["pnl"] = round(g["pnl"], 2)
        g["fees"] = round(g["fees"], 2)
        rows.append(g)
    return sorted(rows, key=lambda r: r["pnl"])


def report(db: DB, names: dict[str, str], since: float = 0.0) -> dict:
    """Every manager's rule attribution, plus the league totals and the rules that never fired.

    A hard rule with no trades against it is worth surfacing, not hiding: it means the rule has
    never been tested by live prices, so nothing is known about whether its level is right.
    """
    managers, totals = [], {}
    for pid, name in names.items():
        rows = by_rule(db, pid, since)
        managers.append({"id": pid, "name": name, "rules": rows,
                         "realised": round(sum(r["pnl"] for r in rows), 2)})
        for r in rows:
            t = totals.setdefault(r["reason"], {"reason": r["reason"], "label": r["label"],
                                                "hard_rule": r["hard_rule"], "trades": 0,
                                                "pnl": 0.0, "wins": 0, "pcts": []})
            t["trades"] += r["trades"]
            t["pnl"] += r["pnl"]
            t["wins"] += r["wins"]
            t["pcts"] += [r["avg_pct"]] * r["trades"]
    league = []
    for t in totals.values():
        pcts = t.pop("pcts")
        t["avg_pct"] = round(sum(pcts) / len(pcts), 2) if pcts else 0.0
        t["pnl"] = round(t["pnl"], 2)
        league.append(t)
    return {
        "managers": sorted(managers, key=lambda m: -m["realised"]),
        "league": sorted(league, key=lambda r: r["pnl"]),
        "never_fired": [r for r in HARD_RULES if r not in totals],
        "realised": round(sum(r["pnl"] for r in league), 2),
    }
