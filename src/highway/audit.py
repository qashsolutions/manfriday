"""Did the guardrails actually hold?

The health check looks at right now: is any lane currently past a threshold and still holding.
That cannot see a breach that came and went - a position that sat 12% down for an hour before
something sold it leaves no trace in a snapshot.

This walks the recorded history instead. For every position each manager has held, it replays
the price series the engine saw and asks, at each point, whether a hard rule should have fired.
Then it measures how long the exit actually took. A rule that fires late is not a rule.
"""

from __future__ import annotations

from .config import Settings
from .db import DB
from .metrics import replay

TOLERANCE_MIN = 15.0   # the engine confirms on a second check, so an exit is never instant


def _prices(db: DB, pid: str, lane: int, asset: str, start: float, end: float) -> list[tuple[float, float]]:
    """The price series the engine actually saw for this position.

    Filtered by asset as well as lane: a lane that switched from a $9 coin to a $90 stock would
    otherwise look like a 90% crash and invent a stop that never should have fired.
    """
    rows = db.query(
        "SELECT ts, price FROM league_equity WHERE portfolio=? AND lane_id=? AND asset=? AND ts>=? "
        "AND ts<=? AND price IS NOT NULL ORDER BY ts", (pid, lane, asset, start, end))
    return [(r["ts"], r["price"]) for r in rows if r["price"] and r["price"] > 0]


def _day_ago(series: list[tuple[float, float]], i: int, window: float, entry: float) -> float:
    """The price a day before sample i, or the entry price if the position is younger."""
    cutoff = series[i][0] - window
    for j in range(i, -1, -1):
        if series[j][0] <= cutoff:
            return series[j][1]
    return entry


def breaches(db: DB, s: Settings, pid: str, tolerance_min: float = TOLERANCE_MIN,
             since: float = 0.0) -> list[dict]:
    """Every moment a hard rule should have fired, and how long the exit took.

    `since` keeps the audit honest about rules that were added later: a give-back stop cannot
    be judged against positions held before it existed.
    """
    closed, open_ = replay(db, pid)
    window = s.rules.day_window_hours * 3600
    out = []
    for t in closed + open_:
        opened = t["opened"]
        closed_at = t.get("closed")
        if closed_at and closed_at < since:
            continue
        series = _prices(db, pid, t["lane"], t["asset"], opened, closed_at or 2e10)
        if len(series) < 2:
            continue
        entry = t["cost"] / t["qty"] if t.get("qty") else series[0][1]
        peak = series[0][1]
        for i, (ts, px) in enumerate(series):
            peak = max(peak, px)
            day = (px / _day_ago(series, i, window, entry) - 1) * 100
            give = (px / peak - 1) * 100
            rule = None
            if day <= s.rules.stop_loss_day_pct:
                rule = ("day stop", day, s.rules.stop_loss_day_pct)
            elif day > s.rules.take_profit_day_pct:
                rule = ("day take-profit", day, s.rules.take_profit_day_pct)
            elif s.rules.giveback_pct and give <= -s.rules.giveback_pct:
                rule = ("give-back", give, -s.rules.giveback_pct)
            if not rule or ts < since:
                continue
            name, value, threshold = rule
            lag = ((closed_at - ts) / 60) if closed_at else None
            out.append({
                "lane": t["lane"], "asset": t["asset"], "rule": name,
                "at": ts, "value": round(value, 2), "threshold": threshold,
                "lag_min": round(lag, 1) if lag is not None else None,
                "still_open": closed_at is None,
                "late": closed_at is None or lag > tolerance_min,
            })
            break   # one report per position: the first moment it should have exited
    return out


def report(db: DB, s: Settings, names: dict[str, str], tolerance_min: float = TOLERANCE_MIN,
           since: float | None = None) -> dict:
    """One line per manager: did its guardrails hold, and where did they not?"""
    if since is None:
        since = db.get_state("league_started") or 0.0
    rows, worst = [], []
    for pid, name in names.items():
        found = breaches(db, s, pid, tolerance_min, since)
        late = [b for b in found if b["late"]]
        rows.append({
            "manager": name, "id": pid, "triggers": len(found), "late": len(late),
            "worst_lag_min": max((b["lag_min"] or 1e9) for b in late) if late else 0.0,
            "clean": not late,
        })
        worst.extend({**b, "manager": name} for b in late)
    worst.sort(key=lambda b: -(b["lag_min"] or 1e9))
    return {"managers": rows, "breaches": worst[:20], "since": since,
            "clean": all(r["clean"] for r in rows), "tolerance_min": tolerance_min}
