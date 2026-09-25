"""Day-by-day and week-by-week results for every manager.

A league day runs from the moment the league started, so day 1 is the first 24 hours.
When a day completes, Python writes its summary (no AI call) and a report file. Seven days
roll up into a week, and by week 6 the whole table reads across: every manager, every week.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from .config import DATA_DIR
from .db import DB
from .metrics import round_trips

DAY = 86400
REPORTS = DATA_DIR / "reports"
SCHEMA = """
CREATE TABLE IF NOT EXISTS day_summaries (
  day INTEGER, portfolio TEXT, ts REAL, start_value REAL, end_value REAL, return_pct REAL,
  cumulative_pct REAL, trades INTEGER, fees REAL, stops INTEGER, take_profits INTEGER,
  vault REAL, assets TEXT, best TEXT, worst TEXT, rank INTEGER,
  PRIMARY KEY (day, portfolio));
"""


def ensure(db: DB) -> None:
    db.conn.executescript(SCHEMA)


def started_at(db: DB) -> float:
    return db.get_state("league_started") or time.time()


def current_day(db: DB, now: float | None = None) -> int:
    """Day 1 is the first 24 hours of the league."""
    return int(((now or time.time()) - started_at(db)) // DAY) + 1


def bounds(db: DB, day: int) -> tuple[float, float]:
    start = started_at(db)
    return start + (day - 1) * DAY, start + day * DAY


def _value_at(db: DB, pid: str, ts: float, prefer: str = "first") -> float | None:
    order = "ASC" if prefer == "first" else "DESC"
    where = ">=" if prefer == "first" else "<="
    rows = db.query(
        f"SELECT equity FROM league_equity WHERE portfolio=? AND lane_id=0 AND ts {where} ? ORDER BY ts {order} LIMIT 1",
        (pid, ts),
    )
    return rows[0]["equity"] if rows else None


def build_day(db: DB, day: int, managers: dict[str, str]) -> list[dict]:
    """Summarise one completed league day for every manager."""
    ensure(db)
    start_ts, end_ts = bounds(db, day)
    league_start_values = db.get_state("league_start_values", {})
    rows = []
    for pid, name in managers.items():
        start = _value_at(db, pid, start_ts, "first") or league_start_values.get(pid, 500.0)
        end = _value_at(db, pid, min(end_ts, time.time()), "last")
        if end is None:
            continue
        fills = db.query(
            "SELECT lane_id, asset, side, cash, fee, reason FROM fills WHERE portfolio=? AND ts>=? AND ts<?",
            (pid, start_ts, end_ts),
        )
        lanes = db.query(
            "SELECT DISTINCT lane_id, asset FROM league_equity WHERE portfolio=? AND lane_id>0 AND ts>=? AND ts<?",
            (pid, start_ts, end_ts),
        )
        moves = []
        for l in lanes:
            first = _lane_value(db, pid, l["lane_id"], start_ts, "first")
            last = _lane_value(db, pid, l["lane_id"], min(end_ts, time.time()), "last")
            if first and last:
                moves.append((round((last / first - 1) * 100, 2), l["asset"] or f"lane {l['lane_id']}", l["lane_id"]))
        moves.sort(reverse=True)
        trips = [t for t in round_trips(db, pid) if start_ts <= t.get("closed", 0) < end_ts]
        rows.append({
            "day": day, "portfolio": pid, "name": name, "ts": time.time(),
            "start_value": round(start, 2), "end_value": round(end, 2),
            "return_pct": round((end / start - 1) * 100, 2),
            "cumulative_pct": round((end / (league_start_values.get(pid) or 500.0) - 1) * 100, 2),
            "trades": len(fills), "closed_trades": len(trips),
            "fees": round(sum(f["fee"] for f in fills), 2),
            "stops": sum(1 for f in fills if f["reason"] == "stop_day"),
            "take_profits": sum(1 for f in fills if f["reason"] == "take_profit_day"),
            "vault": _vault(db, pid, end_ts),
            "assets": sorted({f["asset"] for f in fills}) or _held(db, pid, end_ts),
            "best": f"{moves[0][1]} {moves[0][0]:+.2f}%" if moves else "",
            "worst": f"{moves[-1][1]} {moves[-1][0]:+.2f}%" if len(moves) > 1 else "",
        })
    rows.sort(key=lambda r: -r["return_pct"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    db.executemany(
        "INSERT OR REPLACE INTO day_summaries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [(r["day"], r["portfolio"], r["ts"], r["start_value"], r["end_value"], r["return_pct"], r["cumulative_pct"],
          r["trades"], r["fees"], r["stops"], r["take_profits"], r["vault"], ", ".join(r["assets"]), r["best"],
          r["worst"], r["rank"]) for r in rows],
    )
    _write_day(db, day, rows)
    return rows


def _lane_value(db: DB, pid: str, lane_id: int, ts: float, prefer: str) -> float | None:
    order = "ASC" if prefer == "first" else "DESC"
    where = ">=" if prefer == "first" else "<="
    rows = db.query(
        f"SELECT equity FROM league_equity WHERE portfolio=? AND lane_id=? AND ts {where} ? ORDER BY ts {order} LIMIT 1",
        (pid, lane_id, ts),
    )
    return rows[0]["equity"] if rows else None


def _vault(db: DB, pid: str, ts: float) -> float:
    rows = db.query(
        "SELECT equity FROM league_equity WHERE portfolio=? AND lane_id=-1 AND ts<=? ORDER BY ts DESC LIMIT 1", (pid, ts))
    return round(rows[0]["equity"], 2) if rows else 0.0


def _held(db: DB, pid: str, ts: float) -> list[str]:
    rows = db.query(
        "SELECT DISTINCT asset FROM league_equity WHERE portfolio=? AND lane_id>0 AND ts<=? AND ts>? AND asset IS NOT NULL",
        (pid, ts, ts - 3600))
    return sorted(r["asset"] for r in rows)


def days(db: DB) -> list[dict]:
    ensure(db)
    return db.query("SELECT * FROM day_summaries ORDER BY day, rank")


def weeks(db: DB, managers: dict[str, str]) -> list[dict]:
    """Roll the daily results up into weeks: 1-7 = week 1, 8-14 = week 2, and so on."""
    return _rollup(db, managers, 7, "week")


def months(db: DB, managers: dict[str, str]) -> list[dict]:
    """The same, in 30-day blocks."""
    return _rollup(db, managers, 30, "month")


def _rollup(db: DB, managers: dict[str, str], size: int, label: str) -> list[dict]:
    rows = days(db)
    out: dict[int, dict] = {}
    for r in rows:
        bucket = (r["day"] - 1) // size + 1
        entry = out.setdefault(bucket, {label: bucket, "managers": {}, "days": set()})
        entry["days"].add(r["day"])
        m = entry["managers"].setdefault(r["portfolio"], {
            "portfolio": r["portfolio"], "name": managers.get(r["portfolio"], r["portfolio"]),
            "factor": 1.0, "trades": 0, "fees": 0.0, "stops": 0, "take_profits": 0,
            "best_day": None, "worst_day": None, "end_value": r["end_value"], "cumulative_pct": r["cumulative_pct"],
        })
        m["factor"] *= 1 + r["return_pct"] / 100
        m["trades"] += r["trades"]
        m["fees"] += r["fees"]
        m["stops"] += r["stops"]
        m["take_profits"] += r["take_profits"]
        m["end_value"] = r["end_value"]
        m["cumulative_pct"] = r["cumulative_pct"]
        if m["best_day"] is None or r["return_pct"] > m["best_day"][1]:
            m["best_day"] = (r["day"], r["return_pct"])
        if m["worst_day"] is None or r["return_pct"] < m["worst_day"][1]:
            m["worst_day"] = (r["day"], r["return_pct"])
    result = []
    for bucket, entry in sorted(out.items()):
        managers_out = []
        for m in entry["managers"].values():
            m["return_pct"] = round((m["factor"] - 1) * 100, 2)
            m["fees"] = round(m["fees"], 2)
            managers_out.append(m)
        managers_out.sort(key=lambda m: -m["return_pct"])
        for i, m in enumerate(managers_out, 1):
            m["rank"] = i
        result.append({label: bucket, "week": bucket, "days": sorted(entry["days"]), "managers": managers_out})
    return result


# ---- reports ---------------------------------------------------------------------------------

def _write_day(db: DB, day: int, rows: list[dict]) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    start_ts, end_ts = bounds(db, day)
    lines = [f"# Day {day}", f"_{datetime.fromtimestamp(start_ts, timezone.utc):%Y-%m-%d %H:%M} to "
             f"{datetime.fromtimestamp(end_ts, timezone.utc):%Y-%m-%d %H:%M} UTC_", "",
             "| # | Manager | Start | End | Day | Since league start | Trades | Fees | Stops / take-profits | Best lane | Worst lane |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['rank']} | {r['name']} | ${r['start_value']:.2f} | ${r['end_value']:.2f} | {r['return_pct']:+.2f}% | "
                     f"{r['cumulative_pct']:+.2f}% | {r['trades']} | ${r['fees']:.2f} | {r['stops']} / {r['take_profits']} | "
                     f"{r['best'] or '-'} | {r['worst'] or '-'} |")
    (REPORTS / f"day-{day}.md").write_text("\n".join(lines) + "\n")


def write_week_table(db: DB, managers: dict[str, str]) -> str:
    """The running table: every week so far, every manager. This is the week 6 picture."""
    data = weeks(db, managers)
    if not data:
        return ""
    names = list(managers.values())
    lines = ["# Highway league: week by week", "",
             "| Week | Days | " + " | ".join(names) + " |",
             "|---|---|" + "---|" * len(names)]
    for w in data:
        by_name = {m["name"]: m for m in w["managers"]}
        cells = [f"{by_name[n]['return_pct']:+.2f}%" if n in by_name else "-" for n in names]
        lines.append(f"| {w['week']} | {min(w['days'])}-{max(w['days'])} | " + " | ".join(cells) + " |")
    last = data[-1]
    lines += ["", "| Manager | Value now | Since league start | Trades | Fees | Best day | Worst day |", "|---|---|---|---|---|---|---|"]
    for m in last["managers"]:
        lines.append(f"| {m['name']} | ${m['end_value']:.2f} | {m['cumulative_pct']:+.2f}% | {m['trades']} | ${m['fees']:.2f} | "
                     f"day {m['best_day'][0]} {m['best_day'][1]:+.2f}% | day {m['worst_day'][0]} {m['worst_day'][1]:+.2f}% |")
    text = "\n".join(lines) + "\n"
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "weeks.md").write_text(text)
    return text
